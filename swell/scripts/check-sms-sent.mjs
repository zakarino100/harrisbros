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

// Check ALL assistant messages for mackwash — did any nurture refusals get sent via SMS?
const msgs = await sql`
  SELECT cm.id, cm.role, cm.twilio_sid, cm.created_at, LEFT(cm.body, 100) as preview,
         l.full_name, l.phone
  FROM swell_conversation_messages cm
  JOIN swell_conversations c ON c.id = cm.conversation_id
  JOIN swell_leads l ON l.id = c.lead_id
  WHERE cm.tenant_id = 'mackwash'
    AND cm.role = 'assistant'
  ORDER BY cm.created_at DESC
  LIMIT 30
`;

console.log("=== MackWash assistant messages (most recent first) ===\n");
let sentCount = 0, notSentCount = 0;
msgs.forEach(m => {
  const sent = !!m.twilio_sid;
  if (sent) sentCount++; else notSentCount++;
  console.log(`[${sent ? '📤 SENT via SMS' : '🔒 NOT sent (internal)'}] ${m.full_name} | ${m.created_at}`);
  console.log(`  → ${m.preview}`);
  console.log(`  twilio_sid: ${m.twilio_sid ?? 'NULL'}\n`);
});

console.log(`\nSummary: ${sentCount} sent via SMS, ${notSentCount} internal only`);

await sql.end();
