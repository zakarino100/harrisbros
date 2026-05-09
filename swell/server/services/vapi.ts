/**
 * VAPI service — AI voice call management.
 * Uses the same Twilio numbers as SMS (inbound calls route via Twilio voice webhook → VAPI).
 * Credentials: VAPI_API_KEY env var. Gracefully no-ops if not configured.
 */

const VAPI_API = "https://api.vapi.ai";

function apiKey(): string | null {
  return process.env.VAPI_API_KEY || null;
}

function headers() {
  return {
    Authorization: `Bearer ${apiKey()}`,
    "Content-Type": "application/json",
  };
}

export function isVapiConfigured(): boolean {
  return !!apiKey();
}

export async function createOutboundCall(opts: {
  toPhone: string;
  fromPhone: string;
  assistantId: string;
  assistantOverrides?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Promise<{ callId: string } | null> {
  if (!isVapiConfigured()) {
    console.warn("[vapi] VAPI_API_KEY not set — skipping outbound call");
    return null;
  }

  const res = await fetch(`${VAPI_API}/call/phone`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      phoneNumberId: opts.fromPhone, // VAPI phone number ID mapped from our twilio_from
      customer: { number: opts.toPhone },
      assistantId: opts.assistantId,
      assistantOverrides: opts.assistantOverrides,
      metadata: opts.metadata,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[vapi] createOutboundCall failed: ${res.status} ${text}`);
    return null;
  }

  const data = await res.json() as any;
  return { callId: data.id };
}

export async function listCalls(limit = 50): Promise<any[]> {
  if (!isVapiConfigured()) return [];

  const res = await fetch(`${VAPI_API}/call?limit=${limit}`, { headers: headers() });
  if (!res.ok) return [];

  const data = await res.json() as any;
  return Array.isArray(data) ? data : (data.results ?? []);
}

export async function getCall(callId: string): Promise<any | null> {
  if (!isVapiConfigured()) return null;

  const res = await fetch(`${VAPI_API}/call/${callId}`, { headers: headers() });
  if (!res.ok) return null;

  return res.json();
}

/** Map VAPI call status to our internal status */
export function normalizeStatus(vapiStatus: string): string {
  const map: Record<string, string> = {
    queued: "queued",
    ringing: "ringing",
    "in-progress": "in-progress",
    forwarding: "transferred",
    ended: "completed",
    busy: "no-answer",
    failed: "failed",
    "no-answer": "no-answer",
    voicemail: "voicemail",
  };
  return map[vapiStatus] ?? vapiStatus;
}
