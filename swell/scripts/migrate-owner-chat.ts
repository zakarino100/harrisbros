/**
 * Migration: add owner Discord fields to swell_tenants
 * Run once: npx tsx scripts/migrate-owner-chat.ts
 */
import { sql } from "../server/db/index.js";

async function migrate() {
  console.log("Running owner-chat migration...");

  await sql`
    ALTER TABLE swell_tenants
      ADD COLUMN IF NOT EXISTS owner_discord_user_id TEXT,
      ADD COLUMN IF NOT EXISTS owner_discord_channel_id TEXT,
      ADD COLUMN IF NOT EXISTS owner_name TEXT
  `;

  // Seed MackWash owner info
  await sql`
    UPDATE swell_tenants SET
      owner_discord_user_id = '1327340335675736125',
      owner_name            = 'Mack'
    WHERE id = 'mackwash'
  `;

  console.log("✅ Migration complete.");
  console.log("   • owner_discord_user_id added");
  console.log("   • owner_discord_channel_id added");
  console.log("   • owner_name added");
  console.log("   • MackWash seeded with Mack's Discord user ID");
  console.log("");
  console.log("To set owner-chat channel (optional):");
  console.log("  UPDATE swell_tenants SET owner_discord_channel_id = '<channel_id>' WHERE id = 'mackwash';");
  process.exit(0);
}

migrate().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
