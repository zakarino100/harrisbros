/**
 * check-new-leads.mjs
 * Checks for new MackWash leads since last run and DMs Zak on Discord.
 * Stores last-seen lead ID in /tmp/mw-last-lead.json
 */
import postgres from "postgres";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { createRequire } from "module";

// Load creds from workspace
const creds = {};
readFileSync("/Users/zak/.openclaw/workspace/.swell-creds", "utf8")
  .split("\n").filter(Boolean)
  .forEach(line => {
    const [k, ...v] = line.split("=");
    creds[k.trim()] = v.join("=").trim();
  });

const { DATABASE_URL, DISCORD_BOT_TOKEN, ZAK_DISCORD_ID } = creds;
const DISCORD_API = "https://discord.com/api/v10";
const STATE_FILE = "/tmp/mw-last-lead.json";

const sql = postgres(DATABASE_URL, { ssl: "require", prepare: false, max: 1 });

// Load last seen ID
let lastId = 0;
if (existsSync(STATE_FILE)) {
  try { lastId = JSON.parse(readFileSync(STATE_FILE, "utf8")).lastId ?? 0; } catch {}
}

// Check for new leads
const newLeads = await sql`
  SELECT id, full_name, phone, status, created_at
  FROM swell_leads
  WHERE tenant_id = 'mackwash'
    AND id > ${lastId}
  ORDER BY id ASC
`;

await sql.end();

if (newLeads.length === 0) {
  console.log(`[lead-check] No new leads (last seen ID: ${lastId})`);
  process.exit(0);
}

// Update state
const maxId = Math.max(...newLeads.map(l => parseInt(l.id)));
writeFileSync(STATE_FILE, JSON.stringify({ lastId: maxId, updatedAt: new Date().toISOString() }));

console.log(`[lead-check] ${newLeads.length} new lead(s) — notifying Zak`);

// Build message
const lines = newLeads.map(l => {
  const name = l.full_name || "Unknown";
  const phone = l.phone || "no phone";
  const time = new Date(l.created_at).toLocaleString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit"
  });
  return `• **${name}** — ${phone} — ${time}`;
}).join("\n");

const msg = newLeads.length === 1
  ? `🔔 **New MackWash Lead!**\n\n${lines}\n\nHayden is on it.`
  : `🔔 **${newLeads.length} New MackWash Leads!**\n\n${lines}\n\nHayden is on it.`;

// Open DM channel with Zak
const dmRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
  method: "POST",
  headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ recipient_id: ZAK_DISCORD_ID }),
});
const dmChannel = await dmRes.json();

if (!dmChannel.id) {
  console.error("[lead-check] Failed to open DM channel:", JSON.stringify(dmChannel));
  process.exit(1);
}

// Send message
const sendRes = await fetch(`${DISCORD_API}/channels/${dmChannel.id}/messages`, {
  method: "POST",
  headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ content: msg }),
});

if (sendRes.ok) {
  console.log(`[lead-check] DM sent to Zak ✅`);
} else {
  console.error("[lead-check] DM failed:", await sendRes.text());
}

process.exit(0);
