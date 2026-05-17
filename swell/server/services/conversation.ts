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
import { notifyNewLeadDiscord, mirrorSmsToThread, notifyHandoffDiscord, notifyBookingDiscord, dmZak, postToThread, notifyLeadRepliedWhilePaused } from "./discord.js";
import { preSendGuard } from "./pre-send-guard.js";
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
    } else if (check.distanceMiles <= 10) {
      // Within 10 miles — escalate to owner instead of auto-disqualifying
      serviceAreaNote = `\n- ⚠️ Service area: BORDERLINE — ${check.distanceMiles} miles from ${check.nearestHub} (just outside normal coverage). HOLD — do NOT disqualify yet. Tell them: "Let me check with the team on your area — I'll have an answer for you within the hour." Then output <<HANDOFF: borderline_service_area — ${check.distanceMiles} miles from ${check.nearestHub}, owner approval needed>>`;
      // Fire async Discord notification to owner
      notifyOwnerBorderlineArea({
        tenantId:   tenant.id,
        tenantName: (tenant as any).name ?? tenant.id,
        lead,
        distanceMiles: check.distanceMiles,
        nearestHub:    check.nearestHub,
      }).catch((e: any) => console.error("[borderline-area]", e?.message));
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

  const personaName = cfg.persona_name || "Hayden";

  // ─── RECEPTIONIST MODE: completely different prompt, no quoting/pricing ────
  if ((cfg as any).mode === "receptionist") {
    const fullAddress = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ") || "(unknown — ask for it)";
    const leadName = lead.full_name?.split(' ')[0] || "there";

    // Parse known data from FB form field_data in raw_payload
    const rawPayload = (lead.raw_payload as any) ?? {};
    const fieldData: Array<{name: string; values: string[]}> = rawPayload.field_data ?? [];
    const formFields: Record<string, string> = {};
    for (const f of fieldData) { formFields[f.name] = f.values?.[0] ?? ""; }

    const serviceHint = "house wash"; // always house wash for MackWash ads
    const knownHomeSize: string = formFields["approximate_home_size?"] || formFields["approximate_home_size"] || formFields["square_footage"] || "";
    const knownTimeline: string = formFields["when_are_you_looking_to_get_this_done?"] || formFields["timeline"] || "";

    // Format for readability
    const homeSizeClean = knownHomeSize.replace(/_/g, " ").replace(/–/g, "–");
    const timelineClean = knownTimeline.replace(/_/g, " ").replace(/\//g, " /");

    // Build context block of what we already know — don't ask for these again
    const alreadyKnown = [
      knownHomeSize ? `- Home size: ${homeSizeClean}` : "",
      knownTimeline ? `- Timeline: ${timelineClean}` : "",
    ].filter(Boolean).join("\n");

    return `You are ${personaName}, an intake coordinator for ${businessName}. You communicate via SMS only.

# WHO YOU ARE
- Name: ${personaName}. Introduce yourself on the very first message.
- You are the intake desk, NOT a closer. Your ONLY job: collect info, hand off to a human rep for the quote.
- Never say you're an AI or bot. If asked directly, deflect: "I'm ${personaName} with ${businessName} — let me get you taken care of."

# VOICE
- Friendly, warm, professional. One question at a time. Never stack multiple questions in one message.
- Short messages. No fluff, no filler phrases like "just checking in" or "hope you're doing well".
- Never use dashes (— or --). Use a comma or start a new sentence instead.

# WHAT YOU ALREADY KNOW (from their form — do NOT ask again)
- Service: ${serviceHint}
${alreadyKnown || "- (no additional form data)"}

# YOUR FLOW — only 2 questions needed, then hand off
1. GREET: "Hi${leadName !== "there" ? ` ${leadName}` : ""}! This is ${personaName} with MackWash. I saw your inquiry about a house wash${knownTimeline ? ` and you\'re looking to get it done ${timelineClean}` : ""}. Has it been more or less than a year since it was last done?"
2. LAST SERVICE: Acknowledge their answer briefly ("Got it" or "Perfect"), then ask the one thing you still need:
3. ADDRESS: "What\'s the service address?"
4. WRAP UP: Once you have address and last-done date, send exactly: "Perfect — I have everything I need. Someone from the team will reach out shortly with your exact estimate." Then output: <<HANDOFF: info_complete>>

That\'s it — 2 questions max before handoff. Do not ask about home size (already known from form) or timeline (already known). If they volunteer extra info, great, but don\'t fish for it.

# WHAT YOU NEVER DO
- NEVER give a price, estimate, or dollar amount of any kind
- NEVER mention discounts, promos, or "deals"
- NEVER make or imply a specific appointment time
- NEVER say "I'll email you" — SMS only
- NEVER ask "Are you ready to book?" or "Would you like to schedule?" — that's the rep's job

# IF THEY ASK FOR PRICE
Say: "Prices vary based on the specifics — I want to make sure you get an exact quote for your property. Someone will reach out with that shortly."

# HANDOFF TRIGGERS (output <<HANDOFF: reason>> and nothing more after your reply)
- You've collected all 5 info points above → <<HANDOFF: info_complete>>
- Customer asks for owner, manager, or a specific person → <<HANDOFF: customer_requests_human>>
- Customer has a complaint or issue → <<HANDOFF: complaint>>
- Anything outside your intake scope (pricing, scheduling, complaints) → <<HANDOFF: outside_scope>>

# STOP / OPT-OUT
If customer texts STOP, UNSUBSCRIBE, or similar: DO NOT REPLY. End with <<STOP>> only.

# WHAT YOU KNOW ABOUT THIS LEAD
- Name: ${lead.full_name?.split(" ")[0] || "(unknown)"}
- Phone: ${lead.phone || "(unknown)"}
- Address: ${fullAddress}
- Lead arrived: ${lead.created_at}
- Messages so far: ${conversation.total_messages}

# OUTPUT RULES
- Output ONLY the SMS text the customer receives. No preamble, no quotes, no formatting.
- Append exactly ONE control token at the very end if applicable (<<HANDOFF: ...>> or <<STOP>>). Otherwise no token.
- Keep replies under 320 characters (2 SMS segments).
- No emoji unless the customer used one first.
- Never repeat yourself — check history before replying.

Now reply to the customer's most recent message, or send the opening greeting if no prior messages exist.

CRITICAL: Never output meta-commentary, instructions, or notes about the conversation. Never say things like "I need to clarify" or "I should only respond when". You are Hayden — always stay in character and respond directly to the customer.`;
  }
  // ─────────────────────────────────────────────────────────────────────────────



  // Persona override block — injected when custom_brand_notes is set.
  // Comes right after WHO YOU ARE so explicit overrides supersede the default flow.
  const personaOverrideBlock = cfg.custom_brand_notes
    ? `\n\n# PERSONA & BRAND OVERRIDE\n${cfg.custom_brand_notes}`
    : "";

  return `You are ${personaName}, a sales representative for ${businessName}. You communicate via SMS only.

# WHO YOU ARE
- Name: ${personaName}. Always introduce yourself as ${personaName} on the very first message.
- You are a sales rep for ${businessName}. Never say you are an AI, a bot, or automated.
- If asked directly whether you're a human or AI, deflect naturally: "I'm ${personaName} with ${businessName} — what can I help you with?"
- Be direct, friendly, professional.${personaOverrideBlock}

# VOICE — NON-NEGOTIABLE
The goal is direct, simple, quick. Every word earns its place or gets cut.
- Short. 1-2 sentences per reply. 3 max. If you can say it in fewer words, say fewer words.
- One thing per message. One question. One point. Move the sale forward.
- No setup phrases, no throat-clearing. Start with the thing you need to say.
- Specific numbers, not vague ranges.
- Scarcity framing: "I have a route in your area next week" not "we could probably come out sometime."
- Never ask permission: "What's the address?" not "May I have the address?"
- Stack value before price: "covers all the siding, trim, soffit, eaves, and windows. $370."
- Friendly but not pushy. You're a busy pro, not a telemarketer.
- NEVER say "Quick question" — just ask the question.
- NEVER use dashes (— or --) — use a comma or start a new sentence.
- NEVER write "Reaching out" as a fragment — always "I'm reaching out".
- NEVER say "no problem", "sorry to bother you", "just checking in", "hope you're doing well", or any filler phrase.

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
- Customer asks something you don't know, you're unsure about pricing/scope/availability, or anything not explicitly covered in your instructions — respond with "One second, I can get that for you." and end with <<HANDOFF: unsure — needs human>>. NEVER guess or make something up.
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
- Name: ${lead.full_name?.split(" ")[0] || "(unknown)"}
- Phone: ${lead.phone || "(unknown)"}
- Email: ${lead.email || "(unknown)"}
- Address: ${fullAddress}${leadServiceHint}${serviceAreaNote}
- Lead arrived: ${lead.created_at}
- Current lead status: ${lead.status}
- Conversation messages so far: ${conversation.total_messages}

# LEARNED FROM PAST CONVERSATIONS
${cfg.learned_notes ? `Key insights from past conversations:\n${cfg.learned_notes}\n` : ""}

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

  // ── Already-started guard ──────────────────────────────────────────────────
  // If this lead already has an active conversation with messages, don't
  // kick off again. This prevents the hourly sync from double-scheduling
  // nurture jobs when a lead was already contacted via backfill or test.
  const existingConv = await getOrCreateConversation(tenant.id, lead.id);
  if ((existingConv as any).total_messages > 0) {
    return { ok: false, reason: "conversation already started" };
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

  // Create Discord lead card + thread (skip if already has a thread, or if it's a test lead)
  const isTestLead = (lead as any).status === "test";
  let discordThreadId: string | null = (lead as any).discord_thread_id ?? null;
  if (!discordThreadId && !isTestLead) {
  try {
    discordThreadId = await notifyNewLeadDiscord(tenant.id, tenant.name ?? tenant.id, {
      leadId: lead.id,
      name: lead.full_name,
      phone: lead.phone,
      email: lead.email,
      homeSize: (() => { const fd: any[] = (lead.raw_payload as any)?.field_data ?? []; const f = fd.find((x: any) => /approximate_home_size/i.test(x.name)); return f?.values?.[0] ?? null; })(),
      timeline: (() => { const fd: any[] = (lead.raw_payload as any)?.field_data ?? []; const f = fd.find((x: any) => /when_are_you_looking/i.test(x.name)); return f?.values?.[0] ?? null; })(),
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

  // ── A/B template opener for receptionist mode ───────────────────────────────
  // Bypasses the LLM entirely for the first message — saves cost + ensures
  // exact copy. Variant driven by nurture_variant (assigned 50/50 at creation).
  if ((cfg as any).mode === 'receptionist') {
    const variant = ((conversation as any).nurture_variant ?? 'A') as 'A' | 'B';
    const firstName = lead.full_name?.split(' ')[0] ?? lead.full_name ?? 'there';
    const openerTemplates: Record<'A' | 'B', string> = {
      A: `Hi [name]! This is Hayden with Mack Wash. I'm reaching out regarding your house wash inquiry. I know you said you're just looking to get prices for now - I can help with that. Has it been more or less than a year since it was last done?`,
      B: `Hey [name]! Hayden here with Mack Wash — saw your inquiry about a house wash. Quick question to get you pointed in the right direction: has it been more or less than a year since the last wash?`,
    };
    const openerText = openerTemplates[variant].replace(/\[name\]/gi, firstName);

    const guard = preSendGuard({ message: openerText, mode: 'receptionist', isDnc: false });
    if (!guard.ok) {
      console.error(`[opener] guard blocked: ${guard.reason}`);
      return { ok: false, reason: guard.reason };
    }

    // Natural typing delay before sending
    const typingMs = Math.max(2000, Math.min(5000, openerText.length * 40 + Math.random() * 1000));
    await new Promise(resolve => setTimeout(resolve, typingMs));

    try {
      const sid = await sendSms(lead.phone, openerText, tenant.twilio_from);
      await insertConversationMessage({
        conversation_id: conversation.id,
        tenant_id: tenant.id,
        role: 'assistant',
        body: openerText,
        twilio_sid: (sid as any)?.sid ?? null,
        model_used: `opener-template-${variant}`,
        tokens_in: null, tokens_out: null, cost_cents: 0, error: null,
      });
      await updateConversation(conversation.id, {
        last_message_at: new Date().toISOString(),
        last_role: 'assistant' as const,
        total_messages: 1,
      });
      // Mirror to Discord thread
      const threadId = (conversation as any).discord_thread_id ?? (lead as any).discord_thread_id ?? null;
      if (threadId) {
        await mirrorSmsToThread(threadId, 'assistant', openerText, null, null, true).catch(() => {});
      }
      // Schedule all nurture touches upfront
      await scheduleReceptionistNurture(tenant.id, lead.id, conversation.id);
      console.log(`[opener] sent ${variant} template to ${lead.phone} (conv ${conversation.id})`);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, reason: err?.message ?? String(err) };
    }
  }
  // ── end receptionist opener ──────────────────────────────────────────────────

  return runAssistantTurn(tenant, lead, conversation, cfg, /*incomingUserMsg*/ null, /*twilioSid*/ null);
}

/**
 * Handle an inbound SMS from a customer.
 * Maps the from-phone → lead → conversation, then runs Hayden's reply.
 */
// ─── MMS image analysis ──────────────────────────────────────────────────────
// If the body contains [Customer sent N photo(s): url1, url2], fetch and analyze
// them with Anthropic vision and return a description to enrich the conversation.
async function analyzeMediaUrls(rawBody: string, tenantId: string): Promise<string> {
  const match = rawBody.match(/\[Customer sent \d+ photo\(s\): (.+?)\]/);
  if (!match) return rawBody;
  const urls = match[1].split(", ").filter(Boolean);
  const textPart = rawBody.replace(/\[Customer sent.+?\]/, "").trim();
  try {
    const { TWILIO_ACCOUNT_SID: acct, TWILIO_AUTH_TOKEN: auth } = process.env;
    const imageBlocks: any[] = [];
    for (const url of urls.slice(0, 3)) { // max 3 images
      try {
        const resp = await fetch(url, {
          headers: { Authorization: "Basic " + Buffer.from(`${acct}:${auth}`).toString("base64") },
        });
        if (!resp.ok) continue;
        const buf = await resp.arrayBuffer();
        const b64 = Buffer.from(buf).toString("base64");
        const ct = resp.headers.get("content-type") ?? "image/jpeg";
        imageBlocks.push({ type: "image", source: { type: "base64", media_type: ct, data: b64 } });
      } catch { continue; }
    }
    if (!imageBlocks.length) return rawBody;
    const visionRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 300,
        system: "You are analyzing customer photos for a pressure washing / exterior cleaning company. Describe what you see in 2-3 sentences: property type, surfaces visible (siding, steps, driveway, deck, etc.), visible dirt/algae/staining, and anything that affects the scope or price of cleaning.",
        messages: [{ role: "user", content: [
          ...imageBlocks,
          { type: "text", text: textPart || "Describe this property for a cleaning quote." },
        ]}],
      }),
    });
    const visionData = await visionRes.json() as any;
    const result = { text: visionData?.content?.[0]?.text ?? "" };
    const desc = result.text.trim();
    console.log(`[conversation] MMS image analysis: ${desc.slice(0, 100)}`);
    const enriched = (textPart ? textPart + "\n" : "") + `[Photo analysis: ${desc}]`;
    return enriched;
  } catch (e: any) {
    console.error("[conversation] MMS analysis error:", e?.message);
    return rawBody;
  }
}

export async function handleInboundSms(opts: {
  tenant: Tenant;
  lead: Lead;
  body: string;
  twilioSid?: string | null;
}): Promise<RunResult> {
  const { tenant, lead, twilioSid } = opts;
  // Analyze any MMS photo attachments before logging/responding
  const body = await analyzeMediaUrls(opts.body, tenant.id);

  // ─── Owner detection: if the inbound number is the tenant’s contact phone, route to owner mode ───
  if (tenant.contact_phone && lead.phone === tenant.contact_phone) {
    return handleOwnerSms({ tenant, body, twilioSid: twilioSid ?? null });
  }

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
    // Notify Mack — lead replied while AI is off
    const threadId = (fresh as any).discord_thread_id ?? null;
    const ownerDiscordId = (tenant as any).owner_discord_user_id ?? process.env.MACKWASH_OWNER_DISCORD_USER_ID ?? "1327340335675736125";
    notifyLeadRepliedWhilePaused({
      tenantId: tenant.id,
      threadId,
      leadName: lead.full_name ?? lead.phone ?? "Unknown",
      message: body,
      ownerDiscordId,
    }).catch((e: any) => console.error("[conv] notifyLeadRepliedWhilePaused failed:", e?.message));
    return { ok: false, reason: `ai_paused_${fresh.status}` };
  }

  // ── Manual AI pause gate (per-lead toggle by rep) ─────────────────────────
  if ((fresh as any).ai_paused === true) {
    // Notify Discord: paused lead just replied — rep needs to assess
    const threadId = (fresh as any).discord_thread_id ?? null;
    const mackDiscordId = process.env.MACKWASH_OWNER_DISCORD_ID ?? "1327340335675736125";
    const zakDiscordId = process.env.DISCORD_ZAK_USER_ID ?? "1385472518978011266";
    const leadsChannelId = process.env[`${tenant.id.toUpperCase()}_DISCORD_LEADS_CHANNEL_ID`] ?? "";
    const discordToken = process.env.DISCORD_BOT_TOKEN ?? "";
    const pingMsg = `⚠️ **Paused lead replied** — needs review\n👤 **${lead.full_name || lead.phone}** just texted back: "${body.slice(0, 200)}"\n\n<@${mackDiscordId}> <@${zakDiscordId}> — AI is still paused. Review in CRM and re-enable AI manually when ready.`;
    if (leadsChannelId && discordToken) {
      fetch(`https://discord.com/api/v10/channels/${leadsChannelId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bot ${discordToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content: pingMsg }),
      }).catch(() => {});
    }
    if (threadId && discordToken) {
      fetch(`https://discord.com/api/v10/channels/${threadId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bot ${discordToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ content: `⚠️ **Lead replied while AI is paused.** Re-enable AI in the CRM when ready to respond.` }),
      }).catch(() => {});
    }
    return { ok: false, reason: "ai_manually_paused" };
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

  // ── Pre-send guard — hard-check before ANY message hits Twilio ──────────────
  const guard = preSendGuard({
    message: parsed.cleanText,
    mode: (cfg as any).mode ?? null,
    isDnc: lead.phone ? await isOnDNC(tenant.id, lead.phone).catch(() => false) : true,
  });
  if (!guard.ok) {
    console.error(`[guard] BLOCKED outbound to ${lead.phone} (conv ${conversation.id}): ${guard.reason}`);
    await insertConversationMessage({
      conversation_id: conversation.id,
      tenant_id: tenant.id,
      role: "assistant",
      body: parsed.cleanText,
      twilio_sid: null,
      model_used: modelUsed,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_cents: costCents,
      error: `_blocked: ${guard.reason}`,
    });
    // Mirror to Discord as internal/blocked so rep can see it
    const convForGuard = await getOrCreateConversation(tenant.id, lead.id).catch(() => null);
    if ((convForGuard as any)?.discord_thread_id) {
      await mirrorSmsToThread(
        (convForGuard as any).discord_thread_id,
        "assistant",
        `🚫 **BLOCKED** *(guard: ${guard.reason})*\n${parsed.cleanText}`,
        null, null, false
      ).catch(() => {});
    }
    return { ok: false, reason: `blocked by pre-send guard: ${guard.reason}` };
  }

  // Send SMS to lead
  let twilioSid: string | null = null;
  let smsError: string | null = null;
  if (lead.phone) {
    try {
      const smsResp = await sendSms(lead.phone, parsed.cleanText, tenant.twilio_from);
      twilioSid = (smsResp as any)?.sid ?? null;
      // Mirror to Discord thread — mark as SENT
      const conv = await getOrCreateConversation(tenant.id, lead.id);
      if ((conv as any).discord_thread_id) {
        await mirrorSmsToThread((conv as any).discord_thread_id, "assistant", parsed.cleanText, null, null, twilioSid !== null).catch(() => {});
      }
    } catch (err: any) {
      smsError = String(err?.message ?? err);
      // Mirror to Discord thread — mark as FAILED so rep can see it never reached customer
      const conv = await getOrCreateConversation(tenant.id, lead.id).catch(() => null);
      if ((conv as any)?.discord_thread_id) {
        await mirrorSmsToThread((conv as any).discord_thread_id, "assistant", parsed.cleanText, null, smsError, false).catch(() => {});
      }
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
    // DM Zak if Hayden is uncertain / needs guidance
    const handoffNote = parsed.controls.handoff ?? "";
    const needsZakDm = /uncertain|not sure|unclear|unusual|edge case|borderline|confused|can't|cannot|don.t know/i.test(handoffNote);
    if (needsZakDm) {
      dmZak(
        `Hayden is uncertain on a ${(tenant as any).name ?? tenant.id} lead.\n` +
        `Lead: ${lead.full_name ?? lead.phone} (${lead.phone ?? ""})\n` +
        `Reason: ${handoffNote}`
      ).catch(() => {});
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
    if ((cfg as any).mode === 'receptionist') {
      // Receptionist mode: schedule all 10 template touches upfront (no LLM calls needed)
      await scheduleReceptionistNurture(tenant.id, lead.id, conversation.id);
    } else {
      await scheduleNextNurture(tenant.id, lead.id, conversation.id, conversation.total_messages + 1);
    }
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

// ─── Receptionist nurture prompts (A/B variants) ────────────────────────────
// Warm check-ins only. NO pricing, NO scarcity, NO quotes, NO scheduling.
// Messages sent directly as SMS templates — no LLM call needed.
const receptionistNudgeMap: Record<string, { A: string; B: string }> = {
  touch_30m: {
    A: "Hey [name], just wanted to make sure my message came through! Still happy to get you some info on a house wash — what's the address we'd be coming out to?",
    B: "Hi [name]! This is Hayden with Mack Wash — just following up on your inquiry. Want to get you set up — what's the best address for the job?"
  },
  touch_2h: {
    A: "Hey [name], Hayden again with Mack Wash. Want to make sure we didn't miss each other — still looking to get a house wash done?",
    B: "Hi [name], just checking back in on your house wash inquiry. Happy to answer any questions — still interested?"
  },
  touch_6h: {
    A: "Hey [name] — Hayden with Mack Wash. We do a lot of homes in your area and I want to make sure you get taken care of. Still want to move forward?",
    B: "[name], Hayden here from Mack Wash. Just making sure this didn't get buried. Still want to get that house wash done?"
  },
  touch_24h: {
    A: "Hey [name], following up from yesterday on your Mack Wash inquiry. We're booking jobs in your area — do you still want to get on the schedule?",
    B: "Hi [name], Hayden with Mack Wash. Wanted to circle back — are you still looking to get the house washed? Happy to help."
  },
  touch_48h: {
    A: "[name], Hayden from Mack Wash. Just wanted to check one more time — still thinking about getting the house wash done?",
    B: "Hey [name] — haven't heard back, just want to make sure everything is okay. Still interested in the house wash?"
  },
  touch_72h: {
    A: "Hey [name], Hayden with Mack Wash. Last thing I need is your address so I can pass this off to Mack for you — still want to move forward?",
    B: "[name], Hayden here. We've got availability in your area soon. Do you still want info on the house wash?"
  },
  touch_7d: {
    A: "Hey [name] — it's been a week since you reached out about a house wash. Still on your radar? Happy to pick back up.",
    B: "Hi [name], Hayden with Mack Wash. Just wanted to check back in — did you end up getting the house wash taken care of?"
  },
  touch_10d: {
    A: "[name], Hayden from Mack Wash. We're doing jobs near you soon — wanted to reach out one more time in case the timing works better now.",
    B: "Hey [name] — still thinking about the house wash? We're in your area and I'd love to get you connected with Mack."
  },
  touch_14d: {
    A: "Hi [name], Hayden with Mack Wash. Reaching out one more time — if the timing isn't right, no worries at all. Just let me know!",
    B: "[name] — Hayden here. Two weeks since you inquired about a house wash. Still want to move forward, or should I take you off my list?"
  },
  touch_21d: {
    A: "Hey [name], last check-in from me — Hayden with Mack Wash. Still want to get that house wash done? Just reply and I'll get Mack in touch with you.",
    B: "[name], Hayden from Mack Wash. Final follow-up — if the timing works, just reply and we'll take it from there. No pressure either way!"
  },
};

const RECEPTIONIST_TOUCHES = [
  { kind: 'touch_30m', delayMs: 30 * 60 * 1000 },
  { kind: 'touch_2h',  delayMs: 2  * 60 * 60 * 1000 },
  { kind: 'touch_6h',  delayMs: 6  * 60 * 60 * 1000 },
  { kind: 'touch_24h', delayMs: 24 * 60 * 60 * 1000 },
  { kind: 'touch_48h', delayMs: 48 * 60 * 60 * 1000 },
  { kind: 'touch_72h', delayMs: 72 * 60 * 60 * 1000 },
  { kind: 'touch_7d',  delayMs: 7  * 24 * 60 * 60 * 1000 },
  { kind: 'touch_10d', delayMs: 10 * 24 * 60 * 60 * 1000 },
  { kind: 'touch_14d', delayMs: 14 * 24 * 60 * 60 * 1000 },
  { kind: 'touch_21d', delayMs: 21 * 24 * 60 * 60 * 1000 },
];

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
  // 7-touch sequence. msgCount is total_messages (user + assistant combined).
  // Divide by 2 to approximate assistant turn count, capped so we always
  // schedule at least through touch_14d for long conversations.
  const sequence: Array<keyof typeof NURTURE_INTERVALS_MS> = [
    "touch_1h", "touch_6h", "touch_24h", "touch_48h", "touch_72h", "touch_7d", "touch_14d",
  ];
  // Use assistant turn count (approx half of total messages); cap at last touch
  const assistantTurns = Math.ceil(msgCount / 2);
  const idx = Math.min(assistantTurns - 1, sequence.length - 1);
  const kind = sequence[idx];
  if (!kind) return; // safety

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

async function scheduleReceptionistNurture(tenantId: string, leadId: number, conversationId: number) {
  // Cancel any existing scheduled jobs first (idempotent — safe to call on every assistant turn)
  await cancelOpenNurtureForLead(leadId);
  // Schedule all 10 touches upfront from now
  for (const touch of RECEPTIONIST_TOUCHES) {
    const fireAt = new Date(Date.now() + touch.delayMs).toISOString();
    await scheduleNurture({
      tenant_id:       tenantId,
      lead_id:         leadId,
      conversation_id: conversationId,
      kind:            touch.kind,
      fire_at:         fireAt,
      payload:         { receptionist: true } as Record<string, unknown>,
    });
  }
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
  // Do not fire nurture for terminal conversation states
  if (conversation.status === 'stopped' || conversation.status === 'handoff' || conversation.status === 'completed') {
    return { ok: false, reason: `conversation status=${conversation.status}` };
  }
  if (conversation.status !== "active") {
    return { ok: false, reason: `conversation status=${conversation.status}` };
  }

  // If the customer has replied since this job was queued, skip — cancelOpenNurtureForLead
  // should have already pruned, but extra safety:
  if (conversation.last_role === "user") {
    return { ok: false, reason: "customer replied first" };
  }

  // ─── RECEPTIONIST MODE: send direct SMS template (no LLM) ──────────────────────────
  if ((cfg as any).mode === 'receptionist') {
    const variants = receptionistNudgeMap[kind];
    if (!variants) return { ok: false, reason: `no receptionist nudge for ${kind}` };

    const variant = ((conversation as any).nurture_variant ?? 'A') as 'A' | 'B';
    const firstName = lead.full_name?.split(' ')[0] ?? lead.full_name ?? 'there';
    const nudgeText = variants[variant].replace(/\[name\]/gi, firstName);

    // Pre-send guard — must run even for templates
    const guard = preSendGuard({
      message: nudgeText,
      mode:    (cfg as any).mode ?? null,
      isDnc:   false, // DNC already checked above
    });
    if (!guard.ok) {
      console.error(`[guard] BLOCKED receptionist nurture to ${lead.phone}: ${guard.reason}`);
      return { ok: false, reason: `blocked by guard: ${guard.reason}` };
    }

    // Log the system annotation
    await insertConversationMessage({
      conversation_id: conversation.id,
      tenant_id:       tenant.id,
      role:            'system',
      body:            `[Receptionist nurture ${kind} variant ${variant}]`,
      twilio_sid:      null, model_used: null, tokens_in: null, tokens_out: null, cost_cents: null, error: null,
    });

    // Send directly via Twilio (no LLM)
    try {
      const { sendSms: sendSmsDirect } = await import('./twilio.js');
      const sid = await sendSmsDirect(lead.phone, nudgeText, tenant.twilio_from);
      await insertConversationMessage({
        conversation_id: conversation.id,
        tenant_id:       tenant.id,
        role:            'assistant',
        body:            nudgeText,
        twilio_sid:      (sid as any)?.sid ?? null,
        model_used:      'template',
        tokens_in:       null, tokens_out: null, cost_cents: 0, error: null,
      });
      await updateConversation(conversation.id, {
        last_message_at: new Date().toISOString(),
        last_role:       'assistant' as const,
        total_messages:  conversation.total_messages + 1,
      });
      // Mirror to Discord thread
      const { mirrorSmsToThread: mirror } = await import('./discord.js');
      if ((conversation as any).discord_thread_id) {
        await mirror((conversation as any).discord_thread_id, 'assistant', nudgeText, null, null, true).catch(() => {});
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, reason: err?.message ?? String(err) };
    }
  }
  // ─── END RECEPTIONIST MODE ─────────────────────────────────────────────────────────

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

// ─── Owner SMS handler ─────────────────────────────────────────────────────────────────────────
// Routes inbound SMS from the tenant’s own contact_phone to an owner assistant mode.
// Mack can ask about leads, reply rates, recent activity — but NOT internal Blue Ocean
// business info, Zak’s details, margins, or other clients.

const OWNER_DAILY_MSG_LIMIT = 20;
const OWNER_SYSTEM = `You are Hayden, a business assistant for the owner of a pressure washing company.
You have access to their lead pipeline and can give performance summaries and status updates.

You CAN share:
- How many leads came in (today / this week / total)
- Status of individual leads by name or phone
- Reply rates, conversion rates, recent activity
- Advice on following up with specific customers

You CANNOT share:
- Anything about the AI platform, vendor, or software costs
- Any other client businesses or comparison data
- Internal pricing strategy or margin decisions
- Details about the team managing this system

Be concise and direct. This is SMS — keep replies under 160 characters when possible.
If asked something outside your scope, politely deflect: "That’s outside what I can help with — best to check with your ops team."`;

export async function handleOwnerSmsFromRoute(tenant: Tenant, ownerLead: Lead, body: string): Promise<RunResult> {
  return handleOwnerSms({ tenant, body, twilioSid: null });
}

async function handleOwnerSms(opts: {
  tenant: Tenant;
  body: string;
  twilioSid: string | null;
}): Promise<RunResult> {
  const { tenant, body } = opts;

  // Rate limit
  const [countRow] = await sql<{ cnt: string }[]>`
    SELECT COUNT(*) as cnt FROM swell_lead_activity
    WHERE tenant_id = ${tenant.id}
      AND type = 'owner_sms'
      AND created_at > NOW() - INTERVAL '24 hours'
  `;
  const todayCount = parseInt(countRow?.cnt ?? "0", 10);
  if (todayCount >= OWNER_DAILY_MSG_LIMIT) {
    const reply = "Daily message limit reached. Chat resumes tomorrow.";
    if (tenant.twilio_from && tenant.contact_phone) {
      await sendSms(tenant.contact_phone, reply, tenant.twilio_from).catch(() => {});
    }
    return { ok: false, reason: "owner_rate_limited" };
  }

  // Log the owner message for learning
  await logActivity({
    lead_id: 0,
    tenant_id: tenant.id,
    type: "owner_sms",
    direction: "inbound",
    body: `Owner: "${body}"`,
    metadata: { from: tenant.contact_phone, message_count_today: todayCount + 1 },
  }).catch(() => {});

  // Pull quick stats for context
  const [stats] = await sql<{ total: string; new_today: string; replied: string }[]>`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as new_today,
      COUNT(*) FILTER (WHERE status = 'replied') as replied
    FROM swell_leads WHERE tenant_id = ${tenant.id}
  `;

  // Build Anthropic prompt with context
  const apiKey = process.env.ANTHROPIC_API_KEY
    ?? process.env[`${tenant.id.toUpperCase()}_ANTHROPIC_API_KEY`]
    ?? "";
  if (!apiKey) {
    const reply = "I'm not able to help with that right now. Try again later.";
    if (tenant.twilio_from && tenant.contact_phone) {
      await sendSms(tenant.contact_phone, reply, tenant.twilio_from).catch(() => {});
    }
    return { ok: false, reason: "no_api_key" };
  }

  const context = `Current pipeline stats for ${(tenant as any).name ?? tenant.id}:
- Total leads: ${stats?.total ?? "?"}
- New leads today: ${stats?.new_today ?? "?"}
- Leads that replied: ${stats?.replied ?? "?"}`;

  const resp = await anthropicChat({
    model:     "claude-haiku-4-5",
    maxTokens: 200,
    system:    `${OWNER_SYSTEM}\n\n${context}`,
    messages:  [{ role: "user", content: body }],
    tenantId:  tenant.id,
  }).catch((e: any) => { console.error("[owner-sms] Anthropic error:", e?.message); return null; });

  const replyStr = resp?.text ?? "Something went wrong. Try again.";

  // Send reply
  if (tenant.twilio_from && tenant.contact_phone) {
    await sendSms(tenant.contact_phone, replyStr, tenant.twilio_from).catch(() => {});
  }

  // Log the owner interaction to Discord leads channel
  const discordCh = process.env[`${tenant.id.toUpperCase()}_DISCORD_LEADS_CHANNEL_ID`] ?? "";
  const discordToken = process.env.DISCORD_BOT_TOKEN ?? "";
  if (discordCh && discordToken) {
    const note = `🔑 **Owner SMS** — ${(tenant as any).name ?? tenant.id}\n📱 Mack: "${body}"\n🤖 Hayden: "${replyStr}"`;
    await fetch(`https://discord.com/api/v10/channels/${discordCh}/messages`, {
      method:  "POST",
      headers: { Authorization: `Bot ${discordToken}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ content: note }),
    }).catch(() => {});
  }

  return { ok: true };
}

// Lookup helper used by webhook + cron
export async function loadLeadForTenant(tenantId: string, leadId: number): Promise<Lead | undefined> {
  return getLeadByIdForTenant(tenantId, leadId);
}

// ─── Borderline service area — notify owner via Discord ───────────────────────────────────

async function notifyOwnerBorderlineArea(opts: {
  tenantId:      string;
  tenantName:    string;
  lead:          Lead;
  distanceMiles: number;
  nearestHub:    string;
}): Promise<void> {
  const { tenantId, tenantName, lead, distanceMiles, nearestHub } = opts;
  const token   = process.env.DISCORD_BOT_TOKEN ?? "";
  const channel = process.env[`${tenantId.toUpperCase()}_DISCORD_LEADS_CHANNEL_ID`] ?? "";
  if (!token || !channel) return;

  const ownerNote = `⚠️ **Borderline lead — ${lead.full_name ?? lead.phone}** needs your call.
📍 ${lead.address ?? "Address unknown"}
📍 ${distanceMiles} miles from ${nearestHub} (just outside normal coverage)
📱 ${lead.phone ?? "—"}

Hayden has put the conversation on hold and told them we'd check. **Reply here:**
✅ \`YES\` — approve this job, I'll continue the quote
❌ \`NO\` — too far, I'll politely decline

_(Hayden will continue automatically based on your reply)_`;

  await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
    method:  "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ content: ownerNote }),
  }).catch((e: any) => console.error("[borderline-discord]", e?.message));
}
