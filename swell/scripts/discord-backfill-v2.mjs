/**
 * Discord backfill v2 — posts proper lead card message + thread for every
 * non-test lead. Uses the new format: visible embed in channel, thread attached.
 * Also stores discord_thread_id on the lead and conversation records.
 * Run: node scripts/discord-backfill-v2.mjs
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

function tenantEnv(tenantId, key) {
  return process.env[`${tenantId.toUpperCase()}_${key}`] ?? "";
}

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
  const channelId = tenantEnv(tenant.id, "DISCORD_LEADS_CHANNEL_ID");
  if (!channelId) { console.warn(`  [skip] No leads channel for ${tenant.id}`); return null; }

  const slug = tenant.slug ?? tenant.id.replace(/_/g, "");
  const crmLink = `https://${slug}.${APEX}/leads/${lead.id}`;
  const dateStr = new Date(lead.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // Parse home_size and timeline from raw_payload if available
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
    footer: { text: `Lead ID: ${lead.id} · ${tenant.name}` },
    timestamp: new Date(lead.created_at).toISOString(),
  };

  const components = [{ type: 1, components: [{ type: 2, style: 5, label: "Open in CRM", url: crmLink }] }];
  const pingLine = `@here 🔔 **New Lead — ${lead.full_name ?? "Unknown"}** | 📞 ${lead.phone ?? "—"} | ${tenant.name}`;

  // Post visible message
  const msg = await discordPost(`/channels/${channelId}/messages`, {
    content: pingLine, embeds: [embed], components,
  });

  if (!msg.ok) {
    console.error(`  ❌ Message failed for lead ${lead.id}: ${msg.status} ${JSON.stringify(msg.data).slice(0, 100)}`);
    return null;
  }

  const msgId = msg.data?.id;
  if (!msgId) return null;

  // Create thread from that message
  const threadName = `${lead.full_name ?? "Lead"} — ${dateStr}`;
  const thread = await discordPost(`/channels/${channelId}/messages/${msgId}/threads`, {
    name: threadName,
    auto_archive_duration: 10080,
  });

  const threadId = thread.ok ? (thread.data?.id ?? msgId) : msgId;
  console.log(`  ✅ ${lead.full_name ?? "Lead"} — thread: ${threadId}`);
  return threadId;
}

async function main() {
  const tenants = await sql`SELECT * FROM swell_tenants WHERE id IN ('harris_bros', 'mackwash')`;

  for (const tenant of tenants) {
    console.log(`\n=== ${tenant.name} ===`);
    const leads = await sql`
      SELECT * FROM swell_leads
      WHERE tenant_id = ${tenant.id}
        AND status NOT IN ('archived')
        AND (full_name IS NULL OR full_name NOT LIKE '<test%')
        AND (full_name IS NULL OR full_name NOT LIKE 'Real Loop%')
      ORDER BY created_at ASC
    `;
    console.log(`  ${leads.length} leads to post`);

    for (const lead of leads) {
      const threadId = await postLeadCard(tenant, lead);

      if (threadId) {
        // Store thread ID on lead
        await sql`UPDATE swell_leads SET discord_thread_id = ${threadId} WHERE id = ${lead.id}`;

        // Store on conversation if one exists
        await sql`
          UPDATE swell_conversations
          SET discord_thread_id = ${threadId}
          WHERE lead_id = ${lead.id} AND tenant_id = ${tenant.id}
        `;
      }

      await new Promise(r => setTimeout(r, 1200)); // ~50 req/min rate limit
    }
  }

  await sql.end();
  console.log("\n✅ Backfill v2 complete");
}

main().catch(e => { console.error(e); process.exit(1); });
