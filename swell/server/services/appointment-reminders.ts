/**
 * Appointment reminders — sends SMS to customers the evening before their scheduled service.
 * Also handles inbound replies (reschedule/cancel/confirm) and Discord booking notifications.
 *
 * Fires daily at a configurable time (default: 6pm in tenant timezone).
 * Sends to all confirmed/pending appointments for tomorrow that haven't had a reminder.
 */
import { sql } from "../db/index.js";
import { sendSms, sendNotification } from "./twilio.js";
import { getScheduleConfig } from "../db/queries.js";
import { anthropicChat } from "./anthropic.js";
import { notifyBookingDiscord } from "./discord.js";

export async function fireAppointmentReminders(): Promise<void> {
  // Get all tenants with schedule configs
  const tenants = await sql`
    SELECT t.id, t.name, t.twilio_from, s.timezone, s.work_end
    FROM swell_tenants t
    JOIN swell_schedule_configs s ON s.tenant_id = t.id
    WHERE t.enabled = true
  `;

  for (const tenant of tenants) {
    try {
      await sendRemindersForTenant(tenant);
    } catch (e: any) {
      console.error(`[reminders] Failed for ${tenant.id}:`, e?.message);
    }
  }
}

async function sendRemindersForTenant(tenant: any): Promise<void> {
  const tz = tenant.timezone ?? "America/New_York";
  const now = new Date();
  const localNow = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const localHour = localNow.getHours();

  // Only fire between 5pm–7pm local time
  if (localHour < 17 || localHour >= 19) return;

  // Get tomorrow's date in tenant timezone
  const tomorrow = new Date(localNow);
  tomorrow.setDate(localNow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  // Find appointments for tomorrow that haven't been reminded
  const appts = await sql`
    SELECT a.*, l.full_name, l.phone
    FROM swell_appointments a
    JOIN swell_leads l ON l.id = a.lead_id
    WHERE a.tenant_id = ${tenant.id}
      AND a.scheduled_date = ${tomorrowStr}
      AND a.status IN ('pending', 'confirmed')
      AND a.reminder_sent_at IS NULL
      AND l.phone IS NOT NULL
  `;

  if (!appts.length) return;
  console.log(`[reminders] ${tenant.name}: ${appts.length} reminder(s) for ${tomorrowStr}`);

  for (const appt of appts) {
    const firstName = (appt.full_name ?? "").split(" ")[0] || "there";
    const service = appt.service_summary ?? "your scheduled service";
    const timeStr = appt.scheduled_time
      ? ` at ${formatTime(appt.scheduled_time)}`
      : "";

    const msg = `Hi ${firstName}! Quick reminder — ${tenant.name} is scheduled for ${service}${timeStr} tomorrow. If anything changes, reply here. See you then! 👋`;

    try {
      await sendSms(appt.phone, msg, tenant.twilio_from);
      await sql`
        UPDATE swell_appointments
        SET reminder_sent_at = NOW()
        WHERE id = ${appt.id}
      `;
      console.log(`[reminders] Sent to ${appt.phone} for appt ${appt.id}`);
    } catch (e: any) {
      console.error(`[reminders] SMS failed for appt ${appt.id}:`, e?.message);
    }

    await new Promise(r => setTimeout(r, 500));
  }
}

// ─── Inbound reply handler (reschedule / cancel / confirm) ──────────────────

export async function findAppointmentByPhone(tenantId: string, phone: string): Promise<any | null> {
  const normalized = phone.replace(/\D/g, '').replace(/^1/, '');
  const rows = await sql`
    SELECT a.*, l.full_name, l.phone, t.twilio_from, t.name as tenant_name,
           t.owner_phone, t.contact_phone
    FROM swell_appointments a
    JOIN swell_leads l ON l.id = a.lead_id
    JOIN swell_tenants t ON t.id = a.tenant_id
    WHERE a.tenant_id = ${tenantId}
      AND a.status IN ('pending', 'confirmed')
      AND a.reminder_sent_at IS NOT NULL
      AND regexp_replace(l.phone, '[^0-9]', '', 'g') LIKE ${'%' + normalized}
    ORDER BY a.scheduled_date ASC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function handleAppointmentReply(opts: {
  tenantId: string;
  tenantName: string;
  twilio_from: string | null;
  body: string;
  appointment: any;
}): Promise<void> {
  const { tenantId, tenantName, twilio_from, body, appointment } = opts;
  const firstName = (appointment.full_name ?? '').split(' ')[0] || 'there';

  // Classify intent with Haiku
  const result = await anthropicChat({
    model: 'claude-haiku-4-5',
    system: 'Classify this customer reply to an appointment reminder. Return ONLY one word: reschedule | cancel | confirm | question | other',
    messages: [{ role: 'user', content: body }],
    maxTokens: 10,
    tenantId,
  });

  const intent = result.text.trim().toLowerCase().replace(/[^a-z]/g, '');
  console.log(`[appt-reply] ${firstName} intent: ${intent} — "${body.slice(0, 60)}"`);

  const ownerPhone = appointment.owner_phone ?? appointment.contact_phone;
  const notifyBody = `[${tenantName}] Appointment reply from ${appointment.full_name ?? appointment.phone} — "${body.slice(0, 120)}"`;

  if (intent === 'cancel') {
    await sql`UPDATE swell_appointments SET status = 'cancelled' WHERE id = ${appointment.id}`;
    await sendSms(appointment.phone, `No problem, ${firstName} — your appointment has been cancelled. Feel free to reach out when you're ready to reschedule! 😊`, twilio_from);
    await sendNotification(ownerPhone, `❌ Cancelled: ${appointment.full_name ?? appointment.phone} cancelled their ${appointment.service_summary ?? 'appointment'} on ${appointment.scheduled_date}.`, twilio_from, tenantName);

  } else if (intent === 'reschedule') {
    await sql`UPDATE swell_appointments SET status = 'pending', preferred_day = ${'reschedule requested'} WHERE id = ${appointment.id}`;
    await sendSms(appointment.phone, `Of course, ${firstName}! What day works better for you? We'll get you rescheduled ASAP.`, twilio_from);
    await sendNotification(ownerPhone, `🔄 Reschedule: ${appointment.full_name ?? appointment.phone} wants to reschedule their ${appointment.service_summary ?? 'appointment'} on ${appointment.scheduled_date}. Reply to them: ${appointment.phone}`, twilio_from, tenantName);

  } else if (intent === 'confirm') {
    await sql`UPDATE swell_appointments SET status = 'confirmed' WHERE id = ${appointment.id}`;
    await sendSms(appointment.phone, `Great, ${firstName}! See you tomorrow 👋`, twilio_from);

    // Post to Discord bookings channel
    try {
      await notifyBookingDiscord(tenantId, tenantName, {
        leadId: appointment.lead_id,
        name: appointment.full_name,
        phone: appointment.phone,
        email: null,
      }, appointment.quoted_price_cents ? appointment.quoted_price_cents / 100 : 0,
      appointment.service_summary ?? 'Service');
    } catch (e) { console.error('[appt-reply] Discord booking notify failed:', e); }

  } else {
    // Question or other — forward to owner and acknowledge
    await sendSms(appointment.phone, `Thanks ${firstName}! I'll have someone from the team reach out shortly.`, twilio_from);
    await sendNotification(ownerPhone, notifyBody, twilio_from, tenantName);
  }
}

// ─── Discord booking notification for new bookings ───────────────────────────

export async function notifyNewBookingDiscord(opts: {
  tenantId: string;
  tenantName: string;
  leadId: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  service: string;
  priceCents: number;
  date: string;
}): Promise<void> {
  await notifyBookingDiscord(
    opts.tenantId,
    opts.tenantName,
    { leadId: opts.leadId, name: opts.name, phone: opts.phone, email: opts.email },
    opts.priceCents / 100,
    `${opts.service} — ${opts.date}`,
  );
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h)) return hhmm;
  const ampm = h >= 12 ? "pm" : "am";
  const hour = h % 12 || 12;
  return m ? `${hour}:${String(m).padStart(2, "0")}${ampm}` : `${hour}${ampm}`;
}
