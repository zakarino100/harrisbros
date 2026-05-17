/**
 * Tenant-scoped lead routes.
 * All queries filter by req.tenant.id; never trust path/body for tenant_id.
 */
import { Router, type Request, type Response } from "express";
import { requireTenant } from "../middleware/tenant.js";
import { requireAuth } from "../middleware/auth.js";
import {
  listLeads,
  getLeadByIdForTenant,
  listActivityForLead,
  updateLeadStatus,
  getTenantKpis,
  logActivity,
  getConversationByLeadId,
  listConversationMessages,
  listConversations,
  getTenantById,
} from "../db/queries.js";
import { kickoffConversationForNewLead } from "../services/conversation.js";
import { sql } from "../db/index.js";

const router = Router();

router.use(requireTenant, requireAuth);

router.get("/api/leads", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const leads = await listLeads(tenantId, 500);
    res.json(
      leads.map((l) => ({
        id: l.id,
        createdAt: l.created_at,
        fullName: l.full_name,
        phone: l.phone,
        email: l.email,
        address: l.address,
        city: l.city,
        state: l.state,
        zip: l.zip,
        status: l.status,
        notes: l.notes,
        smsAlertSent: !!l.sms_alert_sent,
        smsAlertSentAt: l.sms_alert_sent_at,
        metaFormId: l.meta_form_id,
        metaCampaignId: l.meta_campaign_id,
        metaAdId: l.meta_ad_id,
        leadScore: l.lead_score,
        repeatProbability: l.repeat_probability,
      }))
    );
  } catch (err) {
    console.error("[leads] GET /api/leads error:", err);
    res.status(500).json({ error: "Failed to fetch leads" });
  }
});

router.get("/api/leads/:id", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid lead id" });

    const lead = await getLeadByIdForTenant(tenantId, id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const raw = lead.raw_payload;

    const activity = await listActivityForLead(tenantId, id);

    // Hayden's SMS transcript, if any
    const conv = await getConversationByLeadId(id);
    const messages = conv ? await listConversationMessages(conv.id) : [];

    res.json({
      id: lead.id,
      createdAt: lead.created_at,
      fullName: lead.full_name,
      phone: lead.phone,
      email: lead.email,
      address: lead.address,
      city: lead.city,
      state: lead.state,
      zip: lead.zip,
      status: lead.status,
      notes: lead.notes,
      smsAlertSent: !!lead.sms_alert_sent,
      smsAlertSentAt: lead.sms_alert_sent_at,
      metaLeadId: lead.meta_lead_id,
      metaFormId: lead.meta_form_id,
      metaCampaignId: lead.meta_campaign_id,
      metaAdsetId: lead.meta_adset_id,
      metaAdId: lead.meta_ad_id,
      leadScore: lead.lead_score,
      repeatProbability: lead.repeat_probability,
      rawPayload: raw,
      activity: activity.map((a) => ({
        id: a.id,
        type: a.type,
        direction: a.direction,
        body: a.body,
        createdAt: a.created_at,
        metadata: a.metadata,
      })),
      conversation: conv
        ? {
            id: conv.id,
            status: conv.status,
            handoffReason: conv.handoff_reason,
            totalMessages: conv.total_messages,
            quotedPriceCents: conv.quoted_price_cents,
            discountApplied: !!conv.discount_applied,
            messages: messages.map((m) => ({
              id: m.id,
              role: m.role,
              body: m.body,
              createdAt: m.created_at,
              modelUsed: m.model_used,
              error: m.error,
            })),
          }
        : null,
    });
  } catch (err) {
    console.error("[leads] GET /api/leads/:id error:", err);
    res.status(500).json({ error: "Failed to fetch lead" });
  }
});

