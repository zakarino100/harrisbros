/**
 * Swell Discord Gateway — standalone service
 * Runs on Railway (fresh IP) to avoid Replit IP blocks.
 *
 * Handles:
 *  1. Relay Discord thread messages → SMS to lead (handoff bridge)
 *  2. !resume command → reactivate AI for a lead
 *  3. Owner DMs → AI Q&A via Claude Haiku
 *  4. Owner channel messages → same AI Q&A
 */

import WebSocket from "ws";
import postgres from "postgres";
import Anthropic from "@anthropic-ai/sdk";
import http from "http";

// Railway health check — keeps the container alive
http.createServer((req, res) => res.end("OK")).listen(process.env.PORT || 3000);

// ─── Config ──────────────────────────────────────────────────────────────────

const DISCORD_TOKEN   = process.env.DISCORD_BOT_TOKEN ?? "";
const GATEWAY_URL     = "wss://gateway.discord.gg/?v=10&encoding=json";
const DISCORD_API     = "https://discord.com/api/v10";
const BOT_ID          = "1499988099428782172";
const INTENTS         = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15); // 37377
const TWILIO_SID      = process.env.TWILIO_ACCOUNT_SID ?? "";
const TWILIO_TOKEN    = process.env.TWILIO_AUTH_TOKEN ?? "";
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY ?? "";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 3 });
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ─── Conversation history (fetched live from Discord) ────────────────────────
// Pull recent channel messages so Hayden always has full context, even after restarts

