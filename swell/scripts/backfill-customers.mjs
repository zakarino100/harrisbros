// Reads all existing leads, creates customer records, links them
import postgres from "postgres";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");
const envText = readFileSync(envPath, "utf8");
for (const line of envText.split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2];
}

const sql = postgres(process.env.DATABASE_URL, {
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const leads = await sql`
    SELECT * FROM swell_leads
    WHERE customer_id IS NULL
      AND status NOT IN ('test','archived')
      AND (full_name IS NULL OR full_name NOT LIKE '<test%')
      AND phone IS NOT NULL
    ORDER BY created_at ASC
  `;

  console.log(`Backfilling ${leads.length} leads...`);
  let linked = 0, created = 0;

  for (const lead of leads) {
    const norm = (lead.phone ?? "").replace(/\D/g, "").slice(-10);
    
    // Check for existing customer by phone
    const existing = await sql`
      SELECT id FROM swell_customers
      WHERE tenant_id = ${lead.tenant_id}
        AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE ${'%' + norm}
      LIMIT 1
    `;

    let customerId;
    if (existing.length) {
      customerId = existing[0].id;
      // Enrich with any new info
      await sql`
        UPDATE swell_customers SET
          full_name = COALESCE(${lead.full_name}, full_name),
          email = COALESCE(${lead.email}, email),
          address = COALESCE(${lead.address}, address),
          city = COALESCE(${lead.city}, city),
          state = COALESCE(${lead.state}, state),
          zip = COALESCE(${lead.zip}, zip),
          updated_at = NOW()
        WHERE id = ${customerId}
      `;
      linked++;
    } else {
      const rows = await sql`
        INSERT INTO swell_customers
          (tenant_id, full_name, phone, email, address, city, state, zip, source, lead_score)
        VALUES
          (${lead.tenant_id}, ${lead.full_name}, ${lead.phone}, ${lead.email},
           ${lead.address}, ${lead.city}, ${lead.state}, ${lead.zip}, 'facebook_ad',
           ${lead.lead_score ?? 50})
        RETURNING id
      `;
      customerId = rows[0].id;
      created++;
    }

    await sql`UPDATE swell_leads SET customer_id = ${customerId} WHERE id = ${lead.id}`;
  }

  console.log(`Done — ${created} customers created, ${linked} leads linked to existing`);
  await sql.end();
}

main().catch(e => { console.error(e); process.exit(1); });
