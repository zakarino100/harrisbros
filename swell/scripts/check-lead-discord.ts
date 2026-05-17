/**
 * Check Discord notification status for a specific lead
 * Usage: pnpm tsx scripts/check-lead-discord.ts <lead-id>
 */

import postgres from "postgres";
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
});

async function main() {
  try {
    // Lead #50 specifically (the recent one without Discord thread)
    const leadId = 50;

    console.log(`\n🔍 CHECKING LEAD #${leadId} DISCORD STATUS\n`);

    // Get lead details
    const lead = await sql`
      SELECT * FROM swell_leads WHERE id = ${leadId}
    `;

    if (!lead[0]) {
      console.log(`❌ Lead #${leadId} not found`);
      process.exit(1);
    }

    const leadRec = lead[0];
    console.log("📍 LEAD DETAILS:");
    console.log(`  ID: ${leadRec.id}`);
    console.log(`  Name: ${leadRec.full_name}`);
    console.log(`  Phone: ${leadRec.phone}`);
    console.log(`  Tenant: ${leadRec.tenant_id}`);
    console.log(`  Created: ${leadRec.created_at}`);
    console.log(`  Discord Thread ID: ${leadRec.discord_thread_id || "❌ MISSING"}`);
    console.log(`  Meta Lead ID: ${leadRec.meta_lead_id}`);

    // Get tenant config
    console.log(`\n🏢 TENANT CONFIG:`);
    const tenant = await sql`
      SELECT * FROM swell_tenants WHERE id = ${leadRec.tenant_id}
    `;

    if (tenant[0]) {
      const t = tenant[0];
      console.log(`  Name: ${t.name}`);
      console.log(`  Discord Guild ID: ${process.env[`${t.id.toUpperCase()}_DISCORD_GUILD_ID`] || "❌ NOT SET"}`);
      console.log(`  Discord Leads Channel: ${process.env[`${t.id.toUpperCase()}_DISCORD_LEADS_CHANNEL_ID`] || "❌ NOT SET"}`);
      console.log(`  Bot token configured: ${process.env.DISCORD_BOT_TOKEN ? "✅ YES" : "❌ NO"}`);
    }

    // Get conversation messages to see if there's an error
    console.log(`\n💬 CONVERSATION DETAILS:`);
    const convs = await sql`
      SELECT * FROM swell_conversations WHERE lead_id = ${leadId}
    `;

    if (convs[0]) {
      const c = convs[0];
      console.log(`  Conversation ID: ${c.id}`);
      console.log(`  Status: ${c.status}`);
      console.log(`  Messages: ${c.total_messages}`);
      console.log(`  Created: ${c.created_at}`);
      console.log(`  Discord Thread ID: ${c.discord_thread_id || "❌ MISSING"}`);

      // Get all messages in the conversation
      const messages = await sql`
        SELECT id, role, body, error, created_at
        FROM swell_conversation_messages
        WHERE conversation_id = ${c.id}
        ORDER BY created_at ASC
      `;

      console.log(`\n  📨 MESSAGES (${messages.length}):`);
      for (const msg of messages) {
        const roleEmoji = msg.role === "user" ? "👤" : "🤖";
        console.log(`    ${roleEmoji} ${msg.role.toUpperCase()} @ ${msg.created_at}`);
        if (msg.error) {
          console.log(`       ⚠️  ERROR: ${msg.error}`);
        }
        console.log(`       ${msg.body.slice(0, 80)}${msg.body.length > 80 ? "..." : ""}`);
      }
    }

    // Get activity log
    console.log(`\n📊 ACTIVITY LOG:`);
    const activities = await sql`
      SELECT * FROM swell_lead_activity
      WHERE lead_id = ${leadId}
      ORDER BY created_at ASC
    `;

    if (activities.length === 0) {
      console.log(`  (no activities logged)`);
    } else {
      for (const a of activities) {
        console.log(`  [${a.type}] @ ${a.created_at}`);
        console.log(`    ${a.body}`);
        if (a.metadata?.error) {
          console.log(`    ⚠️  ERROR: ${a.metadata.error}`);
        }
      }
    }

    console.log("\n");
    process.exit(0);
  } catch (error: any) {
    console.error("\n❌ ERROR:", error.message);
    console.error(error);
    process.exit(1);
  }
}

main();
