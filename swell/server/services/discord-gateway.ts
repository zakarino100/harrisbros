/**
 * Discord Gateway WebSocket — listens for messages in lead threads.
 * When a human replies in a handoff thread, sends the message as SMS to the lead.
 *
 * Only handles threads that exist in swell_conversations.discord_thread_id
 * AND where conversation.status = 'handoff' (human has taken over).
 *
 * Uses the `ws` npm package (not Node built-in undici WebSocket which is
 * experimental and fails with Discord's gateway).
 */
import WebSocket from "ws";
import { sql } from "../db/index.js";
import { sendSms } from "./twilio.js";
import {
  handleOwnerQuestion,
  findTenantByOwnerDiscordUserId,
  findTenantByOwnerChannel,
} from "./owner-chat.js";
import { postToThread } from "./discord.js";

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const DISCORD_API = "https://discord.com/api/v10";
const BOT_ID = "1499988099428782172"; // Hayden bot ID — skip own messages

function botToken(): string {
  return process.env.DISCORD_BOT_TOKEN ?? "";
}

let ws: WebSocket | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3; // Stop quickly to avoid IP blocks — gateway will restart on next server restart
let consecutiveAuthFailures = 0;
const MAX_AUTH_FAILURES = 2; // 4004 twice in a row = give up, don't hammer Discord's IP block
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function startDiscordGateway(): void {
  const t = botToken();
  if (!t) {
    console.warn("[discord-gw] No DISCORD_BOT_TOKEN — gateway not started");
    return;
  }
  console.log(`[discord-gw] Token prefix: ${t.slice(0, 20)}... (len=${t.length})`);
  connect();
}

function getBackoffDelay(): number {
  // Exponential backoff: 30s, 60s, 120s (much slower to avoid IP-based Discord rate limits)
  const baseDelay = 30000;
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, reconnectAttempts), 120000);
  const jitter = Math.random() * 5000;
  return exponentialDelay + jitter;
}

