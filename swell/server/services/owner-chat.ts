/**
 * Owner Chat — AI-powered Q&A for tenant owners via Discord.
 *
 * Mack (or any configured owner) can DM the Hayden bot or type in the
 * configured #owner-chat channel and get instant answers about their pipeline.
 *
 * Model: claude-haiku-4-5 (cheap, fast, sufficient for stats Q&A)
 */

import { anthropicChat } from "./anthropic.js";
import { sql } from "../db/index.js";

// ─── Stats snapshot ──────────────────────────────────────────────────────────

export interface OwnerStats {
  leadsToday: number;
  leadsThisWeek: number;
  leadsTotal: number;
  activeConvos: number;
  handoffConvos: number;
  bookedLeads: number;
  recentLeads: Array<{
    name: string;
    phone: string;
    status: string;
    createdAt: string;
  }>;
  replyRate: string;
}

export async function fetchOwnerStats(tenantId: string): Promise<OwnerStats> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);

  const [
    leadsToday,
    leadsThisWeek,
    leadsTotal,
    activeConvos,
    handoffConvos,
    bookedLeads,
    recentLeads,
    replyStats,
  ] = await Promise.all([
    sql`SELECT COUNT(*)::int as count FROM swell_leads WHERE tenant_id = ${tenantId} AND created_at >= ${todayStart.toISOString()}`,
    sql`SELECT COUNT(*)::int as count FROM swell_leads WHERE tenant_id = ${tenantId} AND created_at >= ${weekStart.toISOString()}`,
    sql`SELECT COUNT(*)::int as count FROM swell_leads WHERE tenant_id = ${tenantId}`,
    sql`SELECT COUNT(*)::int as count FROM swell_conversations WHERE tenant_id = ${tenantId} AND status = 'active'`,
    sql`SELECT COUNT(*)::int as count FROM swell_conversations WHERE tenant_id = ${tenantId} AND status = 'handoff'`,
    sql`SELECT COUNT(*)::int as count FROM swell_leads WHERE tenant_id = ${tenantId} AND status IN ('booked', 'closed', 'won')`,
    sql`SELECT full_name, phone, status, created_at FROM swell_leads WHERE tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 7`,
    sql`
      SELECT
        COUNT(*)::int as total_convos,
        SUM(CASE WHEN total_messages > 1 THEN 1 ELSE 0 END)::int as replied_convos
      FROM swell_conversations
      WHERE tenant_id = ${tenantId}
    `,
  ]);

  const total = replyStats[0]?.total_convos ?? 0;
  const replied = replyStats[0]?.replied_convos ?? 0;
  const replyRate =
    total > 0 ? `${Math.round((replied / total) * 100)}%` : "N/A";

  return {
    leadsToday: leadsToday[0]?.count ?? 0,
    leadsThisWeek: leadsThisWeek[0]?.count ?? 0,
    leadsTotal: leadsTotal[0]?.count ?? 0,
    activeConvos: activeConvos[0]?.count ?? 0,
    handoffConvos: handoffConvos[0]?.count ?? 0,
    bookedLeads: bookedLeads[0]?.count ?? 0,
    recentLeads: recentLeads.map((r: any) => ({
      name: r.full_name ?? "Unknown",
      phone: r.phone ?? "",
      status: r.status ?? "new",
      createdAt: new Date(r.created_at).toLocaleString("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    })),
    replyRate,
  };
}

// ─── AI Q&A ──────────────────────────────────────────────────────────────────

function buildSystemPrompt(
  stats: OwnerStats,
  tenantName: string,
  ownerName: string
): string {
  const recentList = stats.recentLeads
    .map((l) => `  • ${l.name} (${l.phone}) — ${l.status} — ${l.createdAt}`)
    .join("\n");

  return `You are Hayden, the AI assistant for ${tenantName}. You're talking directly with the owner, ${ownerName}.

Answer their question using the live pipeline data below. Be concise, direct, and helpful. Use bullet points when listing multiple items. Never make up data not in the snapshot.

## Current Pipeline Snapshot (live as of now)
- Leads today: ${stats.leadsToday}
- Leads this week: ${stats.leadsThisWeek}
- Total leads all-time: ${stats.leadsTotal}
- Active AI conversations: ${stats.activeConvos}
- Conversations waiting on you (handoff): ${stats.handoffConvos}
- Leads booked/closed: ${stats.bookedLeads}
- Reply rate: ${stats.replyRate}

## Most Recent Leads
${recentList || "  (none yet)"}

Keep responses short — this is a Discord chat, not a report. If they ask something you can't answer from this data, say so clearly.`;
}

export async function handleOwnerQuestion(
  tenantId: string,
  tenantName: string,
  ownerName: string,
  question: string
): Promise<string> {
  try {
    const stats = await fetchOwnerStats(tenantId);
    const systemPrompt = buildSystemPrompt(stats, tenantName, ownerName);

    const response = await anthropicChat({
      model: "claude-haiku-4-5",
      maxTokens: 400,
      system: systemPrompt,
      messages: [{ role: "user", content: question }],
      tenantId,
    });

    const text = response.text?.trim() ?? "Sorry, I had trouble generating a response.";

    console.log(
      `[owner-chat] ${tenantId} | "${question.slice(0, 60)}" → ${text.length} chars`
    );
    return text;
  } catch (err: any) {
    console.error("[owner-chat] Error:", err?.message);
    return "Sorry, I ran into an error pulling your stats. Try again in a moment.";
  }
}

// ─── Tenant lookup ───────────────────────────────────────────────────────────

/**
 * Find a tenant by Discord owner user ID (for DM-based chat).
 */
export async function findTenantByOwnerDiscordUserId(
  discordUserId: string
): Promise<{ id: string; name: string; owner_name: string; owner_discord_channel_id: string | null } | null> {
  const rows = await sql`
    SELECT id, name, owner_name, owner_discord_channel_id
    FROM swell_tenants
    WHERE owner_discord_user_id = ${discordUserId}
      AND enabled = true
    LIMIT 1
  `;
  return (rows[0] as any) ?? null;
}

/**
 * Find a tenant by their configured owner-chat Discord channel ID.
 */
export async function findTenantByOwnerChannel(
  channelId: string
): Promise<{ id: string; name: string; owner_name: string; owner_discord_user_id: string | null } | null> {
  const rows = await sql`
    SELECT id, name, owner_name, owner_discord_user_id
    FROM swell_tenants
    WHERE owner_discord_channel_id = ${channelId}
      AND enabled = true
    LIMIT 1
  `;
  return (rows[0] as any) ?? null;
}
