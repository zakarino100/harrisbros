import { Router, type Request, type Response } from "express";
import { requireTenant } from "../middleware/tenant.js";
import { requireAuth } from "../middleware/auth.js";
import { sql } from "../db/index.js";
import { anthropicChat } from "../services/anthropic.js";

const router = Router();
router.use(requireTenant, requireAuth);

interface AnalyticsSummary {
  period: {
    days: number;
    from: string;
    to: string;
  };
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
  insights: any[];
}

router.get("/api/analytics/summary", async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const days = parseInt(req.query.days as string) || 30;

  try {
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
    ] = await Promise.all([
      // Leads in period
      sql`
        SELECT COUNT(*)::int as count FROM swell_leads
        WHERE tenant_id = ${tenantId} AND created_at >= ${from}
      `,

      // Conversations with messages
      sql`
        SELECT COUNT(*)::int as count FROM swell_conversations
        WHERE tenant_id = ${tenantId} AND created_at >= ${from} AND total_messages > 0
      `,

      // Quotes sent (messages with $ pattern)
      sql`
        SELECT COUNT(DISTINCT conversation_id)::int as count FROM swell_conversation_messages
        WHERE tenant_id = ${tenantId} AND created_at >= ${from} AND role = 'assistant' AND body ILIKE '%$%'
      `,

      // Handoffs
      sql`
        SELECT COUNT(*)::int as count FROM swell_conversations
        WHERE tenant_id = ${tenantId} AND status = 'handoff' AND updated_at >= ${from}
      `,

      // Bookings (handoff with 'ready to book' or 'win')
      sql`
        SELECT COUNT(*)::int as count FROM swell_conversations
        WHERE tenant_id = ${tenantId} 
          AND status = 'handoff'
          AND (handoff_reason ILIKE '%ready to book%' OR handoff_reason ILIKE '%win%')
          AND updated_at >= ${from}
      `,

      // By campaign/ad source
      sql`
        SELECT
          COALESCE(sl.meta_campaign_id, 'Direct / Unknown') as campaign_name,
          COALESCE(sl.meta_ad_id, 'Direct / Unknown') as ad_name,
          COUNT(DISTINCT sl.id)::int as leads,
          COUNT(DISTINCT sc.id) FILTER (WHERE sc.total_messages > 0)::int as conversations,
          COUNT(DISTINCT sc.id) FILTER (WHERE sc.status = 'handoff' AND (sc.handoff_reason ILIKE '%ready to book%' OR sc.handoff_reason ILIKE '%win%'))::int as bookings
        FROM swell_leads sl
        LEFT JOIN swell_conversations sc ON sc.lead_id = sl.id
        WHERE sl.tenant_id = ${tenantId} AND sl.created_at >= ${from}
        GROUP BY campaign_name, ad_name
        ORDER BY leads DESC
        LIMIT 10
      `,

      // Nurture touch performance
      sql`
        SELECT
          snj.kind as touch,
          COUNT(DISTINCT snj.id)::int as fired,
          COUNT(DISTINCT CASE WHEN scm.role = 'user' THEN scm.conversation_id END)::int as replies,
          COUNT(DISTINCT CASE WHEN sc.status = 'handoff' AND (sc.handoff_reason ILIKE '%ready to book%' OR sc.handoff_reason ILIKE '%win%') THEN sc.id END)::int as bookings_from
        FROM swell_nurture_jobs snj
        LEFT JOIN swell_conversations sc ON sc.lead_id = snj.lead_id
        LEFT JOIN swell_conversation_messages scm ON scm.conversation_id = sc.id AND scm.created_at > snj.fired_at
        WHERE snj.tenant_id = ${tenantId} AND snj.status = 'scheduled' AND snj.created_at >= ${from}
        GROUP BY snj.kind
        ORDER BY fired DESC
      `,

      // Top messages from successful bookings
      sql`
        SELECT
          SUBSTRING(scm.body, 1, 200) as body,
          scm.role,
          sc.id as conversation_id
        FROM swell_conversation_messages scm
        JOIN swell_conversations sc ON sc.id = scm.conversation_id
        WHERE sc.tenant_id = ${tenantId}
          AND sc.status = 'handoff'
          AND (sc.handoff_reason ILIKE '%ready to book%' OR sc.handoff_reason ILIKE '%win%')
          AND scm.created_at >= ${from}
        ORDER BY sc.updated_at DESC
        LIMIT 10
      `,
    ]);

    const totalLeads = (leadCount[0] as any)?.count ?? 0;
    const totalConversations = (conversationStarted[0] as any)?.count ?? 0;
    const totalQuotes = (quotesSent[0] as any)?.count ?? 0;
    const totalHandoffs = (handoffsData[0] as any)?.count ?? 0;
    const totalBookings = (bookingsData[0] as any)?.count ?? 0;

    // Calculate conversion rates
    const leadToConv = totalLeads > 0 ? (totalConversations / totalLeads) * 100 : 0;
    const convToQuote = totalConversations > 0 ? (totalQuotes / totalConversations) * 100 : 0;
    const quoteToBooking = totalQuotes > 0 ? (totalBookings / totalQuotes) * 100 : 0;
    const overallClose = totalLeads > 0 ? (totalBookings / totalLeads) * 100 : 0;

    // Format by source data with close rates
    const bySource = (bySourceData as any[]).map((row) => ({
      campaign_name: row.campaign_name,
      ad_name: row.ad_name,
      leads: row.leads,
      conversations: row.conversations,
      bookings: row.bookings,
      close_rate: row.leads > 0 ? (row.bookings / row.leads) * 100 : 0,
    }));

    // Format nurture performance
    const nurture = (nurturePerformance as any[]).map((row) => ({
      touch: row.touch,
      fired: row.fired,
      replies: row.replies,
      reply_rate: row.fired > 0 ? (row.replies / row.fired) * 100 : 0,
      bookings_from: row.bookings_from,
    }));

    // Format top messages
    const topMessages = (topMessagesData as any[]).map((row) => ({
      body: row.body,
      role: row.role,
      led_to_booking: true,
      conversation_id: row.conversation_id,
    }));

    const summary: AnalyticsSummary = {
      period: {
        days,
        from: from.toISOString(),
        to: to.toISOString(),
      },
      funnel: {
        leads: totalLeads,
        conversations_started: totalConversations,
        quotes_sent: totalQuotes,
        handoffs: totalHandoffs,
        bookings: totalBookings,
      },
      conversion_rates: {
        lead_to_conversation: Math.round(leadToConv * 100) / 100,
        conversation_to_quote: Math.round(convToQuote * 100) / 100,
        quote_to_booking: Math.round(quoteToBooking * 100) / 100,
        overall_close_rate: Math.round(overallClose * 100) / 100,
      },
      by_source: bySource,
      nurture_performance: nurture,
      top_messages: topMessages,
      insights: [],
    };

    res.json(summary);
  } catch (err) {
    console.error("[analytics/summary]", err);
    res.status(500).json({ error: "Failed to load analytics" });
  }
});

