import { Router, type Request, type Response } from "express";
import { requireTenant } from "../middleware/tenant.js";
import { requireAuth } from "../middleware/auth.js";
import { sql } from "../db/index.js";
import { anthropicChat } from "../services/anthropic.js";

const router = Router();
router.use(requireTenant, requireAuth);

interface AnalyticsSummary {
  period: { days: number; from: string; to: string };
  funnel: {
    leads: number;
    conversations_started: number;
    quotes_sent: number;
    handoffs: number;
    bookings: number;
  };
  conversion_rates: {
    lead_to_conversation: number;
    conversation_to_quote: number;
    quote_to_booking: number;
    overall_close_rate: number;
  };
  by_source: Array<{
    campaign_name: string;
    ad_name: string;
    leads: number;
    conversations: number;
    bookings: number;
    close_rate: number;
  }>;
  nurture_performance: Array<{
    touch: string;
    fired: number;
    replies: number;
    reply_rate: number;
    bookings_from: number;
  }>;
  top_messages: Array<{
    body: string;
    role: string;
    led_to_booking: boolean;
    conversation_id: number;
  }>;
  ab_variants: Array<{
    variant: string;
    assigned: number;
    booked: number;
    close_rate: number;
  }>;
  insights: any[];
}

async function buildSummary(tenantId: string, days: number): Promise<AnalyticsSummary> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  const [
    leadCount,
    conversationStarted,
    quotesSent,
    handoffsData,
    bookingsData,
    bySourceData,
    nurturePerformance,
    topMessagesData,
    abVariantsData,
  ] = await Promise.all([
    // Leads in period
    sql`
      SELECT COUNT(*)::int AS count FROM swell_leads
      WHERE tenant_id = ${tenantId} AND created_at >= ${from}
    `,

    // Conversations with at least one message in period
    sql`
      SELECT COUNT(*)::int AS count FROM swell_conversations
      WHERE tenant_id = ${tenantId} AND created_at >= ${from} AND total_messages > 0
    `,

    // Distinct conversations where an assistant message contained a price
    sql`
      SELECT COUNT(DISTINCT conversation_id)::int AS count
      FROM swell_conversation_messages
      WHERE tenant_id = ${tenantId} AND created_at >= ${from}
        AND role = 'assistant' AND body ILIKE '%$%'
    `,

    // Handoffs in period
    sql`
      SELECT COUNT(*)::int AS count FROM swell_conversations
      WHERE tenant_id = ${tenantId} AND status = 'handoff' AND updated_at >= ${from}
    `,

    // Bookings (ready to book or win)
    sql`
      SELECT COUNT(*)::int AS count FROM swell_conversations
      WHERE tenant_id = ${tenantId}
        AND status = 'handoff'
        AND (handoff_reason ILIKE '%ready to book%' OR handoff_reason ILIKE '%win%')
        AND updated_at >= ${from}
    `,

    // By campaign / ad source
    sql`
      SELECT
        COALESCE(NULLIF(sl.meta_campaign_id, ''), 'Direct / Unknown') AS campaign_name,
        COALESCE(NULLIF(sl.meta_ad_id, ''), 'Direct / Unknown')       AS ad_name,
        COUNT(DISTINCT sl.id)::int AS leads,
        COUNT(DISTINCT sc.id) FILTER (WHERE sc.total_messages > 0)::int AS conversations,
        COUNT(DISTINCT sc.id) FILTER (
          WHERE sc.status = 'handoff'
            AND (sc.handoff_reason ILIKE '%ready to book%' OR sc.handoff_reason ILIKE '%win%')
        )::int AS bookings
      FROM swell_leads sl
      LEFT JOIN swell_conversations sc ON sc.lead_id = sl.id
      WHERE sl.tenant_id = ${tenantId} AND sl.created_at >= ${from}
      GROUP BY campaign_name, ad_name
      ORDER BY leads DESC
      LIMIT 10
    `,

    // Nurture touch performance via nurture_jobs + reply detection
    sql`
      SELECT
        snj.kind                                                   AS touch,
        COUNT(DISTINCT snj.id)::int                               AS fired,
        COUNT(DISTINCT sc.id) FILTER (WHERE sc.last_role = 'user')::int AS replies,
        COUNT(DISTINCT sc.id) FILTER (
          WHERE sc.status = 'handoff'
            AND (sc.handoff_reason ILIKE '%ready to book%' OR sc.handoff_reason ILIKE '%win%')
        )::int AS bookings_from
      FROM swell_nurture_jobs snj
      LEFT JOIN swell_conversations sc ON sc.lead_id = snj.lead_id
      WHERE snj.tenant_id = ${tenantId}
        AND snj.fired_at IS NOT NULL
        AND snj.fired_at >= ${from}
      GROUP BY snj.kind
      ORDER BY fired DESC
    `,

    // Top messages from booking conversations (most recent 10)
    sql`
      SELECT
        SUBSTRING(scm.body, 1, 200) AS body,
        scm.role,
        sc.id                       AS conversation_id
      FROM swell_conversation_messages scm
      JOIN swell_conversations sc ON sc.id = scm.conversation_id
      WHERE sc.tenant_id = ${tenantId}
        AND sc.status = 'handoff'
        AND (sc.handoff_reason ILIKE '%ready to book%' OR sc.handoff_reason ILIKE '%win%')
        AND scm.created_at >= ${from}
        AND scm.role = 'assistant'
      ORDER BY sc.updated_at DESC
      LIMIT 10
    `,

    // A/B variant summary
    sql`
      SELECT
        variant,
        COUNT(*)::int                                AS assigned,
        COUNT(*) FILTER (WHERE outcome = 'booked')::int AS booked
      FROM swell_ab_variants
      WHERE tenant_id = ${tenantId}
        AND variant_group = 'nurture_sequence'
        AND assigned_at >= ${from}
      GROUP BY variant
      ORDER BY variant
    `,
  ]);

  const totalLeads        = (leadCount[0] as any)?.count ?? 0;
  const totalConversations = (conversationStarted[0] as any)?.count ?? 0;
  const totalQuotes       = (quotesSent[0] as any)?.count ?? 0;
  const totalHandoffs     = (handoffsData[0] as any)?.count ?? 0;
  const totalBookings     = (bookingsData[0] as any)?.count ?? 0;

  const leadToConv    = totalLeads > 0        ? (totalConversations / totalLeads) * 100        : 0;
  const convToQuote   = totalConversations > 0 ? (totalQuotes / totalConversations) * 100       : 0;
  const quoteToBook   = totalQuotes > 0        ? (totalBookings / totalQuotes) * 100            : 0;
  const overallClose  = totalLeads > 0         ? (totalBookings / totalLeads) * 100             : 0;

  const bySource = (bySourceData as any[]).map((r) => ({
    campaign_name: r.campaign_name,
    ad_name:       r.ad_name,
    leads:         r.leads,
    conversations: r.conversations,
    bookings:      r.bookings,
    close_rate:    r.leads > 0 ? Math.round((r.bookings / r.leads) * 1000) / 10 : 0,
  }));

  // Sort by close rate desc so best row is first (gold highlight on frontend)
  bySource.sort((a, b) => b.close_rate - a.close_rate);

  const nurture = (nurturePerformance as any[]).map((r) => ({
    touch:        r.touch,
    fired:        r.fired,
    replies:      r.replies,
    reply_rate:   r.fired > 0 ? Math.round((r.replies / r.fired) * 1000) / 10 : 0,
    bookings_from: r.bookings_from,
  }));

  const topMessages = (topMessagesData as any[]).map((r) => ({
    body:            r.body,
    role:            r.role,
    led_to_booking:  true,
    conversation_id: Number(r.conversation_id),
  }));

  const abVariants = (abVariantsData as any[]).map((r) => ({
    variant:    r.variant,
    assigned:   r.assigned,
    booked:     r.booked,
    close_rate: r.assigned > 0 ? Math.round((r.booked / r.assigned) * 1000) / 10 : 0,
  }));

  return {
    period: { days, from: from.toISOString(), to: to.toISOString() },
    funnel: {
      leads:                  totalLeads,
      conversations_started:  totalConversations,
      quotes_sent:            totalQuotes,
      handoffs:               totalHandoffs,
      bookings:               totalBookings,
    },
    conversion_rates: {
      lead_to_conversation:  Math.round(leadToConv   * 10) / 10,
      conversation_to_quote: Math.round(convToQuote  * 10) / 10,
      quote_to_booking:      Math.round(quoteToBook  * 10) / 10,
      overall_close_rate:    Math.round(overallClose  * 10) / 10,
    },
    by_source:           bySource,
    nurture_performance: nurture,
    top_messages:        topMessages,
    ab_variants:         abVariants,
    insights:            [],
  };
}

