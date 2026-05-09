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

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const DISCORD_API = "https://discord.com/api/v10";
const BOT_ID = "1499988099428782172"; // Hayden bot ID — skip own messages

function botToken(): string {
  return process.env.DISCORD_BOT_TOKEN ?? "";
}

let ws: WebSocket | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function startDiscordGateway(): void {
  if (!botToken()) {
    console.warn("[discord-gw] No DISCORD_BOT_TOKEN — gateway not started");
    return;
  }
  connect();
}

function getBackoffDelay(): number {
  // Exponential backoff: 5s, 10s, 20s, 40s, 60s (cap at 60s)
  const baseDelay = 5000;
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, reconnectAttempts), 60000);
  const jitter = Math.random() * 1000; // Add 0-1s jitter
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

    // Only reconnect if not at max attempts
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      const delay = getBackoffDelay();
      console.log(`[discord-gw] Will reconnect in ${Math.round(delay / 1000)}s...`);
      reconnectTimer = setTimeout(connect, delay);
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
  // Must be in a thread (has parent_id)
  const threadId = msg.channel_id;
  if (!threadId) return;

  const content: string = msg.content ?? "";
  if (!content.trim()) return;

  try {
    // Look up conversation by discord_thread_id
    const rows = await sql`
      SELECT c.*, l.phone, l.full_name, l.tenant_id, t.twilio_from
      FROM swell_conversations c
      JOIN swell_leads l ON l.id = c.lead_id
      JOIN swell_tenants t ON t.id = c.tenant_id
      WHERE c.discord_thread_id = ${threadId}
        AND c.status = 'handoff'
      LIMIT 1
    `;

    if (!rows.length) return; // Not a Swell handoff thread

    const conv = rows[0];
    if (!conv.phone) return;

    // Send SMS to lead
    await sendSms(conv.phone, content, conv.twilio_from);
    console.log(`[discord-gw] Relayed Discord reply → SMS to ${conv.phone}: "${content.slice(0, 60)}"`);

    // React ✅ to confirm
    await fetch(`${DISCORD_API}/channels/${threadId}/messages/${msg.id}/reactions/${encodeURIComponent("✅")}/@me`, {
      method: "PUT",
      headers: { Authorization: `Bot ${botToken()}` },
    });
  } catch (err: any) {
    console.error("[discord-gw] Relay error:", err?.message);
  }
}
