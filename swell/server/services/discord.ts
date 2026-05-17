/**
 * Hayden Discord Service — Swell multi-tenant
 *
 * Per-tenant channel IDs pulled from env vars:
 *   <TENANT_ID_UPPER>_DISCORD_GUILD_ID
 *   <TENANT_ID_UPPER>_DISCORD_LEADS_CHANNEL_ID
 *   <TENANT_ID_UPPER>_DISCORD_BOOKINGS_CHANNEL_ID
 *
 * Single shared bot token: DISCORD_BOT_TOKEN
 */

const DISCORD_API = "https://discord.com/api/v10";

function botToken(): string {
  return process.env.DISCORD_BOT_TOKEN ?? "";
}

function tenantEnv(tenantId: string, key: string): string {
  return process.env[`${tenantId.toUpperCase()}_${key}`] ?? "";
}

// ─── Core request helper ──────────────────────────────────────────────────────

async function discordRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; data?: any; error?: string }> {
  const token = botToken();
  if (!token) return { ok: false, error: "DISCORD_BOT_TOKEN not set" };

  const res = await fetch(`${DISCORD_API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `Discord ${res.status}: ${text}` };
  }

  const data = res.headers.get("content-type")?.includes("application/json")
    ? await res.json()
    : {};

  return { ok: true, data };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiscordLeadPayload {
  leadId:   number;
  name:     string | null;
  phone:    string | null;
  email:    string | null;
  address?: string | null;
  city?:    string | null;
  state?:   string | null;
  timeline?: string | null;
  homeSize?: string | null;
  score?:   string;
  source?:  string;
  crmUrl?:  string;
}

// ─── New lead notification ────────────────────────────────────────────────────

export async function notifyNewLeadDiscord(
  tenantId: string,
  tenantName: string,
  lead: DiscordLeadPayload,
): Promise<string | null> {
  const channelId = tenantEnv(tenantId, "DISCORD_LEADS_CHANNEL_ID");
  if (!channelId) {
    console.warn(`[discord] No leads channel for tenant ${tenantId}`);
    return null;
  }

  // ── Duplicate-thread guardrail ──────────────────────────────────────────────
  // Check if this lead already has a Discord thread in the DB. If it does,
  // return the existing thread ID without creating a duplicate.
  if (lead.leadId) {
    try {
      const { sql } = await import("../db/index.js");
      const rows = await sql<Array<{ discord_thread_id: string | null }>>`
        SELECT discord_thread_id FROM swell_leads
        WHERE id = ${lead.leadId} AND tenant_id = ${tenantId}
        LIMIT 1
      `;
      if (rows[0]?.discord_thread_id) {
        console.log(`[discord] Lead ${lead.leadId} already has thread ${rows[0].discord_thread_id} — skipping duplicate`);
        return rows[0].discord_thread_id;
      }
    } catch { /* non-blocking, fall through to create */ }
  }

  const crmLink = lead.crmUrl ?? `https://${tenantId.replace(/_/g, "")}.nopressurelaunch.com/leads/${lead.leadId}`;
  const dateStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const notes = (lead as any).notes ?? "";

  const embed = {
    title: `🔔 New Lead — ${lead.name ?? "Unknown"}`,
    color: 0xfbbf24,
    fields: [
      { name: "📞 Phone", value: lead.phone ?? "—", inline: true },
      { name: "📧 Email", value: lead.email ?? "—", inline: true },
      ...(lead.homeSize ? [{ name: "📐 Home Size", value: lead.homeSize.replace(/_/g, " "), inline: true }] : []),
      ...(lead.timeline ? [{ name: "⏰ Timeline", value: lead.timeline.replace(/_/g, " ").replace(/\//g, "/"), inline: true }] : []),
      ...(notes ? [{ name: "📝 Notes", value: notes, inline: false }] : []),
    ],
    footer: { text: `Lead ID: ${lead.leadId} · ${tenantName}` },
    timestamp: new Date().toISOString(),
  };

  const components = [{ type: 1, components: [{ type: 2, style: 5, label: "Open in CRM", url: crmLink }] }];
  const pingLine = `@here 🔔 **New Lead — ${lead.name ?? "Unknown"}** | 📞 ${lead.phone ?? "—"} | ${tenantName}`;

  // Always post a visible channel message first
  const msg = await discordRequest("POST", `/channels/${channelId}/messages`, {
    content: pingLine,
    embeds: [embed],
    components,
  });

  if (!msg.ok) {
    console.error(`[discord] Failed to post lead card: ${msg.error}`);
    return null;
  }

  const msgId = msg.data?.id as string | undefined;
  if (!msgId) return null;

  // Create thread from that message
  const threadName = `${lead.name ?? "Lead"} — ${dateStr}`;
  const thread = await discordRequest("POST", `/channels/${channelId}/messages/${msgId}/threads`, {
    name: threadName,
    auto_archive_duration: 10080,
  });

  const threadId = thread.ok ? (thread.data?.id as string | undefined) : msgId;
  console.log(`[discord] Lead card + thread: ${threadId} — ${lead.name}`);
  return threadId ?? null;
}

// ─── Mirror SMS to Discord thread ─────────────────────────────────────────────

export async function mirrorSmsToThread(
  threadId: string,
  role: "assistant" | "user",
  body: string,
  senderName?: string | null,
  sendError?: string | null,
  sentViaSms: boolean = true,
): Promise<void> {
  if (!threadId || !body) return;
  let label: string;
  if (role === "assistant") {
    if (!sentViaSms) {
      label = `🔒 **[Internal — not sent to customer]**`;
    } else {
      const badge = sendError ? "❌ **FAILED** *(never reached customer)*" : "✅ **SENT**";
      label = `🤖 **Hayden** — ${badge}`;
    }
  } else {
    label = `💬 **${senderName ?? "Customer"}**`;
  }
  const errorDetail = sendError ? `\n> ⚠️ Twilio error: \`${sendError.slice(0, 120)}\`` : "";
  const content = `${label}\n${body.slice(0, 1800)}${errorDetail}`;
  const result = await discordRequest("POST", `/channels/${threadId}/messages`, { content });
  if (!result.ok) console.error(`[discord] mirrorSmsToThread failed: ${result.error}`);
}

// ─── Booking notification ─────────────────────────────────────────────────────

export async function notifyBookingDiscord(
  tenantId: string,
  tenantName: string,
  lead: DiscordLeadPayload,
  price: number,
  services: string,
): Promise<void> {
  const channelId = tenantEnv(tenantId, "DISCORD_BOOKINGS_CHANNEL_ID");
  if (!channelId) {
    console.warn(`[discord] No bookings channel for tenant ${tenantId}`);
    return;
  }

  const crmLink = lead.crmUrl ?? `https://${tenantId.replace("_", "")}.nopressurelaunch.com/leads/${lead.leadId}`;
  const fullAddress = [lead.address, lead.city, lead.state].filter(Boolean).join(", ") || "Not provided";

  const content = [
    `@here 💰 **BOOKING — ${lead.name ?? "Unknown"}**`,
    `💵 **$${price.toFixed(2)}**   📞 ${lead.phone ?? "—"}`,
    `🏠 ${fullAddress}`,
    `🔧 ${services || "Not specified"}`,
  ].join("\n");

  const embed = {
    title: `💰 Booking — ${lead.name ?? "Unknown"}`,
    color: 0xf59e0b,
    fields: [
      { name: "💵 Amount", value: `$${price.toFixed(2)}`, inline: true },
      { name: "📞 Phone", value: lead.phone ?? "—", inline: true },
      { name: "📧 Email", value: lead.email ?? "—", inline: true },
      { name: "🏠 Address", value: fullAddress, inline: false },
      { name: "🔧 Services", value: services || "Not specified", inline: false },
    ],
    footer: { text: `Lead ID: ${lead.leadId} · ${tenantName}` },
    timestamp: new Date().toISOString(),
  };

  const components = [{ type: 1, components: [{ type: 2, style: 5, label: "Open in CRM", url: crmLink }] }];
  const threadName = `${lead.name ?? "Booking"} — $${price.toFixed(0)} — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  const forum = await discordRequest("POST", `/channels/${channelId}/threads`, {
    name: threadName,
    message: { content, embeds: [embed], components },
  });

  if (forum.ok) {
    console.log(`[discord] Booking thread created: ${forum.data?.id}`);
    return;
  }

  const msg = await discordRequest("POST", `/channels/${channelId}/messages`, {
    content, embeds: [embed], components,
  });
  console.log(msg.ok ? `[discord] Booking posted` : `[discord] Booking failed: ${msg.error}`);
}

// ─── Handoff notification ────────────────────────────────────────────────────
//
// Behavior:
//   1. ALWAYS post an @here alert in the leads channel (simple message, no new
//      thread) so the rep sees the ping regardless of handoff type.
//   2. For "ready to book" / win handoffs ALSO create a forum thread in the
//      bookings channel with the full transcript + CRM link.
//
// This replaces the old dual-path logic that was creating duplicate booking
// threads and silently failing the leads-channel forum POST.

export async function notifyHandoffDiscord(
  tenantId: string,
  tenantName: string,
  lead: DiscordLeadPayload,
  handoffReason: string,
  transcript: Array<{ role: string; body: string; created_at?: string }>,
): Promise<void> {
  const isBooking = /ready.to.book|win|booked|confirmed/i.test(handoffReason);
  const crmLink = lead.crmUrl ?? `https://${tenantId.replace(/_/g, "")}.nopressurelaunch.com/leads/${lead.leadId}`;
  const components = [{ type: 1, components: [{ type: 2, style: 5, label: "Open in CRM", url: crmLink }] }];

  // ── 1. Leads channel: simple @here ping ─────────────────────────────────────
  const leadsChannelId = tenantEnv(tenantId, "DISCORD_LEADS_CHANNEL_ID");
  if (leadsChannelId) {
    const emoji = isBooking ? "💰" : "🚨";
    const label = isBooking ? "READY TO BOOK" : "HANDOFF NEEDED";
    const pingContent = [
      `${emoji} **${label} — ${lead.name ?? "Unknown"}**`,
      `📞 ${lead.phone ?? "—"} | Lead ID: ${lead.leadId}`,
      `**Reason:** ${handoffReason}`,
    ].join("\n");

    const ping = await discordRequest("POST", `/channels/${leadsChannelId}/messages`, {
      content: pingContent,
      components,
    });
    if (!ping.ok) {
      console.error(`[discord] Leads channel handoff ping failed: ${ping.error}`);
    } else {
      console.log(`[discord] Handoff ping posted to leads channel for ${lead.name}`);
    }
  } else {
    console.warn(`[discord] No DISCORD_LEADS_CHANNEL_ID for tenant ${tenantId}`);
  }

  // ── 2. Bookings channel: forum thread with transcript (ready-to-book only) ──
  if (!isBooking) return;

  const bookingsChannelId = tenantEnv(tenantId, "DISCORD_BOOKINGS_CHANNEL_ID");
  if (!bookingsChannelId) {
    console.warn(`[discord] No DISCORD_BOOKINGS_CHANNEL_ID for tenant ${tenantId}`);
    return;
  }

  const recent = transcript.slice(-12);
  const transcriptText = recent
    .map(m => `**${m.role === "assistant" ? "Hayden" : "Lead"}:** ${m.body}`)
    .join("\n")
    .slice(0, 1800);

  const bookingContent = [
    `💰 **READY TO BOOK — ${lead.name ?? "Unknown"}**`,
    `📞 ${lead.phone ?? "—"}`,
    `**Reason:** ${handoffReason}`,
  ].join("\n");

  const bookingEmbed = {
    title: `💰 READY TO BOOK — ${lead.name ?? "Unknown"}`,
    color: 0xf59e0b,
    description: transcriptText || "(no transcript)",
    fields: [
      { name: "📞 Phone", value: lead.phone ?? "—", inline: true },
      { name: "📧 Email", value: lead.email ?? "—", inline: true },
      { name: "🔖 Reason", value: handoffReason, inline: false },
    ],
    footer: { text: `Lead ID: ${lead.leadId} · ${tenantName}` },
    timestamp: new Date().toISOString(),
  };

  const threadName = `📅 ${lead.name ?? "Lead"} — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  // Try forum-channel POST first, fall back to text channel + thread
  const forum = await discordRequest("POST", `/channels/${bookingsChannelId}/threads`, {
    name: threadName,
    message: { content: bookingContent, embeds: [bookingEmbed], components },
  });
  if (forum.ok) {
    console.log(`[discord] Booking thread created (forum): ${forum.data?.id}`);
    return;
  }

  // Fallback: text channel
  const msg = await discordRequest("POST", `/channels/${bookingsChannelId}/messages`, {
    content: bookingContent, embeds: [bookingEmbed], components,
  });
  if (!msg.ok) {
    console.error(`[discord] Booking channel post failed: ${msg.error}`);
    return;
  }
  const msgId = msg.data?.id as string | undefined;
  if (msgId) {
    await discordRequest("POST", `/channels/${bookingsChannelId}/messages/${msgId}/threads`, {
      name: threadName,
      auto_archive_duration: 10080,
    });
  }
  console.log(`[discord] Booking thread created (text+thread fallback)`);
}

// ─── Post message to existing thread ─────────────────────────────────────────

export async function postToThread(threadId: string, content: string): Promise<boolean> {
  const result = await discordRequest("POST", `/channels/${threadId}/messages`, {
    content: content.slice(0, 2000),
  });
  return result.ok;
}


// ─── DM Zak — for situations Hayden needs help with ─────────────────────────

export async function dmZak(message: string): Promise<void> {
  const zakId = process.env.DISCORD_ZAK_USER_ID ?? "";
  if (!zakId) { console.warn("[discord] DISCORD_ZAK_USER_ID not set"); return; }

  // Open a DM channel with Zak
  const token = botToken();
  if (!token) return;
  const dmRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient_id: zakId }),
  });
  if (!dmRes.ok) { console.error("[discord] Failed to open DM with Zak"); return; }
  const dmChannel = await dmRes.json() as any;

  await fetch(`${DISCORD_API}/channels/${dmChannel.id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ content: `🧠 **Hayden needs your input:**\n${message.slice(0, 1900)}` }),
  });
  console.log("[discord] DM sent to Zak");
}

// ── Notify owner: lead replied while AI is paused ──────────────────────────────

export async function notifyLeadRepliedWhilePaused(opts: {
  tenantId: string;
  threadId: string | null;
  leadName: string;
  message: string;
  ownerDiscordId: string;
}): Promise<void> {
  const { tenantId, threadId, leadName, message, ownerDiscordId } = opts;

  const preview = message.length > 200 ? message.slice(0, 200) + "..." : message;
  const content =
    `⚠️ **${leadName}** replied while Hayden is paused:\n` +
    `> ${preview}\n\n` +
    `<@${ownerDiscordId}> — AI is off for this lead. Two options:\n` +
    `• **Reply here** to respond manually (message goes straight to them via SMS)\n` +
    `• Type **\`!resume\`** to re-enable Hayden and let her take it from here`;

  // Post to existing handoff thread if there is one
  if (threadId) {
    await postToThread(threadId, content);
    return;
  }

  // No thread — fall back to leads channel
  const leadsChannelId = tenantEnv(tenantId, "DISCORD_LEADS_CHANNEL_ID");
  if (!leadsChannelId) {
    console.warn(`[discord] notifyLeadRepliedWhilePaused: no leads channel for ${tenantId}`);
    return;
  }
  await discordRequest("POST", `/channels/${leadsChannelId}/messages`, { content });
  console.log(`[discord] Paused-lead reply notification sent for ${tenantId} / ${leadName}`);
}
