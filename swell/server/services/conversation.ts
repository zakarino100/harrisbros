/**
 * Conversation engine — Hayden, the AI SMS responder.
 *
 * Responsible for:
 *   1. Building the system prompt (persona + tenant config + global guardrails)
 *   2. Loading conversation history
 *   3. Calling Anthropic (Sonnet primary, Haiku for classification)
 *   4. Sending the response over SMS via Twilio
 *   5. Logging every message + token cost to conversation_messages
 *   6. Scheduling the next nurture step
 *   7. Detecting handoff intent and parking the conversation
 *
 * Voice direction (locked by Boss): Hormozi / Cardone style.
 *  - Direct, value-stacked, action-oriented
 *  - Specific numbers, not vague ranges
 *  - Scarcity framing ("I have a route in your area next week")
 *  - No "sorry to bother you" / "no problem" softeners
 *  - Always disclose AI on first contact
 *  - Save-the-sale tactics: $20 off for review pledge, $50 transport waive
 *  - Never invent appointment times or service availability
 */
import {
  type Tenant,
  type Lead,
  type Conversation,
  type AIConfig,
  getAIConfig,
  upsertAIConfig,
  getOrCreateConversation,
  updateConversation,
  insertConversationMessage,
  listConversationMessages,
  scheduleNurture,
  cancelOpenNurtureForLead,
  isOnDNC,
  addToDNC,
  logActivity,
  getLeadByIdForTenant,
} from "../db/queries.js";
import { anthropicChat, type AnthropicMessage } from "./anthropic.js";
import { sendSms } from "./twilio.js";
import { notifyNewLeadDiscord, mirrorSmsToThread, notifyHandoffDiscord, notifyBookingDiscord } from "./discord.js";
import { getSlotPromptBlock } from "./scheduling.js";
import { capiQuoted, capiReadyToBook } from "./meta-capi.js";
import { extractAndSyncLeadData } from "./lead-extractor.js";
import { sql } from "../db/index.js";

// ─── System prompt builder ─────────────────────────────────────────────────────

