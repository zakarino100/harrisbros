/**
 * Backfill existing conversation messages into a Discord thread.
 * For Lead #50 (Faisal Mohammad) — thread 1503197461764767784
 */

import postgres from "postgres";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const sql = postgres(process.env.DATABASE_URL!, {
  ssl: { rejectUnauthorized: false }, max: 2,
});

const DISCORD_API = "https://discord.com/api/v10";
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!;

async function postToThread(threadId: string, content: string) {
  const res = await fetch(`${DISCORD_API}/channels/${threadId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`  ❌ Discord error ${res.status}: ${text}`);
    return false;
  }
  return true;
}

async function main() {
  const LEAD_ID = 50;
  const THREAD_ID = "1503197461764767784";

  // Get the conversation
  const [conv] = await sql`SELECT * FROM swell_conversations WHERE lead_id = ${LEAD_ID}`;
  if (!conv) { console.log("No conversation found for lead #50"); process.exit(1); }

  console.log(`\n💬 Backfilling conversation #${conv.id} → Discord thread ${THREAD_ID}`);
  console.log(`   Status: ${conv.status} | Messages: ${conv.total_messages}\n`);

  // Get all messages in chronological order
  const messages = await sql`
    SELECT id, role, body, created_at, error
    FROM swell_conversation_messages
    WHERE conversation_id = ${conv.id}
    ORDER BY created_at ASC
  `;

  console.log(`📨 Found ${messages.length} messages to backfill\n`);

  // Post header separator
  await postToThread(THREAD_ID, "─── **Conversation history (backfilled)** ───");
  await new Promise(r => setTimeout(r, 500));

  for (const msg of messages) {
    const time = new Date(msg.created_at).toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", timeZone: "America/New_York"
    });

    let label: string;
    let content: string;

    if (msg.role === "assistant") {
      label = `🤖 **Hayden** (${time})`;
      content = msg.body;
    } else if (msg.role === "user") {
      label = `💬 **Faisal** (${time})`;
      content = msg.body;
    } else {
      // system message / error
      label = `⚙️ **System** (${time})`;
      content = msg.error ? `Error: ${msg.error}` : msg.body;
    }

    const discordMsg = `${label}: ${content.slice(0, 1800)}`;
    const ok = await postToThread(THREAD_ID, discordMsg);
    console.log(`  ${ok ? "✅" : "❌"} [${msg.role}] ${msg.body.slice(0, 50)}...`);
    await new Promise(r => setTimeout(r, 400)); // rate limit buffer
  }

  // Post outcome summary
  const outcomeMsg = conv.status === "handoff"
    ? "⚠️ **Outcome:** Conversation marked `handoff` — lead disqualified (out of service area)"
    : `📋 **Outcome:** ${conv.status}`;
  await postToThread(THREAD_ID, outcomeMsg);

  console.log("\n✅ Backfill complete");
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
