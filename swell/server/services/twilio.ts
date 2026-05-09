/**
 * Twilio SMS sender.
 *
 * `from` resolves in this order:
 *   1. Explicit `from` arg (caller provides per-tenant override)
 *   2. tenant.twilio_from (passed in via fromOverride)
 *   3. process.env.TWILIO_PHONE_NUMBER (global default)
 */
export function normalizePhone(phone: string): string | null {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 11) return `+${digits}`;
  return null;
}

/**
 * sendNotification — sends to the primary recipient AND the admin CC number
 * (SWELL_ADMIN_PHONE env var). Use this for all owner-facing notifications.
 * Falls back to plain sendSms if no admin phone is set or if to === adminPhone.
 */
export async function sendNotification(
  to: string,
  body: string,
  fromOverride?: string | null,
  tenantLabel?: string,
): Promise<void> {
  await sendSms(to, body, fromOverride);

  const adminPhone = process.env.SWELL_ADMIN_PHONE;
  if (!adminPhone) return;

  const normTo = normalizePhone(to);
  const normAdmin = normalizePhone(adminPhone);
  if (!normAdmin || normTo === normAdmin) return; // don't double-send if already the admin

  const prefix = tenantLabel ? `[${tenantLabel}] ` : "";
  await sendSms(adminPhone, `${prefix}${body}`, fromOverride).catch(e =>
    console.warn(`[twilio] Admin CC failed: ${e?.message}`)
  );
}

export async function sendSms(to: string, body: string, fromOverride?: string | null) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const from = fromOverride || process.env.TWILIO_PHONE_NUMBER;
  const normalized = normalizePhone(to);

  if (!sid || !auth || !from) {
    throw new Error("Missing Twilio env vars (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER)");
  }
  if (!normalized) throw new Error(`Invalid phone number: ${to}`);

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: from, To: normalized, Body: body }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Twilio ${response.status}: ${text}`);
  }
  return response.json();
}
