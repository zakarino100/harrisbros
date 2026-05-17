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

// Get columns for messages table
const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='swell_conversation_messages' ORDER BY ordinal_position`;
console.log("swell_conversation_messages columns:", cols.map(c=>c.column_name).join(", "));

// Get a sample message for conv 41
const msgs = await sql`SELECT * FROM swell_conversation_messages WHERE conversation_id='41' ORDER BY created_at ASC LIMIT 20`;
console.log("\nMessages for conv 41 (Harriett):");
msgs.forEach(m => {
  const {id, role, created_at, ...rest} = m;
  // Find text-like field
  const textField = rest.message ?? rest.body ?? rest.text ?? rest.content ?? JSON.stringify(rest).slice(0,150);
  console.log(JSON.stringify({id, role, created_at, text: String(textField).slice(0,120), keys: Object.keys(rest)}));
});

// Nurture jobs
const nurture = await sql`SELECT id, lead_id, fire_at, status, message_type FROM swell_nurture_jobs WHERE tenant_id='mackwash' ORDER BY created_at DESC LIMIT 10`;
console.log("\nNurture jobs:");
nurture.forEach(n => console.log(JSON.stringify(n)));

await sql.end();
