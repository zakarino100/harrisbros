/**
 * Admin tenant management script
 * Usage: pnpm tsx scripts/admin-tenant-update.ts
 *
 * Performs:
 * 1. List all tenants with lead counts
 * 2. Disable Harris Bros
 * 3. Change Harris Bros password to "nopressurelaunchstop"
 * 4. Verify MackWash configuration
 * 5. Check for recent MackWash leads and their Discord notification status
 */

import postgres from "postgres";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";
import path from "path";
import dotenv from "dotenv";

// Load env vars
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("ERROR: DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(databaseUrl, {
  ssl: { rejectUnauthorized: false },
  max: 3,
  idle_timeout: 20,
  max_lifetime: 60 * 10,
  connect_timeout: 15,
});

async function main() {
  try {
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("🔧 SWELL TENANT ADMIN SCRIPT");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // 1. List all tenants with stats
    console.log("📋 ALL TENANTS:\n");
    const tenants = await sql`
      SELECT id, name, slug, enabled, created_at FROM swell_tenants ORDER BY name ASC
    `;

    for (const t of tenants) {
      const [leadCount] = await sql`
        SELECT COUNT(*) as count FROM swell_leads WHERE tenant_id = ${t.id}
      `;
      const leadCountVal = leadCount?.count || 0;
      const status = t.enabled ? "✅ ENABLED" : "❌ DISABLED";
      console.log(`  ${status} | ${t.name} (${t.slug})`);
      console.log(`         ID: ${t.id}`);
      console.log(`         Leads: ${leadCountVal}`);
      console.log("");
    }

    // 2. Find Harris Bros
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\n🔴 DISABLING HARRIS BROS & CHANGING PASSWORD\n");

    const harrisBros = await sql`
      SELECT id, name, slug FROM swell_tenants WHERE slug = 'harrisbrosads'
    `;

    if (!harrisBros[0]) {
      console.error("  ❌ Harris Bros tenant not found!");
      process.exit(1);
    }

    const hbId = harrisBros[0].id;
    const newPassword = "nopressurelaunchstop";
    const newHash = await bcrypt.hash(newPassword, 10);

    // Update Harris Bros
    await sql`
      UPDATE swell_tenants
      SET enabled = FALSE, password_hash = ${newHash}
      WHERE id = ${hbId}
    `;

    console.log(`  ✅ Harris Bros (${hbId})`);
    console.log(`     Status: DISABLED`);
    console.log(`     Password hash: ${newHash.slice(0, 20)}...`);
    console.log(`     New password: ${newPassword}`);

    // Check how many leads they have
    const [hbLeadCount] = await sql`
      SELECT COUNT(*) as count FROM swell_leads WHERE tenant_id = ${hbId}
    `;
    console.log(`     Total leads (will no longer sync): ${hbLeadCount?.count || 0}`);

    // 3. Check MackWash config
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\n🟢 MACKWASH CONFIGURATION\n");

    const mackwash = await sql`
      SELECT * FROM swell_tenants WHERE slug = 'mackwash'
    `;

    if (!mackwash[0]) {
      console.error("  ❌ MackWash tenant not found!");
      process.exit(1);
    }

    const mwId = mackwash[0].id;
    console.log(`  ID: ${mwId}`);
    console.log(`  Name: ${mackwash[0].name}`);
    console.log(`  Slug: ${mackwash[0].slug}`);
    console.log(`  Status: ${mackwash[0].enabled ? "✅ ENABLED" : "❌ DISABLED"}`);
    console.log(`  Contact phone: ${mackwash[0].contact_phone}`);
    console.log(`  Twilio from: ${mackwash[0].twilio_from}`);
    console.log(`  FB form IDs: ${JSON.stringify(mackwash[0].fb_form_ids)}`);
    console.log(`  FB page IDs: ${JSON.stringify(mackwash[0].fb_page_ids)}`);
    console.log(`  FB page token configured: ${mackwash[0].fb_page_token ? "✅ YES" : "❌ NO"}`);

    // 4. Check MackWash leads
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\n📞 MACKWASH LEADS (last 10)\n");

    const leads = await sql`
      SELECT id, meta_lead_id, full_name, phone, created_at, discord_thread_id, status
      FROM swell_leads
      WHERE tenant_id = ${mwId}
      ORDER BY created_at DESC
      LIMIT 10
    `;

    if (leads.length === 0) {
      console.log("  ⚠️  No leads found for MackWash");
    } else {
      console.log(`  Found ${leads.length} lead(s):\n`);
      for (const lead of leads) {
        const discordStatus = lead.discord_thread_id ? `✅ Discord thread: ${lead.discord_thread_id}` : "❌ No Discord thread";
        console.log(`    • Lead #${lead.id}: ${lead.full_name || "Unknown"}`);
        console.log(`      Phone: ${lead.phone || "—"}`);
        console.log(`      Created: ${lead.created_at}`);
        console.log(`      Meta ID: ${lead.meta_lead_id}`);
        console.log(`      Status: ${lead.status}`);
        console.log(`      ${discordStatus}`);
        console.log("");
      }
    }

    // 5. Check lead activity for Discord notifications
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\n📊 LEAD ACTIVITY (Discord notifications)\n");

    const activities = await sql`
      SELECT id, lead_id, type, body, created_at
      FROM swell_lead_activity
      WHERE tenant_id = ${mwId}
        AND type LIKE '%discord%'
      ORDER BY created_at DESC
      LIMIT 5
    `;

    if (activities.length === 0) {
      console.log("  ⚠️  No Discord notification activities found");
    } else {
      console.log(`  Discord activities:\n`);
      for (const a of activities) {
        console.log(`    • ${a.type} (lead #${a.lead_id})`);
        console.log(`      Time: ${a.created_at}`);
        console.log(`      Body: ${a.body}`);
        console.log("");
      }
    }

    // 6. Check conversation status
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\n💬 MACKWASH CONVERSATIONS\n");

    const convs = await sql`
      SELECT c.id, c.lead_id, c.status, c.total_messages, c.created_at
      FROM swell_conversations c
      WHERE c.tenant_id = ${mwId}
      ORDER BY c.created_at DESC
      LIMIT 5
    `;

    if (convs.length === 0) {
      console.log("  ⚠️  No conversations found");
    } else {
      console.log(`  ${convs.length} conversation(s):\n`);
      for (const c of convs) {
        console.log(`    • Conversation #${c.id} (lead #${c.lead_id})`);
        console.log(`      Status: ${c.status}`);
        console.log(`      Messages: ${c.total_messages}`);
        console.log(`      Created: ${c.created_at}`);
        console.log("");
      }
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\n✅ ADMIN UPDATE COMPLETE\n");

    process.exit(0);
  } catch (error: any) {
    console.error("\n❌ ERROR:", error.message);
    console.error(error);
    process.exit(1);
  }
}

main();
