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

const convs = await sql`SELECT c.id, c.status, l.full_name FROM swell_conversations c JOIN swell_leads l ON l.id=c.lead_id WHERE l.full_name ILIKE '%harriett%' AND c.tenant_id='mackwash'`;
console.log("Conversations:", JSON.stringify(convs, null, 2));

if (convs.length > 0) {
  const msgs = await sql`SELECT role, content, sent_via_sms, created_at, metadata FROM swell_conversation_messages WHERE conversation_id=${convs[0].id} ORDER BY created_at ASC`;
  console.log("\nMessages:");
  msgs.forEach(m => console.log(JSON.stringify({
    role: m.role,
    sent_via_sms: m.sent_via_sms,
    preview: String(m.content ?? "").slice(0, 120),
    meta: m.metadata
  })));
}

// Also check nurture jobs for mackwash
const nurture = await sql`SELECT id, lead_id, fire_at, status, message_type FROM swell_nurture_jobs WHERE tenant_id='mackwash' ORDER BY created_at DESC LIMIT 20`;
console.log("\nNurture jobs (recent):");
nurture.forEach(n => console.log(JSON.stringify(n)));

await sql.end();