async function getChannelHistory(channelId, limit = 20) {
  try {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages?limit=${limit}`, {
      headers: { Authorization: `Bot ${DISCORD_TOKEN}` }
    });
    if (!res.ok) return [];
    const msgs = await res.json();
    // Discord returns newest first — reverse to oldest first
    // Filter to only human and Hayden bot messages, skip system messages
    return msgs.reverse()
      .filter(m => m.content?.trim())
      .map(m => ({
        role: m.author.id === BOT_ID ? "assistant" : "user",
        content: m.content.trim()
      }));
  } catch (e) {
    console.error("[history] fetch error:", e?.message);
    return [];
  }
}

// ─── Reconnect state ─────────────────────────────────────────────────────────

let ws = null;
let heartbeatInterval = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let consecutiveAuthFailures = 0;
let lastSeq = null;
const MAX_RECONNECT = 3;
const MAX_AUTH_FAILURES = 2;

// ─── Start ───────────────────────────────────────────────────────────────────

if (!DISCORD_TOKEN) {
  console.error("[gw] DISCORD_BOT_TOKEN not set — exiting");
  process.exit(1);
}

console.log(`[gw] Starting — token prefix: ${DISCORD_TOKEN.slice(0, 20)}... (len=${DISCORD_TOKEN.length})`);
connect();

// ─── Gateway ─────────────────────────────────────────────────────────────────

function connect() {
  if (reconnectAttempts >= MAX_RECONNECT) {
    console.error("[gw] Max reconnect attempts reached. Stopping.");
    return;
  }
  console.log(`[gw] Connecting (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT})...`);
  ws = new WebSocket(GATEWAY_URL);

  ws.on("open", () => {
    reconnectAttempts = 0;
    consecutiveAuthFailures = 0;
    console.log("[gw] WS open");
  });

  ws.on("close", (code, reason) => {
    const r = reason?.length ? reason.toString() : "";
    console.warn(`[gw] WS closed (${code}) ${r}`);
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    if (reconnectTimer)    { clearTimeout(reconnectTimer);     reconnectTimer = null; }
    ws = null;

    if (code === 4004) {
      consecutiveAuthFailures++;
      if (consecutiveAuthFailures >= MAX_AUTH_FAILURES) {
        console.error("[gw] Repeated 4004 — stopping. Check DISCORD_BOT_TOKEN and redeploy.");
        return;
      }
    } else {
      consecutiveAuthFailures = 0;
    }

    if (reconnectAttempts < MAX_RECONNECT) {
      reconnectAttempts++;
      const delay = Math.min(30000 * Math.pow(2, reconnectAttempts), 120000) + Math.random() * 5000;
      console.log(`[gw] Reconnecting in ${Math.round(delay / 1000)}s...`);
      reconnectTimer = setTimeout(connect, delay);
    }
  });

  ws.on("error", e => console.error("[gw] WS error:", e.message));

  ws.on("message", data => {
    try { handlePayload(JSON.parse(data.toString())); }
    catch (e) { console.error("[gw] Parse error:", e); }
  });
}

function handlePayload({ op, d, s, t }) {
  if (s) lastSeq = s;
  switch (op) {
    case 10: { // Hello
      heartbeatInterval = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 1, d: lastSeq }));
      }, d.heartbeat_interval);
      console.log(`[gw] Identifying (intents=${INTENTS})...`);
      ws.send(JSON.stringify({
        op: 2,
        d: { token: DISCORD_TOKEN, intents: INTENTS, properties: { os: "linux", browser: "swell-gw", device: "swell-gw" } }
      }));
      break;
    }
    case 0:
      if (t === "READY") console.log(`[gw] ✅ Authenticated as ${d.user.username}`);
      if (t === "MESSAGE_CREATE") handleMessage(d).catch(e => console.error("[gw] handleMessage:", e?.message));
      break;
    case 7: ws?.close(); break;
    case 9: console.warn("[gw] Invalid session"); ws?.close(); break;
  }
}

// ─── Message handler ─────────────────────────────────────────────────────────

async function handleMessage(msg) {
  if (msg.author?.bot) return;
  const channelId = msg.channel_id;
  const content = (msg.content ?? "").trim();
  if (!content) return;

  // ── Owner DM (no guild_id) ─────────────────────────────────────────────────
  if (!msg.guild_id) {
    const tenant = await findTenantByOwnerUserId(msg.author.id);
    if (tenant) {
      console.log(`[owner-chat] DM from ${msg.author.id} → tenant ${tenant.id}`);
      const reply = await ownerChatReply(tenant, content, channelId);
      await discordPost(channelId, reply);
    }
    return;
  }

  // ── Owner channel ─────────────────────────────────────────────────────────
  const ownerTenant = await findTenantByOwnerChannel(channelId);
  if (ownerTenant) {
    // Channel is the permission gate — anyone who can post there gets answers
    const reply = await ownerChatReply(ownerTenant, content, channelId);
    await discordPost(channelId, reply);
    return;
  }

  // ── Handoff / stopped thread ───────────────────────────────────────────────
  const rows = await sql`
    SELECT c.id, c.status, c.lead_id, l.phone, l.full_name, t.twilio_from
    FROM swell_conversations c
    JOIN swell_leads l ON l.id = c.lead_id
    JOIN swell_tenants t ON t.id = c.tenant_id
    WHERE c.discord_thread_id = ${channelId}
      AND c.status IN ('handoff', 'stopped')
    LIMIT 1
  `;
  if (!rows.length) return;
  const conv = rows[0];

  if (content.toLowerCase() === "!resume") {
    await sql`UPDATE swell_conversations SET status = 'active', handoff_reason = NULL WHERE id = ${conv.id}`;
    await sql`UPDATE swell_nurture_jobs SET status = 'cancelled' WHERE lead_id = ${conv.lead_id} AND status = 'scheduled'`;
    await discordPost(channelId, `✅ Hayden is back on. She'll respond to **${conv.full_name || conv.phone}**'s next message.`);
    console.log(`[gw] !resume — reactivated conversation ${conv.id}`);
    return;
  }

  if (conv.status !== "handoff") return;
  if (!conv.phone) return;

  await sendSms(conv.phone, content, conv.twilio_from);
  console.log(`[gw] Relayed → SMS to ${conv.phone}: "${content.slice(0, 60)}"`);

  await fetch(`${DISCORD_API}/channels/${channelId}/messages/${msg.id}/reactions/${encodeURIComponent("✅")}/@me`, {
    method: "PUT", headers: { Authorization: `Bot ${DISCORD_TOKEN}` }
  });
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

async function findTenantByOwnerUserId(discordUserId) {
  const rows = await sql`
    SELECT id, name, owner_name, owner_discord_channel_id
    FROM swell_tenants WHERE owner_discord_user_id = ${discordUserId} AND enabled = true LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findTenantByOwnerChannel(channelId) {
  const rows = await sql`
    SELECT id, name, owner_name, owner_discord_user_id
    FROM swell_tenants WHERE owner_discord_channel_id = ${channelId} AND enabled = true LIMIT 1
  `;
  return rows[0] ?? null;
}

// ─── Owner chat ───────────────────────────────────────────────────────────────

async function ownerChatReply(tenant, question, channelId) {
  try {
    const stats = await fetchStats(tenant.id);
    const system = buildOwnerSystemPrompt(tenant.name, tenant.owner_name ?? "Boss", stats);
    const history = await getChannelHistory(channelId, 20);
    const messages = [...history, { role: "user", content: question }];
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5", max_tokens: 400,
      system, messages
    });
    const reply = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "Sorry, couldn't generate a response.";
    return reply;
  } catch (e) {
    console.error("[owner-chat] Error:", e?.message);
    return "Sorry, I ran into an error pulling your stats. Try again in a moment.";
  }
}

