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

// Check nurture job statuses and schema
const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='swell_nurture_jobs' ORDER BY ordinal_position`;
console.log("Columns:", cols.map(c=>c.column_name).join(", "));

const statuses = await sql`SELECT status, count(*) as count FROM swell_nurture_jobs WHERE tenant_id='mackwash' GROUP BY status`;
console.log("Statuses:", JSON.stringify(statuses));

const upcoming = await sql`SELECT id, lead_id, kind, status, fire_at FROM swell_nurture_jobs WHERE tenant_id='mackwash' AND fire_at > NOW() ORDER BY fire_at ASC LIMIT 20`;
console.log("Upcoming jobs:", JSON.stringify(upcoming));

await sql.end();
