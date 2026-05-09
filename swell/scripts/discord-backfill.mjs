/**
 * Discord backfill — posts a lead notification thread for every
 * non-test lead in the CRM that doesn't already have a Discord thread.
 * Run once manually: node scripts/discord-backfill.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually
const envPath = resolve(__dirname, "../.env");
const envText = readFileSync(envPath, "utf8");
for (const line of envText.split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2];
}

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL);
const DISCORD_API = "https://discord.com/api/v10";
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

function tenantEnv(tenantId, key) {
  return process.env[`${tenantId.toUpperCase()}_${key}`] ?? "";
}

async function discordPost(path, body) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, data };
}

async function postLeadToDiscord(tenant, lead) {
  const channelId = tenantEnv(tenant.id, "DISCORD_LEADS_CHANNEL_ID");
  if (!channelId) {
    console.warn(`  [skip] No DISCORD_LEADS_CHANNEL_ID for ${tenant.id}`);
    return null;
  }

  const crmSlug = tenant.slug;
  const crmLink = `https://${crmSlug}.nopressurelaunch.com/leads/${lead.id}`;
  const dateStr = new Date(lead.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const notes = lead.notes ?? "";

  const pingLine = [
    `@here 🔔 **New Lead — ${lead.full_name ?? "Unknown"}**`,
    lead.phone ? `📞 ${lead.phone}` : null,
    lead.email ? `📧 ${lead.email}` : null,
    `📣 ${tenant.name}`,
  ].filter(Boolean).join("   |   ");

  const embed = {
    title: `🤖 New Lead — ${lead.full_name ?? "Unknown"}`,
    color: 0xfbbf24,
    fields: [
      { name: "📞 Phone", value: lead.phone ?? "—", inline: true },
      { name: "📧 Email", value: lead.email ?? "—", inline: true },
      ...(notes ? [{ name: "📝 Notes", value: notes, inline: false }] : []),
      { name: "📅 Lead Date", value: dateStr, inline: true },
    ],
    footer: { text: `Lead ID: ${lead.id} · ${tenant.name}` },
    timestamp: new Date(lead.created_at).toISOString(),
  };

  const components = [{
    type: 1,
    components: [{ type: 2, style: 5, label: "Open in CRM", url: crmLink }],
  }];

  const threadName = `${lead.full_name ?? "Lead"} — ${dateStr}`;

  // Try forum channel first
  const forum = await discordPost(`/channels/${channelId}/threads`, {
    name: threadName,
    message: { content: pingLine, embeds: [embed], components },
  });

  if (forum.ok) {
    console.log(`  ✅ Forum thread: ${forum.data?.id} — ${lead.full_name}`);
    return forum.data?.id ?? null;
  }

  // Fall back to text channel + thread
  const msg = await discordPost(`/channels/${channelId}/messages`, {
    content: pingLine, embeds: [embed], components,
  });

  if (!msg.ok) {
    console.error(`  ❌ Failed to post lead ${lead.id}: ${msg.status} ${JSON.stringify(msg.data)}`);
    return null;
  }

  const msgId = msg.data?.id;
  if (!msgId) return null;

  const thread = await discordPost(`/channels/${channelId}/messages/${msgId}/threads`, {
    name: threadName, auto_archive_duration: 10080,
  });

  const threadId = thread.ok ? thread.data?.id : msgId;
  console.log(`  ✅ Text+thread: ${threadId} — ${lead.full_name}`);
  return threadId;
}

async function main() {
  const tenants = await sql`SELECT * FROM swell_tenants WHERE id IN ('harris_bros', 'mackwash')`;

  for (const tenant of tenants) {
    console.log(`\n=== ${tenant.name} ===`);
    const leads = await sql`
      SELECT * FROM swell_leads
      WHERE tenant_id = ${tenant.id}
        AND status NOT IN ('test', 'archived')
        AND full_name NOT LIKE '<test%'
      ORDER BY created_at ASC
    `;
    console.log(`  ${leads.length} leads to post`);

    for (const lead of leads) {
      await postLeadToDiscord(tenant, lead);
      await new Promise(r => setTimeout(r, 1200)); // rate limit: ~50 req/min
    }
  }

  await sql.end();
  console.log("\n✅ Backfill complete");
}

main().catch(e => { console.error(e); process.exit(1); });
