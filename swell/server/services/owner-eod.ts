/**
 * End-of-day owner check service.
 *
 * Two entry points:
 *   - fireEodCheck(tenant)   — called by cron; sends owner the day's job list
 *   - handleOwnerEodReply()  — called by inbound SMS handler; parses owner reply
 */
import {
  type Tenant,
  listAppointments,
  updateAppointment,
  createEodCheck,
  resolveEodCheck,
  markEodCheckProcessed,
  getScheduleConfig,
  getPendingEodCheck,
} from "../db/queries.js";
import { anthropicChat } from "./anthropic.js";
import { sendSms, sendNotification } from "./twilio.js";

export async function shouldFireEodCheck(tenant: Tenant): Promise<boolean> {
  const cfg = await getScheduleConfig(tenant.id);
  if (!cfg) return false;

  const tz = cfg.timezone ?? "America/New_York";
  const now = new Date();
  const localNow = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const [endH, endM] = cfg.work_end.split(":").map(Number);
  const offsetHours = (tenant as any).eod_offset_hours ?? 1.0;
  const fireHour = endH + Math.floor(offsetHours);
  const fireMin = endM + Math.round((offsetHours % 1) * 60);

  // Fire if current local time is within the fire minute
  return localNow.getHours() === fireHour % 24 && localNow.getMinutes() === fireMin % 60;
}

export async function fireEodCheck(tenant: Tenant): Promise<void> {
  const ownerPhone = (tenant as any).owner_phone ?? tenant.contact_phone;
  if (!ownerPhone) {
    console.warn(`[eod] No owner phone for ${tenant.id}`);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayAppts = await listAppointments(tenant.id, today, today);
  const active = todayAppts.filter((a) => !["cancelled", "completed"].includes(a.status));

  if (!active.length) return; // Nothing to check

  const jobLines = active
    .map(
      (a, i) =>
        `${i + 1}. ${a.service_summary ?? "Job"} — ${a.scheduled_time ?? "TBD"}${a.preferred_day ? ` (${a.preferred_day})` : ""}`
    )
    .join("\n");

  const ownerName = (tenant as any).owner_name ?? "there";
  const msg = `Hey ${ownerName}, quick wrap-up for today!\n\nJobs scheduled:\n${jobLines}\n\nWhich ones got done? Reply "all done", "1-3 done", "none done", or however you'd describe it.`;

  await sendNotification(ownerPhone, msg, tenant.twilio_from, tenant.name);
  await createEodCheck(tenant.id, today);
  console.log(`[eod] Sent EOD check to ${ownerPhone} for ${tenant.id}`);
}

export async function handleOwnerEodReply(opts: {
  tenant: Tenant;
  body: string;
}): Promise<void> {
  const { tenant, body } = opts;

  const pending = await getPendingEodCheck(tenant.id);
  if (!pending) return;

  await resolveEodCheck(pending.id, body);

  const today = pending.check_date;
  const todayAppts = await listAppointments(tenant.id, today, today);
  const active = todayAppts.filter((a) => !["cancelled", "completed"].includes(a.status));

  if (!active.length) {
    await markEodCheckProcessed(pending.id);
    return;
  }

  // Use Haiku to parse which jobs were completed
  const jobList = active.map((a, i) => `${i + 1}. ${a.service_summary ?? "Job"} (id: ${a.id})`).join("\n");
  const prompt = `The owner replied to an end-of-day check about today's jobs.

Jobs:
${jobList}

Owner reply: "${body}"

Parse which job IDs were completed and which should be pushed to tomorrow.
Respond ONLY with valid JSON: { "completed": [id, ...], "pushed": [id, ...] }`;

  let parsed: { completed: number[]; pushed: number[] } = { completed: [], pushed: [] };
  try {
    const result = await anthropicChat({
      model: "claude-haiku-4-5",
      system: "You parse owner replies about job completion. Return only valid JSON.",
      messages: [{ role: "user", content: prompt }],
      maxTokens: 200,
      tenantId: tenant.id,
    });
    parsed = JSON.parse(result.text.trim());
  } catch (e) {
    console.error("[eod] Parse failed:", e);
  }

  // Update appointment statuses
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  for (const id of parsed.completed ?? []) {
    await updateAppointment(id, tenant.id, { status: "completed" });
  }
  for (const id of parsed.pushed ?? []) {
    await updateAppointment(id, tenant.id, { status: "pending", scheduled_date: tomorrowStr });
  }

  await markEodCheckProcessed(pending.id);

  const ownerPhone = (tenant as any).owner_phone ?? tenant.contact_phone;
  const doneCount = parsed.completed?.length ?? 0;
  const pushedCount = parsed.pushed?.length ?? 0;
  const summary = `Got it! ${doneCount} job${doneCount !== 1 ? "s" : ""} marked complete${pushedCount > 0 ? `, ${pushedCount} moved to tomorrow` : ""}. 👍`;
  await sendNotification(ownerPhone, summary, tenant.twilio_from, tenant.name);

  console.log(`[eod] Processed for ${tenant.id}: ${doneCount} done, ${pushedCount} pushed`);
}
