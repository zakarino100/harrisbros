// Fix Chante Freeman + cancel all pending nurture jobs for old MackWash leads
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });

// 1. Find Chante
const leads = await sql`
  SELECT id, full_name, phone, status
  FROM swell_leads
  WHERE tenant_id = 'mackwash'
    AND full_name ILIKE '%Chante%'
  LIMIT 1
`;
console.log("Lead:", leads[0]);

if (!leads[0]) {
  console.log("Lead not found");
  process.exit(1);
}

const leadId = leads[0].id;

// 2. Check her conversation
const convs = await sql`
  SELECT id, status, total_messages
  FROM swell_conversations
  WHERE lead_id = ${leadId}
`;
console.log("Conversation:", convs[0]);

// 3. Cancel all her pending nurture jobs
const cancelled = await sql`
  UPDATE swell_nurture_jobs
  SET status = 'cancelled'
  WHERE lead_id = ${leadId}
    AND status = 'scheduled'
  RETURNING id, kind, fire_at
`;
console.log("Cancelled nurture jobs:", cancelled);

// 4. Mark her conversation as stopped
if (convs[0]) {
  await sql`
    UPDATE swell_conversations
    SET status = 'stopped', handoff_reason = 'manual_stop_old_lead'
    WHERE id = ${convs[0].id}
  `;
  console.log("Conversation marked stopped");
}

// 5. Also cancel ALL pending nurture jobs for MackWash leads from May 11-14
const bulkCancelled = await sql`
  UPDATE swell_nurture_jobs nj
  SET status = 'cancelled'
  FROM swell_leads l
  WHERE nj.lead_id = l.id
    AND l.tenant_id = 'mackwash'
    AND l.created_at >= '2026-05-11'
    AND nj.status = 'scheduled'
  RETURNING nj.id, l.full_name, nj.kind, nj.fire_at
`;
console.log(`Bulk cancelled ${bulkCancelled.length} pending nurture jobs for May 11-14 leads`);
bulkCancelled.forEach(j => console.log(`  - ${j.full_name}: ${j.kind} @ ${j.fire_at}`));

// 6. Mark all those conversations stopped too
const bulkStopped = await sql`
  UPDATE swell_conversations c
  SET status = 'stopped', handoff_reason = 'manual_stop_old_lead'
  FROM swell_leads l
  WHERE c.lead_id = l.id
    AND l.tenant_id = 'mackwash'
    AND l.created_at >= '2026-05-11'
    AND c.status = 'active'
  RETURNING c.id, l.full_name
`;
console.log(`Stopped ${bulkStopped.length} active conversations`);
bulkStopped.forEach(c => console.log(`  - ${c.full_name}`));

await sql.end();
process.exit(0);