router.patch("/api/leads/:id", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid lead id" });

    const existing = await getLeadByIdForTenant(tenantId, id);
    if (!existing) return res.status(404).json({ error: "Lead not found" });

    const { status, notes, full_name, phone, email, address, city, state, zip, home_sqft, window_count } = req.body ?? {};
    const allowedStatuses = ["new", "contacted", "quoted", "sold", "lost"];
    const nextStatus = typeof status === "string" && allowedStatuses.includes(status) ? status : null;

    const hasContactFields = [full_name, phone, email, address, city, state, zip].some(v => typeof v === "string");
    const hasPropertyFields = home_sqft !== undefined || window_count !== undefined;
    if (!nextStatus && typeof notes !== "string" && !hasContactFields && !hasPropertyFields) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    await updateLeadStatus(tenantId, id, nextStatus ?? existing.status, typeof notes === "string" ? notes : undefined);

    // Update contact fields if provided
    if (hasContactFields) {
      const fields: Record<string, string> = {};
      if (typeof full_name === "string") fields.full_name = full_name;
      if (typeof phone === "string") fields.phone = phone;
      if (typeof email === "string") fields.email = email;
      if (typeof address === "string") fields.address = address;
      if (typeof city === "string") fields.city = city;
      if (typeof state === "string") fields.state = state;
      if (typeof zip === "string") fields.zip = zip;
      for (const [field, value] of Object.entries(fields)) {
        await sql.unsafe(`UPDATE swell_leads SET ${field} = $1 WHERE id = $2 AND tenant_id = $3`, [value, id, tenantId]);
      }
      // Mirror to customer profile if linked
      const custRow = await sql<{customer_id: number|null}[]>`SELECT customer_id FROM swell_leads WHERE id = ${id} LIMIT 1`;
      const customerId = custRow[0]?.customer_id ?? null;
      if (customerId) {
        for (const [field, value] of Object.entries(fields)) {
          await sql.unsafe(`UPDATE swell_customers SET ${field} = $1 WHERE id = $2 AND (${field} IS NULL OR ${field} = '')`, [value, customerId]);
        }
      }
    }

    // Update property fields
    if (hasPropertyFields) {
      if (home_sqft !== undefined) {
        const sqft = home_sqft === null ? null : Number(home_sqft);
        await sql`UPDATE swell_leads SET home_sqft = ${sqft} WHERE id = ${id} AND tenant_id = ${tenantId}`;
        // Sync to customer
        const custRow2 = await sql<{customer_id: number|null}[]>`SELECT customer_id FROM swell_leads WHERE id = ${id} LIMIT 1`;
        const custId2 = custRow2[0]?.customer_id ?? null;
        if (custId2 && sqft) await sql`UPDATE swell_customers SET home_sqft = ${sqft} WHERE id = ${custId2} AND home_sqft IS NULL`;
      }
      if (window_count !== undefined) {
        const wc = window_count === null ? null : Number(window_count);
        await sql`UPDATE swell_leads SET window_count = ${wc} WHERE id = ${id} AND tenant_id = ${tenantId}`;
        const custRow3 = await sql<{customer_id: number|null}[]>`SELECT customer_id FROM swell_leads WHERE id = ${id} LIMIT 1`;
        const custId3 = custRow3[0]?.customer_id ?? null;
        if (custId3 && wc) await sql`UPDATE swell_customers SET window_count = ${wc} WHERE id = ${custId3} AND window_count IS NULL`;
      }
      // Boost lead score when property info is added (helps qualify)
      if (home_sqft || window_count) {
        await sql`
          UPDATE swell_leads SET lead_score = LEAST(100, COALESCE(lead_score, 50) + 5)
          WHERE id = ${id} AND tenant_id = ${tenantId}
        `;
      }
    }

    if (nextStatus && nextStatus !== existing.status) {
      await logActivity({
        lead_id: id,
        tenant_id: tenantId,
        type: "status_change",
        direction: "internal",
        body: `Status: ${existing.status} → ${nextStatus}`,
        metadata: { from: existing.status, to: nextStatus },
      });
    }

    const updated = (await getLeadByIdForTenant(tenantId, id))!;
    res.json({
      id: updated.id,
      status: updated.status,
      notes: updated.notes,
      full_name: updated.full_name,
      phone: updated.phone,
      email: updated.email,
      address: updated.address,
      city: updated.city,
      state: updated.state,
      zip: updated.zip,
      home_sqft: (updated as any).home_sqft ?? null,
      window_count: (updated as any).window_count ?? null,
      lead_score: (updated as any).lead_score ?? null,
    });
  } catch (err) {
    console.error("[leads] PATCH /api/leads/:id error:", err);
    res.status(500).json({ error: "Failed to update lead" });
  }
});

router.get("/api/dashboard/kpis", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const kpis = await getTenantKpis(tenantId);
    res.json(kpis);
  } catch (err) {
    console.error("[leads] GET /api/dashboard/kpis error:", err);
    res.status(500).json({ error: "Failed to fetch KPIs" });
  }
});