async function fetchStats(tenantId) {
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);
  const [lt, lw, la, ac, hc, bc, rl, rs, hl] = await Promise.all([
    sql`SELECT COUNT(*)::int c FROM swell_leads WHERE tenant_id=${tenantId} AND created_at>=${todayStart.toISOString()}`,
    sql`SELECT COUNT(*)::int c FROM swell_leads WHERE tenant_id=${tenantId} AND created_at>=${weekStart.toISOString()}`,
    sql`SELECT COUNT(*)::int c FROM swell_leads WHERE tenant_id=${tenantId}`,
    sql`SELECT COUNT(*)::int c FROM swell_conversations WHERE tenant_id=${tenantId} AND status='active'`,
    sql`SELECT COUNT(*)::int c FROM swell_conversations WHERE tenant_id=${tenantId} AND status='handoff'`,
    sql`SELECT COUNT(*)::int c FROM swell_leads WHERE tenant_id=${tenantId} AND status IN ('booked','closed','won')`,
    sql`SELECT full_name,phone,status,created_at FROM swell_leads WHERE tenant_id=${tenantId} ORDER BY created_at DESC LIMIT 7`,
    sql`SELECT COUNT(*)::int total, SUM(CASE WHEN total_messages>1 THEN 1 ELSE 0 END)::int replied FROM swell_conversations WHERE tenant_id=${tenantId}`,
    sql`SELECT l.full_name, l.phone, c.handoff_reason, c.last_message_at
        FROM swell_conversations c JOIN swell_leads l ON l.id = c.lead_id
        WHERE c.tenant_id=${tenantId} AND c.status = 'handoff'
        ORDER BY c.last_message_at DESC LIMIT 10`,
  ]);
  const total = rs[0]?.total ?? 0, replied = rs[0]?.replied ?? 0;
  return {
    leadsToday: lt[0]?.c ?? 0, leadsWeek: lw[0]?.c ?? 0, leadsAll: la[0]?.c ?? 0,
    active: ac[0]?.c ?? 0, handoff: hc[0]?.c ?? 0, booked: bc[0]?.c ?? 0,
    replyRate: total > 0 ? `${Math.round(replied/total*100)}%` : "N/A",
    handoffLeads: hl.map(r => `${r.full_name||"?"} (${r.phone||""})${r.handoff_reason ? " — "+r.handoff_reason : ""}`),
    recent: rl.map(r => {
      const d = new Date(r.created_at);
      const label = d.toLocaleDateString("en-US",{timeZone:"America/New_York",month:"short",day:"numeric"});
      return `${r.full_name||"?"} (${r.phone||""}) — ${r.status} — came in ${label}`;
    }),
  };
}

function buildOwnerSystemPrompt(bizName, ownerName, s) {
  return `You are Hayden, the AI assistant for ${bizName}. You're talking directly with the owner, ${ownerName}.

Your job: answer questions about the pipeline using the live data below. Be direct and concise.

What you CAN do:
- Answer questions about leads, stats, pipeline status
- Look up specific lead info if asked
- Tell him what needs attention

What you CANNOT do:
- Contact leads on his behalf
- Send messages or initiate conversations
- Book anything
- "Patch him in" to anything

Do NOT suggest actions you can't take. Do NOT ask "you want me to reach out?" or "want me to connect you?" — he handles lead contact himself.

Pipeline snapshot (live data — use these exact numbers, do not guess or infer):
- Leads today: ${s.leadsToday}  |  This week: ${s.leadsWeek}  |  All-time: ${s.leadsAll}
- Active AI convos: ${s.active}  |  Waiting on you (handoff): ${s.handoff}  |  Booked: ${s.booked}
- Reply rate: ${s.replyRate}

Leads waiting on you (handoff — needs your follow-up):
${s.handoffLeads.length > 0 ? s.handoffLeads.map(r => `  • ${r}`).join("\n") : "  (none)"}

Recent leads (newest first):
${s.recent.map(r => `  • ${r}`).join("\n") || "  (none)"}

Keep responses short — this is Discord, not a report.`;
}

// ─── Twilio SMS ───────────────────────────────────────────────────────────────

async function sendSms(to, body, from) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });
  if (!res.ok) console.error("[sms] Failed:", await res.text());
}

// ─── Discord REST ─────────────────────────────────────────────────────────────

async function discordPost(channelId, content) {
  try {
    await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${DISCORD_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: content.slice(0, 2000) }),
    });
  } catch (e) {
    console.error("[discord] post error:", e?.message);
  }
}

// ─── Keepalive ────────────────────────────────────────────────────────────────

process.on("SIGTERM", () => { ws?.close(); sql.end(); process.exit(0); });
process.on("SIGINT",  () => { ws?.close(); sql.end(); process.exit(0); });
