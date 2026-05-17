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

// Check all inbound (user) messages for mackwash
const inbound = await sql`
  SELECT cm.id, cm.role, cm.created_at, LEFT(cm.body, 100) as preview,
         l.full_name, l.phone
  FROM swell_conversation_messages cm
  JOIN swell_conversations c ON c.id = cm.conversation_id
  JOIN swell_leads l ON l.id = c.lead_id
  WHERE cm.tenant_id = 'mackwash'
    AND cm.role = 'user'
  ORDER BY cm.created_at DESC
  LIMIT 20
`;

console.log(`=== Inbound customer messages for MackWash (${inbound.length} found) ===\n`);
if (inbound.length === 0) {
  console.log("NO inbound messages logged — customers either haven't replied or inbound webhook isn't working.");
} else {
  inbound.forEach(m => console.log(`[${m.created_at}] ${m.full_name}: ${m.preview}`));
}

// Check Twilio webhook config
console.log("\n=== Twilio config ===");
console.log("MACKWASH_TWILIO_FROM:", process.env.MACKWASH_TWILIO_FROM ?? "(not set)");
console.log("TWILIO_ACCOUNT_SID:", process.env.TWILIO_ACCOUNT_SID ? "✅ set" : "❌ missing");

// Check if there's a Twilio inbound route
const tenants = await sql`SELECT id, twilio_from, contact_phone FROM swell_tenants WHERE id='mackwash'`;
console.log("MackWash tenant twilio_from:", tenants[0]?.twilio_from ?? "(null)");

await sql.end();
