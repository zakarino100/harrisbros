/**
 * Finds all MackWash leads who received garbled AI refusal texts.
 * For each:
 *  - Pauses AI (ai_paused=true, status='stopped')
 *  - Logs activity: "manual follow-up needed — SMS failure"
 *  - Cancels any remaining nurture jobs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(resolve(__dirname, "../.env"), "utf8");
for (const line of envText.split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2];
}
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL);

// Find conversations that had hidden (garbled) messages sent to customers
const affected = await sql`
  SELECT DISTINCT
    c.id as conv_id,
    c.lead_id,
    c.status as conv_status,
    l.full_name,
    l.phone
  FROM swell_conversation_messages cm
  JOIN swell_conversations c ON c.id = cm.conversation_id
  JOIN swell_leads l ON l.id = c.lead_id
  WHERE cm.tenant_id = 'mackwash'
    AND cm.error = '_hidden'
    AND cm.twilio_sid IS NOT NULL
`;

console.log(`Found ${affected.length} affected lead(s):\n`);

for (const row of affected) {
  console.log(`Processing: ${row.full_name} (${row.phone}) — conv ${row.conv_id}`);

  // 1. Pause AI on the conversation
  await sql`
    UPDATE swell_conversations
    SET
      status = 'stopped',
      ai_paused = true,
      handoff_reason = 'sms_failure_manual_followup'
    WHERE id = ${row.conv_id}
  `;

  // 2. Log activity note
  await sql`
    INSERT INTO swell_lead_activity (lead_id, tenant_id, type, direction, body, created_at)
    VALUES (
      ${row.lead_id},
      'mackwash',
      'manual_followup_needed',
      'internal',
      'AI auto-responder deactivated. Lead received incorrect SMS messages due to system error. Manual follow-up required.',
      NOW()
    )
  `;

  // 3. Cancel any remaining nurture jobs
  const cancelled = await sql`
    UPDATE swell_nurture_jobs
    SET status = 'cancelled'
    WHERE lead_id = ${row.lead_id}
      AND tenant_id = 'mackwash'
      AND status = 'scheduled'
  `;

  console.log(`  ✅ AI paused, activity logged, ${cancelled.count} nurture job(s) cancelled`);
}

console.log(`\nDone. ${affected.length} lead(s) flagged for manual follow-up.`);
await sql.end();