router.post("/api/analytics/insights", async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;

  try {
    // Fetch the latest summary
    const summary = await fetch(`http://localhost:${process.env.PORT || 3000}/api/analytics/summary?days=30`, {
      headers: { cookie: req.headers.cookie || "" },
    }).then((r) => r.json());

    // Call Claude to generate insights
    const insightPrompt = `You are a sales analytics AI for a home services company. Analyze this sales funnel data and provide 3–5 actionable insights. Focus on: what's working, what message timing gets the most replies, how to improve close rate. Be specific and data-driven. 

Data: ${JSON.stringify(summary, null, 2)}

Respond ONLY with a valid JSON array of objects with this shape:
[{"title": "string", "insight": "string", "action": "string", "impact": "high"|"medium"|"low"}]

No markdown, no extra text.`;

    const result = await anthropicChat({
      model: "claude-haiku-4-5",
      system:
        "You are a sales analytics AI for a home services company. Generate insights in JSON format only.",
      messages: [{ role: "user", content: insightPrompt }],
      maxTokens: 500,
      tenantId,
    });

    let insights = [];
    try {
      // Extract JSON from the response
      const jsonMatch = result.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        insights = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error("[insights] Failed to parse Claude response:", e);
      insights = [];
    }

    res.json({ insights });
  } catch (err) {
    console.error("[analytics/insights]", err);
    res.status(500).json({ error: "Failed to generate insights" });
  }
});

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
      WHERE tenant_id = ${tenantId} AND lead_id = ${lead_id} AND variant_group = ${variant_group}
    `;

    res.json({ ok: true });
  } catch (err) {
    console.error("[analytics/ab-outcome]", err);
    res.status(500).json({ error: "Failed to update outcome" });
  }
});

export default router;
