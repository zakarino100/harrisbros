import { Router, type Request, type Response } from "express";
import { requireTenant } from "../middleware/tenant.js";
import { requireAuth } from "../middleware/auth.js";
import { sql } from "../db/index.js";

const router = Router();
router.use(requireTenant, requireAuth);

router.get("/api/stats", async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;

  try {
    // Run all queries in parallel
    const [
      leadTotals,
      leadByTemp,
      leadTrend,
      apptTotals,
      revenueTotals,
      topServices,
      convTotals,
      reviewTotals,
    ] = await Promise.all([
      // Lead totals by status
      sql`
        SELECT status, COUNT(*)::int as count
        FROM swell_leads
        WHERE tenant_id = ${tenantId}
          AND status NOT IN ('test', 'archived')
          AND (full_name IS NULL OR full_name NOT LIKE '<test%')
        GROUP BY status
      `,

      // Lead temperature distribution
      sql`
        SELECT
          COUNT(*) FILTER (WHERE repeat_probability = 'hot')::int as hot,
          COUNT(*) FILTER (WHERE repeat_probability = 'warm')::int as warm,
          COUNT(*) FILTER (WHERE repeat_probability = 'cold')::int as cold,
          COUNT(*)::int as total
        FROM swell_leads
        WHERE tenant_id = ${tenantId}
          AND status NOT IN ('test', 'archived')
          AND (full_name IS NULL OR full_name NOT LIKE '<test%')
      `,

      // Lead trend — last 30 days
      sql`
        SELECT
          DATE_TRUNC('day', created_at AT TIME ZONE 'America/New_York')::date::text as date,
          COUNT(*)::int as count
        FROM swell_leads
        WHERE tenant_id = ${tenantId}
          AND created_at > NOW() - INTERVAL '30 days'
          AND status NOT IN ('test', 'archived')
          AND (full_name IS NULL OR full_name NOT LIKE '<test%')
        GROUP BY 1
        ORDER BY 1
      `,

      // Appointment totals
      sql`
        SELECT
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE status = 'pending')::int as pending,
          COUNT(*) FILTER (WHERE status = 'confirmed')::int as confirmed,
          COUNT(*) FILTER (WHERE status = 'completed')::int as completed,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int as cancelled,
          COUNT(*) FILTER (WHERE status = 'no_show')::int as no_show
        FROM swell_appointments
        WHERE tenant_id = ${tenantId}
      `,

      // Revenue totals
      sql`
        SELECT
          COALESCE(SUM(quoted_price_cents) FILTER (WHERE status = 'completed'), 0)::int as total_cents,
          COALESCE(AVG(quoted_price_cents) FILTER (WHERE status IN ('confirmed','completed') AND quoted_price_cents > 0), 0)::int as avg_ticket_cents,
          COUNT(*) FILTER (WHERE status = 'completed' AND quoted_price_cents > 0)::int as paid_jobs
        FROM swell_appointments
        WHERE tenant_id = ${tenantId}
      `,

      // Top services by bookings
      sql`
        SELECT
          service_summary as service,
          COUNT(*)::int as bookings,
          COALESCE(SUM(quoted_price_cents) FILTER (WHERE status IN ('confirmed','completed')), 0)::int as revenue_cents
        FROM swell_appointments
        WHERE tenant_id = ${tenantId}
          AND service_summary IS NOT NULL
        GROUP BY service_summary
        ORDER BY bookings DESC
        LIMIT 8
      `,

      // Conversation funnel
      sql`
        SELECT
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE status = 'active')::int as active,
          COUNT(*) FILTER (WHERE status = 'handoff')::int as handoffs,
          COUNT(*) FILTER (WHERE status = 'dnc')::int as dnc,
          COALESCE(AVG(total_messages) FILTER (WHERE status IN ('handoff','completed')), 0)::numeric(4,1) as avg_msgs_to_close
        FROM swell_conversations
        WHERE tenant_id = ${tenantId}
      `,

      // Review stats
      sql`
        SELECT
          COUNT(*)::int as total,
          COUNT(*) FILTER (WHERE route_taken = 'google_review')::int as routed_review,
          COUNT(*) FILTER (WHERE route_taken = 'feedback_form')::int as routed_feedback,
          ROUND(AVG(sentiment_score) FILTER (WHERE sentiment_score IS NOT NULL), 1)::float as avg_sentiment
        FROM swell_review_follows
        WHERE tenant_id = ${tenantId}
      `,
    ]);

    // Compute derived metrics
    const leads = leadTotals as any[];
    const temp = leadByTemp[0] as any;
    const appt = apptTotals[0] as any;
    const rev = revenueTotals[0] as any;
    const conv = convTotals[0] as any;
    const review = reviewTotals[0] as any;

    const totalLeads = temp?.total ?? 0;
    const closeRate = totalLeads > 0 ? Math.round((appt?.completed ?? 0) / totalLeads * 100) : 0;
    const schedulingRate = totalLeads > 0 ? Math.round((appt?.total ?? 0) / totalLeads * 100) : 0;
    const convRate = totalLeads > 0 ? Math.round(((conv?.handoffs ?? 0) + (appt?.confirmed ?? 0) + (appt?.completed ?? 0)) / totalLeads * 100) : 0;

    res.json({
      leads: {
        total: totalLeads,
        byStatus: Object.fromEntries(leads.map((r: any) => [r.status, r.count])),
        byTemperature: { hot: temp?.hot ?? 0, warm: temp?.warm ?? 0, cold: temp?.cold ?? 0 },
        trend: leadTrend,
      },
      appointments: {
        ...appt,
        schedulingRate,
      },
      revenue: {
        totalDollars: Math.round((rev?.total_cents ?? 0) / 100),
        avgTicket: Math.round((rev?.avg_ticket_cents ?? 0) / 100),
        paidJobs: rev?.paid_jobs ?? 0,
        topServices: topServices,
      },
      conversations: {
        ...conv,
        closeRate,
        convRate,
      },
      reviews: review,
    });
  } catch (err) {
    console.error("[stats]", err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

export default router;
