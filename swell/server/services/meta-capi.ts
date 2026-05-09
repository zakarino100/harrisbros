/**
 * Meta Conversions API (CAPI) — server-side conversion events.
 *
 * Fires standard events as leads progress through the funnel:
 *   Lead created            → Lead
 *   Conversation started    → Lead (deduplicated)
 *   Quoted by Hayden        → ViewContent (with estimated value)
 *   Handoff: ready to book  → InitiateCheckout (with quoted price)
 *   Appointment confirmed   → Schedule
 *   Appointment completed   → Purchase (with actual price)
 *   Review sent (satisfied) → Contact
 *
 * Per-tenant config: meta_pixel_id + meta_capi_token on swell_tenants.
 * Falls back to env vars HARRIS_BROS_META_PIXEL_ID etc.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export type CapiEventName =
  | "Lead"
  | "ViewContent"
  | "InitiateCheckout"
  | "Schedule"
  | "Purchase"
  | "Contact";

interface CapiUserData {
  phone?: string | null;
  email?: string | null;
  external_id?: string | null; // lead ID hashed
}

interface CapiCustomData {
  currency?: string;
  value?: number;
  content_name?: string;
  status?: string;
}

function sha256Hex(value: string): string {
  // Node 21+ has crypto.subtle globally; for compat use crypto module
  const { createHash } = require("crypto");
  return createHash("sha256").update(value.toLowerCase().trim()).digest("hex");
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function getPixelConfig(tenantId: string, tenant: any): { pixelId: string; token: string } | null {
  const prefix = tenantId.toUpperCase();
  const pixelId =
    tenant?.meta_pixel_id ||
    process.env[`${prefix}_META_PIXEL_ID`] ||
    "";
  const token =
    tenant?.meta_capi_token ||
    process.env[`${prefix}_META_CAPI_TOKEN`] ||
    "";

  if (!pixelId || !token) return null;
  return { pixelId, token };
}

export async function fireCapiEvent(opts: {
  tenantId: string;
  tenant: any;
  eventName: CapiEventName;
  userData: CapiUserData;
  customData?: CapiCustomData;
  eventSourceUrl?: string;
  eventId?: string;           // for deduplication with browser pixel
  leadFormId?: string | null;
}): Promise<void> {
  const config = getPixelConfig(opts.tenantId, opts.tenant);
  if (!config) {
    console.log(`[capi] No pixel config for ${opts.tenantId} — skipping ${opts.eventName}`);
    return;
  }

  const { pixelId, token } = config;
  const eventTime = Math.floor(Date.now() / 1000);
  const eventId = opts.eventId ?? `${opts.tenantId}_${opts.eventName}_${eventTime}_${opts.userData.external_id ?? ""}`;

  // Hash PII
  const userData: Record<string, string> = {};
  if (opts.userData.phone) {
    userData.ph = sha256Hex(normalizePhone(opts.userData.phone));
  }
  if (opts.userData.email) {
    userData.em = sha256Hex(opts.userData.email);
  }
  if (opts.userData.external_id) {
    userData.external_id = sha256Hex(String(opts.userData.external_id));
  }

  const payload = {
    data: [{
      event_name: opts.eventName,
      event_time: eventTime,
      event_id: eventId,
      action_source: "system_generated",
      user_data: userData,
      custom_data: {
        currency: "USD",
        ...opts.customData,
      },
    }],
    // test_event_code: "TEST12345", // uncomment for testing in Events Manager
  };

  try {
    const res = await fetch(`${GRAPH}/${pixelId}/events?access_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json() as any;
    if (!res.ok) {
      console.error(`[capi] ${opts.eventName} failed for ${opts.tenantId}: ${JSON.stringify(data)}`);
    } else {
      console.log(`[capi] ${opts.eventName} fired for ${opts.tenantId} — events_received: ${data.events_received ?? "?"}`);
    }
  } catch (e: any) {
    console.error(`[capi] ${opts.eventName} error:`, e?.message);
  }
}

// ─── Convenience wrappers ──────────────────────────────────────────────────────

export async function capiLeadCreated(opts: {
  tenantId: string; tenant: any;
  leadId: number; phone?: string | null; email?: string | null; formId?: string | null;
}): Promise<void> {
  await fireCapiEvent({
    tenantId: opts.tenantId,
    tenant: opts.tenant,
    eventName: "Lead",
    eventId: `lead_created_${opts.leadId}`,
    userData: { phone: opts.phone, email: opts.email, external_id: String(opts.leadId) },
    customData: { content_name: "FB Lead Ad", status: "new" },
    leadFormId: opts.formId,
  });
}

export async function capiQuoted(opts: {
  tenantId: string; tenant: any;
  leadId: number; phone?: string | null; email?: string | null; quotedCents?: number;
}): Promise<void> {
  await fireCapiEvent({
    tenantId: opts.tenantId,
    tenant: opts.tenant,
    eventName: "ViewContent",
    eventId: `quoted_${opts.leadId}`,
    userData: { phone: opts.phone, email: opts.email, external_id: String(opts.leadId) },
    customData: {
      content_name: "Quote Provided",
      value: opts.quotedCents ? opts.quotedCents / 100 : undefined,
      status: "quoted",
    },
  });
}

export async function capiReadyToBook(opts: {
  tenantId: string; tenant: any;
  leadId: number; phone?: string | null; email?: string | null; quotedCents?: number;
}): Promise<void> {
  await fireCapiEvent({
    tenantId: opts.tenantId,
    tenant: opts.tenant,
    eventName: "InitiateCheckout",
    eventId: `booking_intent_${opts.leadId}`,
    userData: { phone: opts.phone, email: opts.email, external_id: String(opts.leadId) },
    customData: {
      content_name: "Booking Intent",
      value: opts.quotedCents ? opts.quotedCents / 100 : undefined,
      status: "booking_intent",
    },
  });
}

export async function capiAppointmentConfirmed(opts: {
  tenantId: string; tenant: any;
  leadId: number; phone?: string | null; email?: string | null; quotedCents?: number; service?: string | null;
}): Promise<void> {
  await fireCapiEvent({
    tenantId: opts.tenantId,
    tenant: opts.tenant,
    eventName: "Schedule",
    eventId: `appt_confirmed_${opts.leadId}`,
    userData: { phone: opts.phone, email: opts.email, external_id: String(opts.leadId) },
    customData: {
      content_name: opts.service ?? "Appointment Confirmed",
      value: opts.quotedCents ? opts.quotedCents / 100 : undefined,
      status: "confirmed",
    },
  });
}

export async function capiJobCompleted(opts: {
  tenantId: string; tenant: any;
  leadId: number; phone?: string | null; email?: string | null; priceCents: number; service?: string | null;
}): Promise<void> {
  await fireCapiEvent({
    tenantId: opts.tenantId,
    tenant: opts.tenant,
    eventName: "Purchase",
    eventId: `job_completed_${opts.leadId}`,
    userData: { phone: opts.phone, email: opts.email, external_id: String(opts.leadId) },
    customData: {
      currency: "USD",
      value: opts.priceCents / 100,
      content_name: opts.service ?? "Job Completed",
      status: "completed",
    },
  });
}
