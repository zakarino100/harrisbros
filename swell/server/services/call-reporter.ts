/**
 * Call Reporter — analyzes recent call transcripts every 2 days and
 * generates actionable prompt improvement suggestions.
 *
 * Report is sent to Zak (+13154470614) via SMS and stored in swell_call_reports.
 * A short SMS summary fires with full details stored in the DB (viewable in CRM).
 */
import { sql } from "../db/index.js";
import { anthropicChat } from "./anthropic.js";
import { sendSms } from "./twilio.js";
import { listTenants } from "../db/queries.js";

const ADMIN_PHONE = process.env.SWELL_ADMIN_PHONE ?? "+13154470614";
const REPORT_INTERVAL_HOURS = 48;

let lastReportAt = 0;

export async function maybeFireCallReport(): Promise<void> {
  if (Date.now() - lastReportAt < REPORT_INTERVAL_HOURS * 60 * 60 * 1000) return;

  // Only fire between 9am–11am local time
  const hour = new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" });
  if (Number(hour) < 9 || Number(hour) >= 11) return;

  lastReportAt = Date.now();
  console.log("[call-reporter] Generating biweekly call analysis report...");

  try {
    await generateAndSendReport();
  } catch (e: any) {
    console.error("[call-reporter] Failed:", e?.message);
  }
}

async function generateAndSendReport(): Promise<void> {
  const since = new Date(Date.now() - REPORT_INTERVAL_HOURS * 60 * 60 * 1000).toISOString();

  const calls = await sql`
    SELECT
      c.id, c.tenant_id, c.direction, c.status, c.duration_seconds,
      c.transcript, c.summary, c.structured_data, c.ended_reason,
      c.created_at,
      l.full_name as lead_name
    FROM swell_calls c
    LEFT JOIN swell_leads l ON l.id = c.lead_id
    WHERE c.created_at > ${since}
      AND c.transcript IS NOT NULL
    ORDER BY c.created_at DESC
    LIMIT 50
  `;

  if (!calls.length) {
    console.log("[call-reporter] No calls with transcripts in the last 48h — skipping report");
    return;
  }

  const tenants = await listTenants();
  const tenantMap = Object.fromEntries(tenants.map(t => [t.id, t.name]));

  // Build a condensed call log for Claude to analyze
  const callLog = calls.map((c: any, i: number) => {
    const tenantName = tenantMap[c.tenant_id] ?? c.tenant_id;
    const dur = c.duration_seconds ? `${Math.floor(c.duration_seconds / 60)}m ${c.duration_seconds % 60}s` : "?";
    const sd = c.structured_data ?? {};
    const outcome = sd.bookingIntent ? "✅ Booking intent" : sd.callType ?? c.status;
    const transcript = (c.transcript ?? "").slice(0, 800);

    return `--- Call ${i + 1} [${tenantName}] ${c.direction} ${dur} | ${outcome} ---\n${transcript}`;
  }).join("\n\n");

  // Stats
  const total = calls.length;
  const withBooking = calls.filter((c: any) => c.structured_data?.bookingIntent).length;
  const completed = calls.filter((c: any) => c.status === "completed").length;
  const byTenant: Record<string, number> = {};
  for (const c of calls as any[]) {
    byTenant[tenantMap[c.tenant_id] ?? c.tenant_id] = (byTenant[tenantMap[c.tenant_id] ?? c.tenant_id] ?? 0) + 1;
  }

  const statsBlock = [
    `Total calls: ${total}`,
    `Completed: ${completed}`,
    `Booking intent: ${withBooking} (${total > 0 ? Math.round(withBooking / total * 100) : 0}%)`,
    ...Object.entries(byTenant).map(([name, count]) => `${name}: ${count} calls`),
  ].join("\n");

  // Claude analysis
  const result = await anthropicChat({
    model: "claude-sonnet-4-6",
    system: `You are analyzing AI sales call transcripts for a home services company. 
Your job is to identify specific, actionable improvements to the AI agent's prompts.
Be direct and specific — give exact suggested language changes, not vague advice.
Format your response in clear sections.`,
    messages: [{
      role: "user",
      content: `Here are the last ${total} calls (${since} to now):\n\nSTATS:\n${statsBlock}\n\nTRANSCRIPTS:\n${callLog}\n\nPlease analyze and provide:\n\n1. **What's working well** (keep these behaviors)\n2. **Top 3 drop-off patterns** (where calls lose momentum or fail to close)\n3. **Specific prompt changes** — for each issue, write the EXACT new language to use\n4. **Objections not handled well** — with suggested responses\n5. **One biggest improvement** that would move the needle most right now`,
    }],
    maxTokens: 1500,
  });

  const reportText = result.text.trim();

  // Store in DB
  const reportRow = await sql`
    INSERT INTO swell_call_reports (tenant_id, period_from, period_to, call_count, report_text)
    VALUES (null, ${since}, ${new Date().toISOString()}, ${total}, ${reportText})
    RETURNING id
  `;
  const reportId = reportRow[0]?.id;

  // Send short summary SMS to Zak
  const summaryLine = `📊 Swell Call Report (last 48h)\n${statsBlock}\nBooking rate: ${total > 0 ? Math.round(withBooking / total * 100) : 0}%\n\nFull analysis + prompt suggestions saved in CRM → /reports (ID: ${reportId})`;
  
  // Get any tenant's Twilio number to send from (use first available)
  const firstTenant = tenants[0];
  if (firstTenant?.twilio_from) {
    await sendSms(ADMIN_PHONE, summaryLine, firstTenant.twilio_from);
    await sql`UPDATE swell_call_reports SET sent_at = NOW() WHERE id = ${reportId}`;
    console.log(`[call-reporter] Report ${reportId} sent to ${ADMIN_PHONE}`);
  }
}