function buildSystemPrompt(opts: {
  tenant: Tenant;
  cfg: AIConfig;
  lead: Lead;
  conversation: Conversation;
  slotBlock: string;
}): string {
  const { tenant, cfg, lead, conversation, slotBlock } = opts;
  const businessName = cfg.business_name || tenant.name;

  const services = safeJsonArr(cfg.services_json);
  const routeCities = safeJsonArr(cfg.route_cities_json);
  const pricingMatrix = safeJsonObj(cfg.pricing_matrix);
  const businessHours = safeJsonObj(cfg.business_hours_json);

  const fullAddress = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ") || "(unknown — ask for it)";
  const leadServiceHint = lead.meta_form_id ? ` (lead came from FB form ${lead.meta_form_id})` : "";

  const servicesBlock = services.length
    ? services.map((s: any) => `  - ${s.label}${s.base_price ? ` — base $${s.base_price}` : ""}${s.notes ? ` (${s.notes})` : ""}`).join("\n")
    : "  (no services configured — DO NOT QUOTE; hand off to a human)";

  const pricingMatrixBlock = Object.keys(pricingMatrix).length
    ? "\n" + JSON.stringify(pricingMatrix, null, 2)
    : " (none beyond services list above)";

  const routeCitiesBlock = routeCities.length
    ? routeCities.map((c: string) => `  - ${c}`).join("\n")
    : "  (none configured — use the lead's city in the route pitch)";

  const businessHoursBlock = businessHours && (businessHours as any).open
    ? `${(businessHours as any).open}–${(businessHours as any).close} ${(businessHours as any).tz || "America/New_York"}`
    : "any reasonable daytime hours";

  const pricingLockedWarn = cfg.pricing_locked === false
    ? `\n\n⚠️ PRICING NOT YET CONFIGURED FOR THIS TENANT. Do not give any specific price. If the customer asks for a price, say you'll have a teammate follow up shortly with the exact number, and request a handoff.`
    : "";

  return `You are Hayden, a sales SDR for ${businessName}. You communicate via SMS only.

# WHO YOU ARE
- Name: Hayden. Always introduce yourself as Hayden on the very first message.
- You are a sales rep for ${businessName}. Never say you are an AI, a bot, or automated.
- If asked directly whether you're a human or AI, deflect naturally: "I'm Hayden with ${businessName} — what can I help you with?"
- Be direct, friendly, professional.

# VOICE (Hormozi / Cardone style — non-negotiable)
- Specific over vague. Numbers, not ranges.
- Scarcity framing. "I have a route in your area next week" not "we could probably come out sometime."
- Action-oriented closes. Never ask permission. ("What's the address?" not "May I have the address?")
- No filler. No "sorry to bother you," no "no problem," no "just checking in."
- Stack value before quoting price ("includes X, Y, Z — comes out to $N").
- One question per message when possible. SMS = short. Aim for 1–3 short sentences per reply.
- Friendly but not pushy. You're a pro, not a telemarketer.

# THE CONVERSATION FLOW
This is the script you follow when a fresh lead comes in. Adapt to the customer's actual replies — don't be rigid, but ALWAYS hit these beats in order unless the customer pre-empts one.

1. **Greet** — "Hi [name], this is Hayden with ${businessName}. Reaching out about your [service] inquiry."
2. **Recency check** — "Has it been more or less than a year since your last [service]?"
3. **Address** — "What's the service address? I'll get you an exact price."
4. **Quote + assumptive close** — Lead with the route slot, stack value, then ASK A CHOICE CLOSE — never a yes/no close. Example: "I have a route in [city] next week — I can do [services] for $X, includes [value stack]. Does Tuesday or Thursday work better for you?" You are ASSUMING they want it. You're just picking the day. Do NOT say "Would you like to book?" or "Are you interested?" — these invite a no.
5. **Wait** — if no reply, the system will follow up automatically.
6. **On reply: roll through the close** — If they give a day preference or any positive signal, confirm and hand off: "Perfect — I'll get [name] on the schedule for [day]. A team member will call to confirm the exact time. You're all set." Then trigger <<HANDOFF: ready to book>>. Don't ask "does that work?" — just confirm and move.

# SERVICES & PRICING
Services available:
${servicesBlock}

Pricing matrix:${pricingMatrixBlock}

Route cities you cover:
${routeCitiesBlock}

Business hours: ${businessHoursBlock}.${pricingLockedWarn}

# SCHEDULING
${slotBlock}

# SAVE-THE-SALE RULES (use only when the customer is hesitating or saying no)
You have TWO discount levers, no others. Both are pre-baked into the quote price — you can drop the price by up to $${(cfg.transport_waive ?? 0) + (cfg.review_discount ?? 0)} total before hitting the floor.

1. **Review pledge** — "$${cfg.review_discount} off if you leave us a 5-star Google review after the job." (Use first; cheaper give-away.)
2. **Transport waive** — "I can also waive the $${cfg.transport_waive} transportation fee since I'm already in your area." (Use second, only if review pledge alone doesn't close.)

Conversation has already used a discount: ${conversation.discount_applied ? "YES — do NOT stack another discount on top." : "no, both still available."}

NEVER invent other discounts. NEVER drop price beyond the two levers above. If they still say no after both, hand off to a human or disqualify.

# HANDOFF TRIGGERS (immediately request a human)
End your reply with the literal token <<HANDOFF: reason>> if any of these are true:
- Customer asks specifically for a person, owner, manager
- Customer has a complaint, damage claim, refund request
- Customer wants to confirm a specific appointment time/date (humans schedule, you don't)
- Customer asks something you don't know (don't bullshit — hand off)
- Confused or contradictory replies after 2 attempts to clarify
- Customer is upset, hostile, or accusatory
- Customer indicates they're a vendor / sales pitch / spam
- Anything else outside the qualify→quote→close flow

Examples: "<<HANDOFF: customer wants to schedule a specific time>>", "<<HANDOFF: complaint about prior service>>".

# STOP / OPT-OUT
If the customer texts STOP, UNSUBSCRIBE, NO MORE, REMOVE ME, or similar — DO NOT REPLY at all. End your message with the literal token <<STOP>> and nothing else. The system will handle compliance.

# DISQUALIFY
If the customer is clearly not a buyer (out of service area, wrong service, joke/test message, can't afford even the floor price), end with <<DISQUALIFY: reason>>. Don't be rude — politely close out.

# WIN
If the customer commits to the job ("yes book it", "I'll take it", "let's do it", a day preference, any verbal yes), send a brief confirmation ("Perfect — you're on the schedule. Someone will call to confirm the time.") and end with <<HANDOFF: ready to book>>. You don't schedule exact times — a human confirms that.

# WHAT YOU KNOW ABOUT THIS LEAD
- Name: ${lead.full_name || "(unknown)"}
- Phone: ${lead.phone || "(unknown)"}
- Email: ${lead.email || "(unknown)"}
- Address: ${fullAddress}${leadServiceHint}
- Lead arrived: ${lead.created_at}
- Current lead status: ${lead.status}
- Conversation messages so far: ${conversation.total_messages}

# LEARNED FROM PAST CONVERSATIONS
${cfg.learned_notes ? `Key insights from successful closes:\n${cfg.learned_notes}\n` : ""}

# OUTPUT RULES
- Output ONLY the SMS text the customer should receive — no preamble, no quotes, no formatting markers.
- Append exactly ONE control token at the very end if applicable (<<HANDOFF: ...>>, <<STOP>>, <<DISQUALIFY: ...>>, <<WIN: ...>>). Otherwise no token.
- Keep replies under 320 characters when possible (2 SMS segments).
- Never use emoji unless the customer used one first.
- Never repeat yourself across messages — check the history.

Now reply to the customer's most recent message (or send the opening greet if there are no prior assistant messages).`;
}