function connect(): void {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error(`[discord-gw] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`);
    return;
  }

  console.log(`[discord-gw] Connecting to Discord gateway (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
  ws = new WebSocket(GATEWAY_URL);

  ws.on("open", () => {
    console.log("[discord-gw] WebSocket open — authenticated and listening");
    reconnectAttempts = 0; // Reset on successful connection
  });

  ws.on("close", (code: number, reason: Buffer) => {
    const reasonStr = reason?.length ? reason.toString() : "(no reason)";
    console.warn(`[discord-gw] WebSocket closed (code ${code}) ${reasonStr}`);

    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    ws = null;

    // 4004 = auth failed — count consecutive failures
    if (code === 4004) {
      consecutiveAuthFailures++;
      if (consecutiveAuthFailures >= MAX_AUTH_FAILURES) {
        console.error(`[discord-gw] ${consecutiveAuthFailures} consecutive 4004s — stopping to avoid Discord IP block. Check token in Replit Secrets and redeploy.`);
        return; // Give up entirely — don't hammer Discord
      }
    } else {
      consecutiveAuthFailures = 0; // Reset on non-4004 close
    }

    // Only reconnect if not at max attempts
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      const delay = getBackoffDelay();
      console.log(`[discord-gw] Will reconnect in ${Math.round(delay / 1000)}s...`);
      reconnectTimer = setTimeout(connect, delay);
    } else {
      console.error(`[discord-gw] Max reconnect attempts reached. Will not retry.`);
    }
  });

  ws.on("error", (e: Error) => {
    console.error("[discord-gw] WebSocket error:", e.message);
  });

  ws.on("message", (data: WebSocket.Data) => {
    try { 
      handleGatewayMessage(JSON.parse(data.toString())); 
    } catch (e) { 
      console.error("[discord-gw] Parse error:", e); 
    }
  });
}

let lastSeq: number | null = null;

function handleGatewayMessage(payload: any): void {
  const { op, d, s, t } = payload;
  if (process.env.DEBUG_DISCORD_GW === "true" && op !== 1) console.log(`[discord-gw] Opcode ${op}:`, t || "dispatch");
  if (s) lastSeq = s;

  switch (op) {
    case 10: { // Hello — start heartbeating then identify
      const interval = d.heartbeat_interval;
      heartbeatInterval = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 1, d: lastSeq }));
      }, interval);
      // Privileged intents: GUILDS(0) + GUILD_MESSAGES(9) + DIRECT_MESSAGES(12) + MESSAGE_CONTENT(15)
      const intents = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15);
      const token = botToken().trim();
      console.log(`[discord-gw] Sending IDENTIFY (token_len=${token.length}, intents=${intents})`);
      ws?.send(JSON.stringify({
        op: 2,
        d: { token, intents, properties: { os: "linux", browser: "swell", device: "swell" } },
      }));
      break;
    }

    case 0: // Dispatch
      if (t === "MESSAGE_CREATE") handleMessageCreate(d);
      break;

    case 7: // Reconnect
      ws?.close();
      break;

    case 9: // Invalid session
      console.warn("[discord-gw] Invalid session — closing connection");
      ws?.close();
      break;
  }
}

async function handleMessageCreate(msg: any): Promise<void> {
  // Skip bot messages
  if (msg.author?.bot) return;

  const channelId: string = msg.channel_id;
  const content: string = (msg.content ?? "").trim();
  if (!content) return;

  // ── Owner Chat: DM to bot (no guild_id) ─────────────────────────────────
  const isDM = !msg.guild_id;
  if (isDM) {
    const tenant = await findTenantByOwnerDiscordUserId(msg.author.id).catch(() => null);
    if (tenant) {
      console.log(`[owner-chat] DM from owner ${msg.author.id} → tenant ${tenant.id}`);
      const reply = await handleOwnerQuestion(
        tenant.id,
        tenant.name,
        tenant.owner_name ?? "Boss",
        content
      );
      await sendDiscordMessage(channelId, reply);
      return;
    }
    // DM from unknown user — ignore
    return;
  }

  // ── Owner Chat: message in configured owner-chat channel ─────────────────
  const ownerChannelTenant = await findTenantByOwnerChannel(channelId).catch(() => null);
  if (ownerChannelTenant) {
    // Only respond to the configured owner (or anyone if no user ID set)
    const isOwner =
      !ownerChannelTenant.owner_discord_user_id ||
      msg.author.id === ownerChannelTenant.owner_discord_user_id;
    if (isOwner) {
      console.log(`[owner-chat] Channel msg from owner ${msg.author.id} → tenant ${ownerChannelTenant.id}`);
      const reply = await handleOwnerQuestion(
        ownerChannelTenant.id,
        ownerChannelTenant.name,
        ownerChannelTenant.owner_name ?? "Boss",
        content
      );
      await sendDiscordMessage(channelId, reply);
      return;
    }
  }

  // ── Handoff/stopped thread: !resume command or relay message as SMS ───────
  try {
    // Look up conversation by discord_thread_id (handoff OR stopped — both respond to !resume)
    const rows = await sql`
      SELECT c.*, l.phone, l.full_name, l.tenant_id, t.twilio_from
      FROM swell_conversations c
      JOIN swell_leads l ON l.id = c.lead_id
      JOIN swell_tenants t ON t.id = c.tenant_id
      WHERE c.discord_thread_id = ${channelId}
        AND c.status IN ('handoff', 'stopped')
      LIMIT 1
    `;

    if (!rows.length) return; // Not a Swell thread

    const conv = rows[0];

    // ── !resume: re-enable AI ───────────────────────────────────────────────
    if (content.trim().toLowerCase() === "!resume") {
      await sql`
        UPDATE swell_conversations
        SET status = 'active', handoff_reason = NULL
        WHERE id = ${conv.id}
      `;
      await sql`
        UPDATE swell_nurture_jobs
        SET status = 'cancelled'
        WHERE lead_id = ${conv.lead_id} AND status = 'scheduled'
      `;
      await postToThread(channelId,
        `✅ Hayden is back on. She'll respond to **${conv.full_name || conv.phone}**'s next message.`
      );
      console.log(`[discord-gw] !resume — reactivated conversation ${conv.id}`);
      return;
    }

    // ── Normal rep reply: relay to lead via SMS (handoff only) ─────────────
    if (conv.status !== "handoff") return; // stopped + no !resume — don't relay
    if (!conv.phone) return;

    await sendSms(conv.phone, content, conv.twilio_from);
    console.log(`[discord-gw] Relayed Discord reply → SMS to ${conv.phone}: "${content.slice(0, 60)}"`);

    // React ✅ to confirm
    await fetch(`${DISCORD_API}/channels/${channelId}/messages/${msg.id}/reactions/${encodeURIComponent("✅")}/@me`, {
      method: "PUT",
      headers: { Authorization: `Bot ${botToken()}` },
    });
  } catch (err: any) {
    console.error("[discord-gw] Relay error:", err?.message);
  }
}

async function sendDiscordMessage(channelId: string, content: string): Promise<void> {
  try {
    await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${botToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    });
  } catch (err: any) {
    console.error("[discord-gw] sendDiscordMessage error:", err?.message);
  }
}
