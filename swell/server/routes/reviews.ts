import { Router, type Request, type Response } from "express";
import { requireTenant } from "../middleware/tenant.js";
import { requireAuth } from "../middleware/auth.js";
import { listReviewFollows } from "../db/queries.js";
import { sql } from "../db/index.js";

const router = Router();
router.use(requireTenant, requireAuth);

router.get("/api/reviews", async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenant!.id;
    const follows = await listReviewFollows(tenantId, 200);
    // Enrich with lead name
    const enriched = await Promise.all(
      follows.map(async (rf) => {
        const leads = await sql<{ full_name?: string; phone?: string }[]>`SELECT full_name, phone FROM swell_leads WHERE id = ${rf.lead_id} LIMIT 1`;
        return {
          ...rf,
          lead_name: leads[0]?.full_name ?? null,
          lead_phone: leads[0]?.phone ?? null,
        };
      })
    );
    res.json(enriched);
  } catch (err) {
    console.error("[reviews] GET error:", err);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

router.get("/api/reviews/stats", async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenant!.id;
    const stats = await sql<any[]>`
      SELECT
        COUNT(*) FILTER (WHERE status != 'pending') as total_sent,
        COUNT(*) FILTER (WHERE route_taken = 'google_review') as routed_review,
        COUNT(*) FILTER (WHERE route_taken = 'feedback_form') as routed_feedback,
        ROUND(AVG(sentiment_score) FILTER (WHERE sentiment_score IS NOT NULL), 1) as avg_sentiment,
        COUNT(*) FILTER (WHERE status = 'no_response') as no_response
      FROM swell_review_follows
      WHERE tenant_id = ${tenantId}
    `;
    res.json(stats[0] || {});
  } catch (err) {
    console.error("[reviews] stats error:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;
