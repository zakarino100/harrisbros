/**
 * discord-backfill-missing.mjs
 * Backfills ONLY MackWash leads that are missing a discord_thread_id.
 * Safe to run multiple times — skips any lead that already has a thread.
 * Run: node scripts/discord-backfill-missing.mjs
 */
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

import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL);
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_API = "https://discord.com/api/v10";
const APEX = process.env.SWELL_APEX_DOMAIN ?? "nopressurelaunch.com";
const TENANT_ID = "mackwash";

async function discordPost(path, body) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, data };
}

async function postLeadCard(tenant, lead) {
  const channelId = process.env[`${TENANT_ID.toUpperCase()}_DISCORD_LEADS_CHANNEL_ID`];
  if (!channelId) { console.error("  ❌ No MACKWASH_DISCORD_LEADS_CHANNEL_ID in env"); process.exit(1); }

  const slug = tenant.slug ?? TENANT_ID.replace(/_/g, "");
  const crmLink = `https://${slug}.${APEX}/leads/${lead.id}`;
  const dateStr = new Date(lead.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const meta = typeof lead.raw_payload === "object" ? lead.raw_payload : {};
  const homeSize = meta.home_size ?? meta.approximate_home_size ?? null;
  const timeline = meta.timeline ?? null;
  const notes = lead.notes ?? null;

  const fields = [
    { name: "📞 Phone", value: lead.phone ?? "—", inline: true },
    { name: "📧 Email", value: lead.email ?? "—", inline: true },
    ...(homeSize ? [{ name: "📐 Home Size", value: String(homeSize).replace(/_/g, " "), inline: true }] : []),
    ...(timeline ? [{ name: "⏰ Timeline", value: String(timeline).replace(/_/g, " "), inline: true }] : []),
    ...(notes ? [{ name: "📝 Notes", value: notes, inline: false }] : []),
    { name: "📅 Lead Date", value: dateStr, inline: true },
  ];

  const embed = {
    title: `🔔 New Lead — ${lead.full_name ?? "Unknown"}`,
    color: 0xfbbf24,
    fields,
    footer: { text: `Lead ID: ${lead.id} · MackWash Pressure Washing` },
    timestamp: new Date(lead.created_at).toISOString(),
  };

  const components = [{ type: 1, components: [{ type: 2, style: 5, label: "Open in CRM", url: crmLink }] }];
  const pingLine = `@here 🔔 **New Lead — ${lead.full_name ?? "Unknown"}** | 📞 ${lead.phone ?? "—"} | MackWash`;

  const msg = await discordPost(`/channels/${channelId}/messages`, {
    content: pingLine, embeds: [embed], components,
  });

  if (!msg.ok) {
    console.error(`  ❌ Message failed for lead ${lead.id}: ${msg.status} ${JSON.stringify(msg.data).slice(0, 200)}`);
    return null;
  }

  const msgId = msg.data?.id;
  if (!msgId) return null;

  const threadName = `${lead.full_name ?? "Lead"} — ${dateStr}`;
  const thread = await discordPost(`/channels/${channelId}/messages/${msgId}/threads`, {
    name: threadName,
    auto_archive_duration: 10080,
  });

  const threadId = thread.ok ? (thread.data?.id ?? msgId) : msgId;
  console.log(`  ✅ ${lead.full_name ?? "Lead"} (ID: ${lead.id}) — thread: ${threadId}`);
  return threadId;
}

async function main() {
  console.log("=== MackWash Discord Backfill (missing threads only) ===\n");

  const [tenant] = await sql`SELECT * FROM swell_tenants WHERE id = ${TENANT_ID}`;
  if (!tenant) { console.error("MackWash tenant not found"); process.exit(1); }

  // Only fetch leads with NO discord_thread_id
  const leads = await sql`
    SELECT * FROM swell_leads
    WHERE tenant_id = ${TENANT_ID}
      AND (discord_thread_id IS NULL OR discord_thread_id = '')
      AND status NOT IN ('archived')
      AND (full_name IS NULL OR (full_name NOT LIKE '<test%' AND full_name NOT LIKE 'Real Loop%'))
    ORDER BY created_at ASC
  `;

  console.log(`Found ${leads.length} lead(s) missing Discord threads.\n`);

  if (leads.length === 0) {
    console.log("✅ Nothing to backfill — all leads already have threads.");
    await sql.end();
    return;
  }

  let success = 0, failed = 0;

  for (const lead of leads) {
    console.log(`Processing: ${lead.full_name ?? "Unknown"} (${lead.phone ?? "no phone"}) — ${lead.created_at}`);
    const threadId = await postLeadCard(tenant, lead);

    if (threadId) {
      await sql`UPDATE swell_leads SET discord_thread_id = ${threadId} WHERE id = ${lead.id}`;
      await sql`
        UPDATE swell_conversations
        SET discord_thread_id = ${threadId}
        WHERE lead_id = ${lead.id} AND tenant_id = ${TENANT_ID}
      `;
      success++;
    } else {
      failed++;
    }

    await new Promise(r => setTimeout(r, 1200)); // ~50 req/min Discord rate limit
  }

  await sql.end();
  console.log(`\n✅ Done — ${success} created, ${failed} failed.`);
}

main().catch(e => { console.error(e); process.exit(1); });
