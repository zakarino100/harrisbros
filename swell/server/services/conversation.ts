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
import { geocodeAddress } from "./geocoder.js";

// ── Haversine distance (miles) ─────────────────────────────────────────────────
function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface ServiceHub { city: string; lat: number; lon: number; radius_miles?: number; }

function checkServiceArea(
  leadLat: number, leadLon: number,
  hubs: ServiceHub[],
  defaultRadiusMiles = 30,
): { inArea: boolean; nearestHub: string; distanceMiles: number } {
  let nearest = hubs[0];
  let minDist = Infinity;
  for (const hub of hubs) {
    const d = haversineMiles(leadLat, leadLon, hub.lat, hub.lon);
    if (d < minDist) { minDist = d; nearest = hub; }
  }
  const radius = nearest?.radius_miles ?? defaultRadiusMiles;
  return { inArea: minDist <= radius, nearestHub: nearest?.city ?? "unknown", distanceMiles: Math.round(minDist) };
}

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

  // Service area check ────────────────────────────────────────────────
  const hubs = safeJsonArr((cfg as any).service_area_hubs_json) as ServiceHub[];
  let serviceAreaNote = "";
  if (hubs.length > 0 && (lead as any).address_lat && (lead as any).address_lon) {
    const check = checkServiceArea((lead as any).address_lat, (lead as any).address_lon, hubs);
    if (check.inArea) {
      serviceAreaNote = `\n- ✅ Service area: YES — ${check.distanceMiles} miles from ${check.nearestHub} (within coverage)`;
    } else {
      serviceAreaNote = `\n- ❌ Service area: OUT OF RANGE — ${check.distanceMiles} miles from nearest hub (${check.nearestHub}). DISQUALIFY politely. Tell them you don\'t service this area but thank them for reaching out.`;
    }
  }
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
- NEVER use "Quick question" or "Quick question:" — it sounds scripted and salesy. Just ask the question directly.
- NEVER use double dashes (— or --) in messages. Use commas, periods, or just a new sentence.
- Always write "I'm reaching out" not "Reaching out" — it reads more human.

# THE CONVERSATION FLOW
This is the script you follow when a fresh lead comes in. Adapt to the customer's actual replies — don't be rigid, but ALWAYS hit these beats in order unless the customer pre-empts one.

1. **Greet** — "Hi [name], this is Hayden with ${businessName}. I'm reaching out about your [service] inquiry."
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
- Address: ${fullAddress}${leadServiceHint}${serviceAreaNote}
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

interface ParsedReply {
  cleanText: string;
  delayedText: string | null;   // text after <<HOLD>> — sent 3 min later
  controls: {
    handoff: string | null;
    stop: boolean;
    disqualify: string | null;
    win: string | null;
  };
}

