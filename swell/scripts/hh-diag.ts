import postgres from "postgres";

// Using the Supabase connection pooler (more reliable)
const HH_DB = "postgresql://postgres.hclpovktywijfnswthpm:Eaglesfan1998!@aws-1-us-east-1.pooler.supabase.com:5432/postgres";
const sql = postgres(HH_DB, { ssl: { rejectUnauthorized: false }, max: 2 });

async function main() {
  // 1. Most recent leads (any source)
  console.log("\n📋 RECENT LEADS (last 10):");
  const allLeads = await sql`
    SELECT id, full_name, phone, status, source, created_at
    FROM leads ORDER BY created_at DESC LIMIT 10
  `.catch(e => { console.log("  leads table:", e.message); return []; });
  for (const l of allLeads) {
    console.log(`  #${l.id} ${l.full_name||"?"} | ${l.status} | ${l.source} | ${new Date(l.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}`);
  }

  // 2. Conversations with Discord threads
  console.log("\n💬 CONVERSATIONS (last 5, with Discord status):");
  const convos = await sql`
    SELECT hc.id, hc.lead_id, hc.discord_thread_id, hc.status, hc.created_at,
           l.full_name, l.source
    FROM hh_conversations hc
    JOIN leads l ON hc.lead_id = l.id
    ORDER BY hc.created_at DESC LIMIT 5
  `.catch(e => { console.log("  hh_conversations:", e.message); return []; });
  for (const c of convos) {
    const dc = c.discord_thread_id ? `✅ thread:${c.discord_thread_id}` : "❌ no thread";
    console.log(`  #${c.id} ${c.full_name||"?"} | ${c.status} | ${dc} | ${new Date(c.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}`);
  }

  // 3. Reactivation campaigns
  console.log("\n📧 CAMPAIGNS (last 5):");
  const campaigns = await sql`
    SELECT id, name, status, created_at,
           (SELECT COUNT(*) FROM hh_campaign_sends WHERE campaign_id = hh_campaigns.id) as sends
    FROM hh_campaigns ORDER BY created_at DESC LIMIT 5
  `.catch(e => { console.log("  hh_campaigns:", e.message); return []; });
  for (const c of campaigns) {
    console.log(`  #${c.id} "${c.name}" | ${c.status} | ${c.sends} sends | ${new Date(c.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}`);
  }

  // 4. Recent campaign sends
  console.log("\n📤 CAMPAIGN SENDS (last 10):");
  const sends = await sql`
    SELECT cs.id, cs.status, cs.created_at, c.name as campaign_name, l.full_name, l.phone
    FROM hh_campaign_sends cs
    JOIN hh_campaigns c ON cs.campaign_id = c.id
    JOIN leads l ON cs.lead_id = l.id
    ORDER BY cs.created_at DESC LIMIT 10
  `.catch(e => { console.log("  hh_campaign_sends:", e.message); return []; });
  for (const s of sends) {
    console.log(`  #${s.id} [${s.status}] "${s.campaign_name}" → ${s.full_name||s.phone} | ${new Date(s.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}`);
  }

  // 5. Campaign replies
  console.log("\n📩 CAMPAIGN REPLIES (last 5):");
  const replies = await sql`
    SELECT cr.id, cr.lead_id, cr.intent_label, cr.discord_channel_id, cr.created_at, l.full_name
    FROM hh_campaign_replies cr
    JOIN leads l ON cr.lead_id = l.id
    ORDER BY cr.created_at DESC LIMIT 5
  `.catch(e => { console.log("  hh_campaign_replies:", e.message); return []; });
  for (const r of replies) {
    const dc = r.discord_channel_id ? "✅" : "❌";
    console.log(`  #${r.id} ${r.full_name||"?"} | ${r.intent_label} | Discord: ${dc} | ${new Date(r.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}`);
  }

  // 6. FB lead meta
  console.log("\n🔵 FB LEADS (last 5 synced):");
  const fbLeads = await sql`
    SELECT fl.id, fl.meta_lead_id, fl.created_at, l.full_name, l.status
    FROM hh_fb_lead_details fl
    JOIN leads l ON fl.lead_id = l.id
    ORDER BY fl.created_at DESC LIMIT 5
  `.catch(e => { console.log("  hh_fb_lead_details:", e.message); return []; });
  for (const f of fbLeads) {
    console.log(`  #${f.id} ${f.full_name||"?"} | ${f.status} | ${f.meta_lead_id} | ${new Date(f.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}`);
  }

  // 7. Integration logs
  console.log("\n🔧 INTEGRATION LOGS (last 5):");
  const logs = await sql`
    SELECT id, event_type, status, message, created_at
    FROM hh_integration_logs
    ORDER BY created_at DESC LIMIT 5
  `.catch(e => { console.log("  hh_integration_logs:", e.message); return []; });
  for (const lg of logs) {
    console.log(`  [${lg.event_type}] ${lg.status} | ${lg.message?.slice(0,60)} | ${new Date(lg.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}`);
  }

  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