function safeJsonArr(data: string | unknown[]): any[] {
  if (Array.isArray(data)) return data;
  if (typeof data === "string") {
    try {
      const v = JSON.parse(data);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}
function safeJsonObj(data: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof data === "object" && !Array.isArray(data) && data !== null) return data;
  if (typeof data === "string") {
    try {
      const v = JSON.parse(data);
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  }
  return {};
}

// ─── Control-token parsing ─────────────────────────────────────────────────────

interface ParsedReply {
  cleanText: string;
  controls: {
    handoff: string | null;
    stop: boolean;
    disqualify: string | null;
    win: string | null;
  };
}

function parseAssistantOutput(text: string): ParsedReply {
  const controls: ParsedReply["controls"] = { handoff: null, stop: false, disqualify: null, win: null };

  let clean = text;

  const handoffMatch = /<<HANDOFF:\s*([^>]+)>>/i.exec(clean);
  if (handoffMatch) {
    controls.handoff = handoffMatch[1].trim();
    clean = clean.replace(handoffMatch[0], "").trim();
  }

  if (/<<STOP>>/i.test(clean)) {
    controls.stop = true;
    clean = clean.replace(/<<STOP>>/gi, "").trim();
  }

  const dqMatch = /<<DISQUALIFY:\s*([^>]+)>>/i.exec(clean);
  if (dqMatch) {
    controls.disqualify = dqMatch[1].trim();
    clean = clean.replace(dqMatch[0], "").trim();
  }

  const winMatch = /<<WIN:\s*([^>]+)>>/i.exec(clean);
  if (winMatch) {
    controls.win = winMatch[1].trim();
    clean = clean.replace(winMatch[0], "").trim();
  }

  return { cleanText: clean, controls };
}

// ─── STOP keyword detection (deterministic, do not rely on LLM) ────────────────

function isStopKeyword(text: string): boolean {
  const t = text.trim().toUpperCase();
  if (!t) return false;
  // Twilio-recognized opt-out keywords
  const exacts = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "NO MORE", "REMOVE ME", "REMOVE"];
  return exacts.includes(t);
}

// ─── Public entrypoints ────────────────────────────────────────────────────────

interface RunResult {
  ok: boolean;
  reason?: string;
  reply?: string;
  handoff?: string | null;
  win?: string | null;
}

/**
 * Kick off the conversation when a brand-new FB lead arrives.
 * Sends Hayden's opening message.
 */
export async function kickoffConversationForNewLead(tenant: Tenant, lead: Lead): Promise<RunResult> {
  if (!lead.phone) {
    return { ok: false, reason: "lead has no phone" };
  }
  const onDnc = await isOnDNC(tenant.id, lead.phone);
  if (onDnc) {
    return { ok: false, reason: "phone is on DNC list" };
  }

  const cfg = await getAIConfig(tenant.id);
  if (!cfg || cfg.enabled !== true) {
    return { ok: false, reason: "AI disabled for tenant" };
  }

  const conversation = await getOrCreateConversation(tenant.id, lead.id);

  // Create Discord lead card + thread (skip if already has a thread from backfill)
  let discordThreadId: string | null = (lead as any).discord_thread_id ?? null;
  if (!discordThreadId) {
  try {
    discordThreadId = await notifyNewLeadDiscord(tenant.id, tenant.name ?? tenant.id, {
      leadId: lead.id,
      name: lead.full_name,
      phone: lead.phone,
      email: lead.email,
      homeSize: (lead.raw_payload as any)?.home_size ?? null,
      timeline: (lead.raw_payload as any)?.timeline ?? null,
    });
    if (discordThreadId) {
      await updateConversation(conversation.id, { discord_thread_id: discordThreadId } as any);
      await sql`UPDATE swell_leads SET discord_thread_id = ${discordThreadId} WHERE id = ${lead.id}`;
    }
  } catch (e: any) {
    console.error("[conversation] Discord lead card failed:", e?.message);
  }
  } // end if !discordThreadId

  // Store existing thread on conversation if lead already has one
  if ((lead as any).discord_thread_id && !(conversation as any).discord_thread_id) {
    await updateConversation(conversation.id, { discord_thread_id: (lead as any).discord_thread_id } as any).catch(() => {});
  }

  return runAssistantTurn(tenant, lead, conversation, cfg, /*incomingUserMsg*/ null, /*twilioSid*/ null);
}

/**
 * Handle an inbound SMS from a customer.
 * Maps the from-phone → lead → conversation, then runs Hayden's reply.
 */
export async function handleInboundSms(opts: {
  tenant: Tenant;
  lead: Lead;
  body: string;
  twilioSid?: string | null;
}): Promise<RunResult> {
  const { tenant, lead, body, twilioSid } = opts;
  const cfg = await getAIConfig(tenant.id);
  if (!cfg || cfg.enabled !== true) {
    return { ok: false, reason: "AI disabled" };
  }

  const conversation = await getOrCreateConversation(tenant.id, lead.id);

  // Hard STOP handling — do not call LLM.
  if (isStopKeyword(body)) {
    await insertConversationMessage({
      conversation_id: conversation.id,
      tenant_id: tenant.id,
      role: "user",
      body,
      twilio_sid: twilioSid ?? null,
      model_used: null, tokens_in: null, tokens_out: null, cost_cents: null, error: null,
    });
    await addToDNC(tenant.id, lead.phone || "", "STOP keyword");
    await cancelOpenNurtureForLead(lead.id);
    await updateConversation(conversation.id, {
      status: "stopped",
      handoff_reason: "stop_keyword",
      last_message_at: new Date().toISOString(),
      last_role: "user",
      total_messages: conversation.total_messages + 1,
    });
    await logActivity({
      lead_id: lead.id,
      tenant_id: tenant.id,
      type: "conversation_stopped",
      direction: "inbound",
      body: "Customer texted STOP — added to DNC, conversation halted.",
      metadata: { keyword: body.trim().toUpperCase() },
    });
    return { ok: true, reason: "stopped" };
  }

  // Log the inbound user message first so the assistant turn sees it.
  await insertConversationMessage({
    conversation_id: conversation.id,
    tenant_id: tenant.id,
    role: "user",
    body,
    twilio_sid: twilioSid ?? null,
    model_used: null, tokens_in: null, tokens_out: null, cost_cents: null, error: null,
  });

  // Mirror inbound to Discord
  const convForMirror = await getOrCreateConversation(tenant.id, lead.id);
  if ((convForMirror as any).discord_thread_id) {
    await mirrorSmsToThread((convForMirror as any).discord_thread_id, "user", body, lead.full_name).catch(() => {});
  }

  // Refresh totals
  const updated = {
    last_message_at: new Date().toISOString(),
    last_role: "user" as const,
    total_messages: conversation.total_messages + 1,
  };
  await updateConversation(conversation.id, updated);

  // Cancel any pending nurture jobs (customer just engaged — re-pull fresh)
  await cancelOpenNurtureForLead(lead.id);

  // Re-load conversation after update
  const fresh = await getOrCreateConversation(tenant.id, lead.id);

  // ── Handoff gate ──────────────────────────────────────────────────────────
  // If the conversation is paused for human handoff (or stopped), do NOT run
  // the AI. The inbound message was already logged + mirrored to Discord above
  // so the rep can see it. The rep must "Resume AI" to reactivate Hayden.
  if (fresh.status === "handoff" || fresh.status === "stopped") {
    return { ok: false, reason: `ai_paused_${fresh.status}` };
  }

  return runAssistantTurn(tenant, lead, fresh, cfg, body, twilioSid ?? null);
}

/**
 * Core assistant turn: call LLM, parse output, send SMS, schedule nurture.
 */
async function runAssistantTurn(
  tenant: Tenant,
  lead: Lead,
  conversation: Conversation,
  cfg: AIConfig,
  _incomingUserMsg: string | null,
  _twilioSidFromInbound: string | null
): Promise<RunResult> {
  // Hard cap: too many messages → force handoff
  if (conversation.total_messages >= cfg.max_msgs_per_lead) {
    updateConversation(conversation.id, { status: "handoff", handoff_reason: "msg_cap_reached" });
    logActivity({
      lead_id: lead.id, tenant_id: tenant.id,
      type: "conversation_handoff",
      direction: "internal",
      body: `Hit message cap (${cfg.max_msgs_per_lead}) — forced handoff.`,
      metadata: { reason: "msg_cap_reached" },
    });
    return { ok: false, reason: "msg_cap_reached", handoff: "msg_cap_reached" };
  }

  // Build prompt + history
  const slotBlock = await getSlotPromptBlock(tenant.id);
  const system = buildSystemPrompt({ tenant, cfg, lead, conversation, slotBlock });
  const history = await listConversationMessages(conversation.id);
  const messages: AnthropicMessage[] = history
    .filter((m) => m.role === "assistant" || m.role === "user")
    .map((m) => ({ role: m.role as "assistant" | "user", content: m.body }));

  // If this is the very first turn (kickoff), seed with a synthetic user message
  // so Anthropic has something to respond to.
  if (messages.length === 0) {
    messages.push({
      role: "user",
      content:
        `[INTERNAL: This is the first contact with this lead. They have not texted us. Send your opening greet per the script — Step 1 (greet + AI disclosure). Do not start with "Hi back" or assume a prior message.]`,
    });
  } else if (messages[messages.length - 1].role === "assistant") {
    // Anthropic requires the last message in `messages` to be from the user.
    // If our last logged message was from the assistant (e.g. on a nurture
    // follow-up turn), inject a synthetic user prod.
    messages.push({
      role: "user",
      content: "[INTERNAL: Continue the nurture sequence — the customer hasn't replied. Send the next appropriate follow-up per the flow.]",
    });
  }

  let assistantText = "";
  let tokensIn = 0;
  let tokensOut = 0;
  let costCents = 0;
  let modelUsed = cfg.model_primary;
  try {
    const result = await anthropicChat({
      model: cfg.model_primary,
      system,
      messages,
      maxTokens: cfg.max_tokens_per_msg,
      temperature: 0.45,
      tenantId: tenant.id,
    });
    assistantText = result.text;
    tokensIn = result.tokensIn;
    tokensOut = result.tokensOut;
    costCents = result.costCents;
    modelUsed = result.model;
  } catch (err: any) {
    await insertConversationMessage({
      conversation_id: conversation.id,
      tenant_id: tenant.id,
      role: "system",
      body: `Anthropic error: ${err?.message ?? err}`,
      twilio_sid: null, model_used: cfg.model_primary,
      tokens_in: null, tokens_out: null, cost_cents: null,
      error: String(err?.message ?? err),
    });
    await updateConversation(conversation.id, { status: "handoff", handoff_reason: "ai_error" });
    return { ok: false, reason: "ai_error", handoff: "ai_error" };
  }

  // Parse the assistant output (extract control tokens)
  const parsed = parseAssistantOutput(assistantText);

  // Sanity: if the LLM returned no usable text, hand off
  if (!parsed.cleanText && !parsed.controls.stop) {
    insertConversationMessage({
      conversation_id: conversation.id,
      tenant_id: tenant.id,
      role: "system",
      body: `LLM returned empty body. Raw: ${assistantText.slice(0, 400)}`,
      twilio_sid: null, model_used: modelUsed,
      tokens_in: tokensIn, tokens_out: tokensOut, cost_cents: costCents,
      error: "empty_assistant_output",
    });
    updateConversation(conversation.id, { status: "handoff", handoff_reason: "empty_output" });
    return { ok: false, reason: "empty_output", handoff: "empty_output" };
  }

  // STOP control → record + DNC + bail (do NOT send a reply)
  if (parsed.controls.stop) {
    addToDNC(tenant.id, lead.phone || "", "AI detected STOP intent");
    cancelOpenNurtureForLead(lead.id);
    updateConversation(conversation.id, {
      status: "stopped",
      handoff_reason: "stop_detected_by_ai",
      total_tokens_in: conversation.total_tokens_in + tokensIn,
      total_tokens_out: conversation.total_tokens_out + tokensOut,
      total_cost_cents: conversation.total_cost_cents + costCents,
    });
    return { ok: true, reason: "stopped" };
  }

  // Send SMS to lead
  let twilioSid: string | null = null;
  let smsError: string | null = null;
  if (lead.phone) {
    try {
      const smsResp = await sendSms(lead.phone, parsed.cleanText, tenant.twilio_from);
      twilioSid = (smsResp as any)?.sid ?? null;
      // Mirror to Discord thread
      const conv = await getOrCreateConversation(tenant.id, lead.id);
      if ((conv as any).discord_thread_id) {
        await mirrorSmsToThread((conv as any).discord_thread_id, "assistant", parsed.cleanText).catch(() => {});
      }
    } catch (err: any) {
      smsError = String(err?.message ?? err);
    }
  } else {
    smsError = "lead has no phone";
  }

  // Log the assistant message
  insertConversationMessage({
    conversation_id: conversation.id,
    tenant_id: tenant.id,
    role: "assistant",
    body: parsed.cleanText,
    twilio_sid: twilioSid,
    model_used: modelUsed,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_cents: costCents,
    error: smsError,
  });

  // Update conversation totals + state
  const totals = {
    total_messages: conversation.total_messages + 1,
    total_tokens_in: conversation.total_tokens_in + tokensIn,
    total_tokens_out: conversation.total_tokens_out + tokensOut,
    total_cost_cents: conversation.total_cost_cents + costCents,
    last_message_at: new Date().toISOString(),
    last_role: "assistant" as const,
  };

  // Mark discount used if the AI offered one (rough detection — looks for our two lever phrases)
  let discountApplied = conversation.discount_applied;
  if (!discountApplied && /\b(google review|5-star|five star|waive|transportation fee)\b/i.test(parsed.cleanText)) {
    discountApplied = true;
  }

  // Apply control-token state
  let newStatus = conversation.status;
  let handoffReason: string | null = conversation.handoff_reason;

  if (parsed.controls.handoff) {
    newStatus = "handoff";
    handoffReason = parsed.controls.handoff;
    // Nurture queue: cancel anything pending — humans take it from here
    await cancelOpenNurtureForLead(lead.id);
    await logActivity({
      lead_id: lead.id, tenant_id: tenant.id,
      type: "conversation_handoff",
      direction: "internal",
      body: `Handoff requested: ${parsed.controls.handoff}`,
      metadata: { reason: parsed.controls.handoff, lastReply: parsed.cleanText.slice(0, 280) },
    });
    // Notify Discord on handoff
    try {
      const msgs = await listConversationMessages(conversation.id);
      await notifyHandoffDiscord(
        tenant.id,
        tenant.id, // tenantName fallback; improve later
        {
          leadId: lead.id,
          name: lead.full_name,
          phone: lead.phone,
          email: lead.email,
          address: lead.address,
          city: lead.city,
          state: lead.state,
        },
        parsed.controls.handoff,
        msgs.map(m => ({ role: m.role, body: m.body ?? "" })),
      );
    } catch (discordErr: any) {
      console.error("[conversation] Discord handoff notify failed:", discordErr?.message);
    }
    // Flag the thread for human takeover
    if (conversation.discord_thread_id || (conversation as any).discord_thread_id) {
      const tid = (conversation as any).discord_thread_id;
      if (tid) {
        await mirrorSmsToThread(tid, "assistant", `🚨 **HANDOFF — Human needed**\nReason: ${parsed.controls.handoff}\n\n@here A rep can now reply in this thread to respond via SMS.`).catch(() => {});
      }
    }
  } else if (parsed.controls.win) {
    newStatus = "handoff";
    handoffReason = `win:${parsed.controls.win}`;
    await cancelOpenNurtureForLead(lead.id);
    await logActivity({
      lead_id: lead.id, tenant_id: tenant.id,
      type: "conversation_win",
      direction: "internal",
      body: `Customer ready to book: ${parsed.controls.win}`,
      metadata: { reason: parsed.controls.win },
    });
  } else if (parsed.controls.disqualify) {
    newStatus = "closed_lost";
    handoffReason = `disqualified:${parsed.controls.disqualify}`;
    await cancelOpenNurtureForLead(lead.id);
    await logActivity({
      lead_id: lead.id, tenant_id: tenant.id,
      type: "conversation_disqualified",
      direction: "internal",
      body: `Disqualified: ${parsed.controls.disqualify}`,
      metadata: { reason: parsed.controls.disqualify },
    });
  } else {
    // Schedule the next nurture if we're still in active flow.
    await scheduleNextNurture(tenant.id, lead.id, conversation.id, conversation.total_messages + 1);
  }

  // CAPI: fire InitiateCheckout when ready to book, ViewContent when quoted
  if (conversation.quoted_price_cents && conversation.quoted_price_cents > 0) {
    capiQuoted({
      tenantId: tenant.id, tenant,
      leadId: lead.id, phone: lead.phone, email: lead.email,
      quotedCents: conversation.quoted_price_cents,
    }).catch(() => {});
  }
  if (parsed.controls.handoff?.includes("ready to book") || parsed.controls.win) {
    capiReadyToBook({
      tenantId: tenant.id, tenant,
      leadId: lead.id, phone: lead.phone, email: lead.email,
      quotedCents: conversation.quoted_price_cents ?? undefined,
    }).catch(() => {});
  }

  // AI self-improvement: after a successful handoff/win, extract what worked
  if (parsed.controls.handoff?.includes("ready to book") || parsed.controls.win) {
    try {
      const msgs = await listConversationMessages(conversation.id);
      const transcript = msgs.map((m: any) => `${m.role}: ${m.body}`).join("\n").slice(0, 3000);
      const learnResult = await anthropicChat({
        model: "claude-haiku-4-5",
        system: "Extract one brief insight (max 2 sentences) about what worked in this sales conversation. Focus on objection handling, pricing tactics, or closing techniques. Be specific and actionable.",
        messages: [{ role: "user", content: `Conversation:\n${transcript}` }],
        maxTokens: 100,
        tenantId: tenant.id,
      });
      const insight = learnResult.text.trim();
      if (insight) {
        // Append to learned_notes
        await sql`
          UPDATE swell_ai_configs
          SET learned_notes = CASE
            WHEN learned_notes IS NULL OR learned_notes = '' THEN ${insight}
            ELSE learned_notes || E'\n' || ${insight}
          END
          WHERE tenant_id = ${tenant.id}
        `;
        console.log(`[learn] Insight saved for ${tenant.id}: "${insight.slice(0, 80)}"`);
      }
    } catch (e: any) {
      console.error("[learn] Failed to save insight:", e?.message);
    }
  }

  await updateConversation(conversation.id, {
    ...totals,
    status: newStatus,
    handoff_reason: handoffReason,
    discount_applied: discountApplied,
  });

  // ── Auto-extract address, price, tech notes ──────────────────────────────
  // Fire at handoff, win, disqualify, or whenever a price was quoted.
  // Fire-and-forget — never blocks the reply.
  const shouldExtract =
    parsed.controls.handoff ||
    parsed.controls.win ||
    parsed.controls.disqualify ||
    (conversation.quoted_price_cents && conversation.quoted_price_cents > 0);

  if (shouldExtract) {
    listConversationMessages(conversation.id)
      .then(msgs =>
        extractAndSyncLeadData({
          tenantId: tenant.id,
          leadId: lead.id,
          conversationId: conversation.id,
          messages: msgs.map((m: any) => ({ role: m.role, body: m.body ?? "" })),
        })
      )
      .catch((e: any) => console.error("[extractor] SMS extraction error:", e?.message));
  }

  return { ok: true, reply: parsed.cleanText, handoff: parsed.controls.handoff, win: parsed.controls.win ?? null };
}

// ─── Nurture sequence ──────────────────────────────────────────────────────────
// Pattern: after every assistant message that didn't elicit a handoff, queue
// the next nudge. Cancelled the moment the customer replies.

const NURTURE_INTERVALS_MS: Record<string, number> = {
  followup_quote:    1  * 60 * 60 * 1000,   // 1h after assistant message → "still want me to lock that route slot?"
  followup_recovery: 24 * 60 * 60 * 1000,   // 24h with discount nudge
  last_chance:       72 * 60 * 60 * 1000,   // 72h — final pitch
  cold_revive:       7  * 24 * 60 * 60 * 1000, // 7d — last try
};

async function scheduleNextNurture(tenantId: string, leadId: number, conversationId: number, msgCount: number) {
  // Pick the next step based on how many assistant turns we've already done.
  // 1 assistant message → schedule followup_quote (1h)
  // 2 assistant messages → schedule followup_recovery (24h from now)
  // 3 assistant messages → schedule last_chance (72h from now)
  // 4+ assistant messages → schedule cold_revive (7d) once, then stop
  let kind: keyof typeof NURTURE_INTERVALS_MS;
  if (msgCount <= 1) kind = "followup_quote";
  else if (msgCount === 2) kind = "followup_recovery";
  else if (msgCount === 3) kind = "last_chance";
  else if (msgCount === 4) kind = "cold_revive";
  else return; // stop nurturing

  const fireAt = new Date(Date.now() + NURTURE_INTERVALS_MS[kind]).toISOString();
  await scheduleNurture({
    tenant_id: tenantId,
    lead_id: leadId,
    conversation_id: conversationId,
    kind,
    fire_at: fireAt,
    payload: { msgCount } as Record<string, unknown>,
  });
}

/**
 * Fire a single nurture job. Called by the cron loop.
 */
export async function fireNurtureJob(opts: {
  tenant: Tenant;
  lead: Lead;
  conversationId: number;
  kind: string;
}) {
  const { tenant, lead, conversationId, kind } = opts;
  const cfg = await getAIConfig(tenant.id);
  if (!cfg || cfg.enabled !== true) {
    return { ok: false, reason: "AI disabled" };
  }
  const onDnc = lead.phone ? await isOnDNC(tenant.id, lead.phone) : false;
  if (!lead.phone || onDnc) {
    return { ok: false, reason: "phone DNC or missing" };
  }

  // Re-load fresh conversation
  const conversation = await getOrCreateConversation(tenant.id, lead.id);
  if (conversation.id !== conversationId) {
    return { ok: false, reason: "conversation mismatch" };
  }
  if (conversation.status !== "active") {
    return { ok: false, reason: `conversation status=${conversation.status}` };
  }

  // If the customer has replied since this job was queued, skip — cancelOpenNurtureForLead
  // should have already pruned, but extra safety:
  if (conversation.last_role === "user") {
    return { ok: false, reason: "customer replied first" };
  }

  // Inject a system note into the conversation transcript so the LLM knows
  // what *kind* of follow-up this is. We log it as a "system" role message,
  // but pass it as a synthetic "user" prod inside runAssistantTurn so
  // Anthropic accepts it.
  const nudgeMap: Record<string, string> = {
    followup_quote:    "Follow-up step 1 (1h): customer hasn't replied since you quoted them. Re-pitch the route slot — short, direct, scarcity. Don't quote again, just nudge them to lock it.",
    followup_recovery: "Follow-up step 2 (24h): still no reply. Use ONE save-the-sale lever — review pledge ($" + cfg.review_discount + " off). Don't beg, frame as a one-time offer.",
    last_chance:       "Follow-up step 3 (72h): still no reply. Use the OTHER lever — waive the $" + cfg.transport_waive + " transport fee. Make it clear this is the last time you'll reach out about this route.",
    cold_revive:       "Follow-up step 4 (7d): cold revive. Short, casual, non-salesy — just check if they're still interested. Don't quote.",
  };

  await insertConversationMessage({
    conversation_id: conversation.id,
    tenant_id: tenant.id,
    role: "system",
    body: nudgeMap[kind] || `Follow-up: ${kind}`,
    twilio_sid: null, model_used: null, tokens_in: null, tokens_out: null, cost_cents: null, error: null,
  });

  return runAssistantTurn(tenant, lead, conversation, cfg, null, null);
}

// Lookup helper used by webhook + cron
export async function loadLeadForTenant(tenantId: string, leadId: number): Promise<Lead | undefined> {
  return getLeadByIdForTenant(tenantId, leadId);
}