function parseAssistantOutput(text: string): ParsedReply {
  const controls: ParsedReply["controls"] = { handoff: null, stop: false, disqualify: null, win: null };

  // Split on <<HOLD>> — part before is the holding message, part after is the delayed quote
  let delayedText: string | null = null;
  let clean = text;
  const holdIdx = text.search(/<<HOLD>>/i);
  if (holdIdx !== -1) {
    clean = text.slice(0, holdIdx).trim();
    delayedText = text.slice(holdIdx + "<<HOLD>>".length).trim() || null;
  }


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

  return { cleanText: clean, delayedText, controls };
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

  // Geocode lead address if not already done, then check service area
  if (!(lead as any).address_lat && lead.address) {
    try {
      const geo = await Promise.race([
        geocodeAddress(lead.address, lead.city, lead.state, lead.zip),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 4000)),
      ]);
      if (geo) {
        await sql`
          UPDATE swell_leads
          SET address_lat = ${geo.lat}, address_lon = ${geo.lon}
          WHERE id = ${lead.id}
        `;
        (lead as any).address_lat = geo.lat;
        (lead as any).address_lon = geo.lon;
      }
    } catch { /* non-blocking */ }
  }

  // If we have lat/lon + service area hubs, store in_service_area on lead
  const hubs = safeJsonArr((cfg as any).service_area_hubs_json) as ServiceHub[];
  if (hubs.length > 0 && (lead as any).address_lat && (lead as any).address_lon) {
    const check = checkServiceArea((lead as any).address_lat, (lead as any).address_lon, hubs);
    await sql`UPDATE swell_leads SET in_service_area = ${check.inArea} WHERE id = ${lead.id}`.catch(() => {});
    (lead as any).in_service_area = check.inArea;
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

  // ── Natural typing delay ───────────────────────────────────────────────────────
  // Simulate human typing speed (~5 chars/sec) so Hayden doesn’t feel
  // like an instant bot. Min 2s, max 7s, with a small random jitter.
  // Skip delay on <<HOLD>> holding messages (those already have a 3-min wait).
  if (!parsed.delayedText) {
    const charCount = parsed.cleanText.length;
    const typingMs = Math.max(2000, Math.min(7000, charCount * 50 + Math.random() * 1500));
    await new Promise(resolve => setTimeout(resolve, typingMs));
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

    // ── Delayed quote: if Hayden used <<HOLD>>, send the quote message after 3 minutes ──
    if (parsed.delayedText && lead.phone) {
      const delayMs = 3 * 60 * 1000; // 3 minutes
      const delayedBody = parsed.delayedText;
      const phoneNum = lead.phone;
      const fromNum = tenant.twilio_from;
      const convId = conversation.id;
      const tenantId = tenant.id;
      const discordThreadId = (conversation as any).discord_thread_id ?? null;

      setTimeout(async () => {
        try {
          const sid = await sendSms(phoneNum, delayedBody, fromNum);
          await insertConversationMessage({
            conversation_id: convId,
            tenant_id: tenantId,
            role: "assistant",
            body: delayedBody,
            twilio_sid: (sid as any)?.sid ?? null,
            model_used: modelUsed,
            tokens_in: null, tokens_out: null, cost_cents: null, error: null,
          });
          await updateConversation(convId, {
            last_message_at: new Date().toISOString(),
            last_role: "assistant" as const,
          });
          if (discordThreadId) {
            await mirrorSmsToThread(discordThreadId, "assistant", delayedBody).catch(() => {});
          }
          console.log(`[conversation] Delayed quote sent for conv ${convId}`);
        } catch (err: any) {
          console.error(`[conversation] Delayed quote failed for conv ${convId}:`, err?.message);
        }
      }, delayMs);
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

  // Update A/B variant outcome: booked on ready-to-book, closed on disqualify
  if (parsed.controls.handoff?.includes("ready to book") || parsed.controls.win) {
    try {
      await sql`
        UPDATE swell_ab_variants
        SET outcome = 'booked', outcome_at = NOW()
        WHERE tenant_id = ${tenant.id} AND lead_id = ${lead.id} AND variant_group = 'nurture_sequence'
      `;
    } catch (e: any) {
      console.error("[ab-variant] Failed to mark booked:", e?.message);
    }
  } else if (parsed.controls.disqualify) {
    try {
      await sql`
        UPDATE swell_ab_variants
        SET outcome = 'closed', outcome_at = NOW()
        WHERE tenant_id = ${tenant.id} AND lead_id = ${lead.id} AND variant_group = 'nurture_sequence' AND outcome IS NULL
      `;
    } catch (e: any) {
      console.error("[ab-variant] Failed to mark closed:", e?.message);
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
  touch_1h:   1  * 60 * 60 * 1000,         // 1h  — quick check-in, assume they got busy
  touch_6h:   6  * 60 * 60 * 1000,         // 6h  — route/scarcity angle
  touch_24h:  24 * 60 * 60 * 1000,         // 24h — direct close attempt, ask the question again
  touch_48h:  48 * 60 * 60 * 1000,         // 48h — value + urgency
  touch_72h:  72 * 60 * 60 * 1000,         // 72h — last push this week + first discount lever
  touch_7d:   7  * 24 * 60 * 60 * 1000,    // 7d  — cold revive, fresh angle
  touch_14d:  14 * 24 * 60 * 60 * 1000,    // 14d — final shot, offer out
};

async function scheduleNextNurture(tenantId: string, leadId: number, conversationId: number, msgCount: number) {
  // 7-touch sequence keyed on how many assistant turns we've done.
  // Touch 1 (1h), 2 (6h), 3 (24h), 4 (48h), 5 (72h), 6 (7d), 7 (14d) — then stop.
  const sequence: Array<keyof typeof NURTURE_INTERVALS_MS> = [
    "touch_1h", "touch_6h", "touch_24h", "touch_48h", "touch_72h", "touch_7d", "touch_14d",
  ];
  const kind = sequence[msgCount - 1]; // msgCount is # of assistant turns so far
  if (!kind) return; // exhausted all touches

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
  // Hormozi/Cardone-style nurture. Assume the sale. Scarcity-led. Never needy.
  const nudgeMap: Record<string, string> = {
    touch_1h:
      "TOUCH 1 (1h — no reply yet). They filled out the form — they want this. " +
      "Keep it short and breezy, not pushy. Just checking back in — assume they got busy. " +
      "Do NOT re-quote or re-pitch the service. Something like: \"Hey [name], just checking back in — still want to get on the schedule this week?\" " +
      "One sentence. Wait for their response.",

    touch_6h:
      "TOUCH 2 (6h — still no reply). Lead the scarcity angle — you're building the route and their spot is open but won't stay that way. " +
      "Frame it as doing them a favor by checking: \"Finishing up the route card for your area this week. Want to hold your spot before it fills up?\" " +
      "Short. Confident. Not desperate.",

    touch_24h:
      "TOUCH 3 (24h — still nothing). Go back to closing. Come in direct like you're starting fresh. " +
      "If you have their address from the lead info, USE IT — do NOT ask for it again. " +
      "Short re-open: confirm the address or just go straight to the qualifying question (number of windows for window cleaning, sqft for pressure washing). " +
      "Example: \"Hey [name] — still want to get those windows done at [address]? How many windows does the home have?\" " +
      "Assume they want it. Be direct. One or two sentences max.",

    touch_48h:
      "TOUCH 4 (48h). Value-stack and urgency without begging. Remind them what they're getting for the price — full service, same-trip efficiency, quality work. " +
      "Close with a forced A/B: \"We're booking up your area for the week. Does [Day A] or [Day B] work better for you?\" " +
      "Pick two real days. Force the choice. Do not say 'whenever works for you'.",

    touch_72h:
      "TOUCH 5 (72h). Last push this week. Now you can drop the FIRST discount lever ($" + cfg.review_discount + " off for a 5-star Google review after the job). " +
      "Frame as a perk, not a desperation move: \"Still have your spot open. If you book this week I can knock $" + cfg.review_discount + " off if you leave us a quick Google review after — a lot of our customers do. Does [Day] or [Day] work?\" " +
      "Make them feel like they're getting a deal, not that you're chasing them.",

    touch_7d:
      "TOUCH 6 (7 days — cold revive). New angle, fresh energy. Don't reference the previous messages. " +
      "Come in like you're just now thinking of them: \"Hey [name] — Hayden with [business]. We've got a route coming back through your area in a couple weeks. Still want to get it taken care of?\" " +
      "Short. Casual. No pressure framing. Wait for response.",

    touch_14d:
      "TOUCH 7 (14 days — final shot). This is your last message. Be direct and give them a clean out so you end strong: " +
      "\"Last one from me — we're building out next month's route for your area. If you still want to get it done, just reply and I'll lock you in. If the timing's not right, no worries — I'll take you off my list.\" " +
      "Drop the second discount lever only if it feels right ($" + cfg.transport_waive + " transport waive). Don't beg. End clean.",
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