// ─── GET /api/analytics/summary?days=30 ───────────────────────────────────────
router.get("/api/analytics/summary", async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const days = Math.min(365, Math.max(1, parseInt(req.query.days as string) || 30));
  try {
    const summary = await buildSummary(tenantId, days);
    res.json(summary);
  } catch (err) {
    console.error("[analytics/summary]", err);
    res.status(500).json({ error: "Failed to load analytics" });
  }
});

// ─── POST /api/analytics/insights ─────────────────────────────────────────────
router.post("/api/analytics/insights", async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  try {
    const summary = await buildSummary(tenantId, 30);

    const result = await anthropicChat({
      model: "claude-haiku-4-5",
      system: "You are a sales analytics AI for a home services company. You output ONLY valid JSON arrays, no markdown, no prose.",
      messages: [{
        role: "user",
        content:
          `Analyze this sales funnel data and provide 3–5 actionable insights.\n` +
          `Focus on: what's working, what message timing gets the most replies, how to improve close rate.\n` +
          `Be specific and data-driven.\n\n` +
          `Data:\n${JSON.stringify(summary, null, 2)}\n\n` +
          `Respond with ONLY a JSON array: [{"title":"...","insight":"...","action":"...","impact":"high"|"medium"|"low"}]`,
      }],
      maxTokens: 600,
      tenantId,
    });

    let insights: any[] = [];
    try {
      const m = result.text.match(/\[[\s\S]*\]/);
      if (m) insights = JSON.parse(m[0]);
    } catch {
      console.error("[insights] Failed to parse Claude response:", result.text.slice(0, 200));
    }

    res.json({ insights });
  } catch (err) {
    console.error("[analytics/insights]", err);
    res.status(500).json({ error: "Failed to generate insights" });
  }
});

// ─── PATCH /api/analytics/ab-outcome ──────────────────────────────────────────
router.patch("/api/analytics/ab-outcome", async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const { lead_id, variant_group, outcome } = req.body ?? {};

  if (!lead_id || !variant_group || !outcome) {
    return res.status(400).json({ error: "Missing lead_id, variant_group, or outcome" });
  }

  try {
    await sql`
      UPDATE swell_ab_variants
      SET outcome = ${outcome}, outcome_at = NOW()
      WHERE tenant_id = ${tenantId}
        AND lead_id   = ${lead_id}
        AND variant_group = ${variant_group}
    `;
    res.json({ ok: true });
  } catch (err) {
    console.error("[analytics/ab-outcome]", err);
    res.status(500).json({ error: "Failed to update outcome" });
  }
});

export default router;
