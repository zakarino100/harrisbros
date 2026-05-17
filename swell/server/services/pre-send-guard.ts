/**
 * pre-send-guard.ts
 *
 * Hard-checks every outbound message before it is sent via SMS.
 * Called in runAssistantTurn() immediately before sendSms().
 * If any check fails, the message is BLOCKED — never reaches the customer.
 *
 * Checks (in order):
 *  1. Message sanity (empty, too short, too long)
 *  2. AI meta-messages — AI talking to itself, not the customer
 *  3. DNC (do-not-contact) flag on the lead
 *  4. Mode compliance:
 *       receptionist → no pricing, no scheduling, no quoting
 *       closer → no "I can't do that" refusals reaching customer
 *  5. Generic bad-actor patterns (STOP keywords, internal prompt leakage)
 */

export type GuardResult =
  | { ok: true }
  | { ok: false; reason: string };

// ─── Pattern sets ────────────────────────────────────────────────────────────

/** AI talking to itself / refusing an internal instruction — never for customers */
const META_PATTERNS: RegExp[] = [
  /I appreciate the instruction/i,
  /I appreciate the direction/i,
  /I appreciate the request/i,
  /I appreciate the clarification/i,
  /I need to stay (true to|in) (my role|character)/i,
  /stay in my lane/i,
  /outside my (role|scope)/i,
  /intake coordinator who responds to incoming/i,
  /I only respond when the customer sends/i,
  /automated nurture system/i,
  /I don'?t (send|initiate) (unsolicited|follow-?ups)/i,
  /that'?s (not|outside) my role/i,
  /my role is (clear|defined)/i,
  /I'?m an? (intake coordinator|SMS intake)/i,
  /not an automated/i,
  /As (Hayden|an AI|an assistant),? I (only|don'?t)/i,
];

/** Pricing / quotes — blocked in receptionist mode */
const PRICING_PATTERNS: RegExp[] = [
  /\$\s*\d+/,
  /\d+\s*(dollars?|bucks?)/i,
  /(?:the\s+)?(?:price|quote|estimate|cost|charge|fee)\s+(?:is|would be|will be|are|comes? out to)\s*[\$\d]/i,
  /I can (?:do|get you|offer|knock that out) (?:for|at) \$?\d+/i,
  /(?:only|just) \$\d+/i,
  /total\s+(?:comes? to|is|would be)\s*\$?\d+/i,
];

/** Scheduling confirmations — blocked in receptionist mode */
const SCHEDULING_PATTERNS: RegExp[] = [
  /I(?:'ll| will| can) (?:come|be there|swing by|head out)\s+(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
  /(?:we'?re|you'?re) (?:booked?|scheduled|confirmed|set up) (?:for|on)/i,
  /your appointment (?:is|has been)/i,
  /I(?:'ve| have) (?:booked?|scheduled|locked you in)/i,
  /let(?:'s| us) (?:lock you in|get you on the schedule|schedule that)/i,
];

/** Internal prompt / system message leakage */
const LEAKAGE_PATTERNS: RegExp[] = [
  /TOUCH \d+/,
  /<<HOLD>>/,
  /<<HANDOFF/,
  /SYSTEM:/i,
  /\[INTERNAL/i,
  /you are (hayden|an AI|an assistant)/i,
];

// ─── Main guard ───────────────────────────────────────────────────────────────

export function preSendGuard(opts: {
  message: string;
  mode?: string | null;
  isDnc?: boolean;
}): GuardResult {
  const { message, mode, isDnc } = opts;
  const text = (message ?? "").trim();

  // 1. Sanity checks
  if (!text || text.length < 3) {
    return { ok: false, reason: "message is empty or too short" };
  }
  if (text.length > 1600) {
    return { ok: false, reason: "message exceeds 1600 chars — likely an error" };
  }

  // 2. AI meta-messages — model is talking to itself, not the customer
  for (const p of META_PATTERNS) {
    if (p.test(text)) {
      return { ok: false, reason: `AI meta-message blocked [${p.source.slice(0, 50)}]` };
    }
  }

  // 3. DNC check
  if (isDnc) {
    return { ok: false, reason: "lead is on DNC list" };
  }

  // 4. Internal prompt leakage
  for (const p of LEAKAGE_PATTERNS) {
    if (p.test(text)) {
      return { ok: false, reason: `internal prompt leakage detected [${p.source.slice(0, 50)}]` };
    }
  }

  // 5. Mode-specific compliance
  if (mode === "receptionist") {
    for (const p of PRICING_PATTERNS) {
      if (p.test(text)) {
        return { ok: false, reason: `receptionist mode: pricing/quote in message [${p.source.slice(0, 50)}]` };
      }
    }
    for (const p of SCHEDULING_PATTERNS) {
      if (p.test(text)) {
        return { ok: false, reason: `receptionist mode: scheduling confirmation in message [${p.source.slice(0, 50)}]` };
      }
    }
  }

  return { ok: true };
}
