/**
 * Discord Backfill Script
 *
 * Catches up any leads that were created while the Discord gateway was down.
 * This script finds leads in the last 24 hours that don't have discord_thread_id
 * and sends them to Discord notification channels.
 *
 * Usage: npx ts-node scripts/discord-backfill.ts
 */

import { sql } from "../server/db/index.js";
import { notifyNewLeadDiscord } from "../server/services/discord.js";
import { listTenants } from "../server/db/queries.js";

const BACKFILL_HOURS = process.env.BACKFILL_HOURS ? parseInt(process.env.BACKFILL_HOURS) : 24;
const DRY_RUN = process.env.DRY_RUN === "true";

async function main(): Promise<void> {
  console.log(`\n🔄 Discord Backfill — Last ${BACKFILL_HOURS} hours${DRY_RUN ? " [DRY RUN]" : ""}`);
  console.log("=".repeat(60));

  try {
    const tenants = await listTenants();
    let totalBackfilled = 0;
    let totalErrors = 0;

    for (const tenant of tenants) {
      if (!tenant.enabled) {
        console.log(`\n⊘ ${tenant.id} — disabled, skipping`);
        continue;
      }

      console.log(`\n📢 ${tenant.id}:`);

      // Find leads without discord_thread_id in the backfill window
      const backfillMs = BACKFILL_HOURS * 60 * 60 * 1000;
      const cutoffTime = new Date(Date.now() - backfillMs).toISOString();
      
      const missed = await sql<
        Array<{
          id: number;
          full_name: string | null;
          phone: string | null;
          email: string | null;
          created_at: string;
        }>
      >`
        SELECT id, full_name, phone, email, created_at
        FROM swell_leads
        WHERE tenant_id = ${tenant.id}
          AND discord_thread_id IS NULL
          AND status NOT IN ('archived', 'test')
          AND created_at > ${cutoffTime}
        ORDER BY created_at ASC
      `;

      if (!missed.length) {
        console.log(`   ✓ No missed leads in the last ${BACKFILL_HOURS}h`);
        continue;
      }

      console.log(`   Found ${missed.length} lead(s) to backfill:`);

      for (const lead of missed) {
        const leadInfo = `${lead.full_name || "Unknown"} (${lead.phone || lead.email || "no contact"})`;
        const createdAt = new Date(lead.created_at).toLocaleString("en-US", {
          timeZone: "America/New_York",
        });

        try {
          if (DRY_RUN) {
            console.log(`   [DRY] Lead #${lead.id}: ${leadInfo} (created ${createdAt})`);
          } else {
            const threadId = await notifyNewLeadDiscord(tenant.id, tenant.name ?? tenant.id, {
              leadId: lead.id,
              name: lead.full_name,
              phone: lead.phone,
              email: lead.email,
            });

            if (threadId) {
              await sql`UPDATE swell_leads SET discord_thread_id = ${threadId} WHERE id = ${lead.id}`;
              console.log(
                `   ✓ Lead #${lead.id}: ${leadInfo} → thread ${threadId} (${createdAt})`
              );
              totalBackfilled++;
            } else {
              console.log(`   ✗ Lead #${lead.id}: ${leadInfo} — no thread created`);
              totalErrors++;
            }
          }

          // Rate limit to avoid Discord abuse
          await new Promise((r) => setTimeout(r, 500));
        } catch (e: any) {
          console.error(
            `   ✗ Lead #${lead.id}: ${leadInfo} — ${e?.message || "unknown error"}`
          );
          totalErrors++;
        }
      }
    }

    console.log("\n" + "=".repeat(60));
    if (DRY_RUN) {
      console.log(`✓ DRY RUN COMPLETE — no changes made`);
    } else {
      console.log(
        `✓ BACKFILL COMPLETE — ${totalBackfilled} notified, ${totalErrors} error(s)`
      );
    }
    console.log("=".repeat(60) + "\n");

    process.exit(totalErrors > 0 ? 1 : 0);
  } catch (e: any) {
    console.error("\n❌ Backfill error:", e?.message || e);
    process.exit(1);
  }
}

main();