// ─── Conversations ─────────────────────────────────────────────────────────────

router.get("/api/conversations", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const conversations = await listConversations(tenantId);

    const list = conversations.map((c) => ({
      id: c.id,
      leadId: c.lead_id,
      status: c.status,
      lastMessageAt: c.last_message_at,
      createdAt: c.created_at,
    }));

    res.json(list);
  } catch (err) {
    console.error("[leads] GET /api/conversations error:", err);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

router.get("/api/conversations/:id/messages", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const convId = Number(req.params.id);
    if (!Number.isFinite(convId)) return res.status(400).json({ error: "Invalid conversation id" });

    // Verify conversation belongs to this tenant
    const conv = await listConversations(tenantId);
    const ourConv = conv.find((c) => c.id === convId);
    if (!ourConv) return res.status(404).json({ error: "Conversation not found" });

    // Get messages
    const messages = await listConversationMessages(convId);

    res.json({
      id: ourConv.id,
      status: ourConv.status,
      handoffReason: ourConv.handoff_reason,
      totalMessages: ourConv.total_messages,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        body: m.body,
        createdAt: m.created_at,
        modelUsed: m.model_used,
        error: m.error,
      })),
    });
  } catch (err) {
    console.error("[leads] GET /api/conversations/:id/messages error:", err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

router.get("/api/leads/:id/activity", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const leadId = Number(req.params.id);
    if (!Number.isFinite(leadId)) return res.status(400).json({ error: "Invalid lead id" });

    const activity = await listActivityForLead(tenantId, leadId);
    res.json(
      activity.map((a) => ({
        id: a.id,
        type: a.type,
        direction: a.direction,
        body: a.body,
        createdAt: a.created_at,
        metadata: a.metadata,
      }))
    );
  } catch (err) {
    console.error("[leads] GET /api/leads/:id/activity error:", err);
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});

// ─── Batch Kickoff ────────────────────────────────────────────────────────────

router.get("/api/leads/uncontacted", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const leads = await sql`
      SELECT 
        l.id, 
        l.full_name, 
        l.phone, 
        l.email, 
        l.status, 
        l.created_at, 
        l.notes,
        l.lead_score, 
        l.repeat_probability
      FROM swell_leads l
      LEFT JOIN swell_conversations c ON c.lead_id = l.id AND c.tenant_id = l.tenant_id
      WHERE l.tenant_id = ${tenantId}
        AND l.status NOT IN ('test', 'archived')
        AND (l.full_name IS NULL OR l.full_name NOT LIKE '<test%')
        AND l.phone IS NOT NULL
        AND (c.id IS NULL OR c.total_messages = 0)
      ORDER BY l.created_at DESC
      LIMIT 100
    `;
    res.json(leads);
  } catch (err) {
    console.error("[leads] GET /api/leads/uncontacted error:", err);
    res.status(500).json({ error: "Failed to fetch uncontacted leads" });
  }
});

router.post("/api/leads/bulk-kickoff", async (req: Request, res: Response) => {
  try {
    const { leadIds } = req.body ?? {};
    if (!Array.isArray(leadIds) || !leadIds.length) {
      return res.status(400).json({ error: "leadIds array required" });
    }

    const tenantId = req.tenant!.id;
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const results: { leadId: number; ok: boolean; reason?: string }[] = [];

    for (const leadId of leadIds.slice(0, 50)) {
      // cap at 50 per batch
      try {
        const leads = await sql<any[]>`
          SELECT * FROM swell_leads WHERE id = ${leadId} AND tenant_id = ${tenantId} LIMIT 1
        `;
        if (!leads.length) {
          results.push({ leadId, ok: false, reason: "not found" });
          continue;
        }
        const result = await kickoffConversationForNewLead(tenant, leads[0]);
        results.push({ leadId, ok: result.ok, reason: result.reason });
        // small delay between sends
        await new Promise((r) => setTimeout(r, 300));
      } catch (e: any) {
        results.push({ leadId, ok: false, reason: e?.message });
      }
    }

    res.json({
      ok: true,
      sent: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (err) {
    console.error("[leads] POST /api/leads/bulk-kickoff error:", err);
    res.status(500).json({ error: "Failed to kickoff conversations" });
  }
});

export default router;
