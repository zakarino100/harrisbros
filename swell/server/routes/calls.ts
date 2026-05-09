import { Router, type Request, type Response } from "express";
import { requireTenant } from "../middleware/tenant.js";
import { requireAuth } from "../middleware/auth.js";
import { sql } from "../db/index.js";
import { createOutboundCall, isVapiConfigured } from "../services/vapi.js";
import { normalizePhone } from "../services/twilio.js";

const router = Router();
router.use(requireTenant, requireAuth);

// GET /api/calls — list calls for tenant
router.get("/api/calls", async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const calls = await sql`
    SELECT c.*, l.full_name as lead_name
    FROM swell_calls c
    LEFT JOIN swell_leads l ON l.id = c.lead_id
    WHERE c.tenant_id = ${req.tenant!.id}
    ORDER BY c.created_at DESC
    LIMIT ${limit}
  `;
  res.json(calls);
});

// GET /api/calls/stats
router.get("/api/calls/stats", async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const stats = await sql`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE direction = 'inbound')::int as inbound,
      COUNT(*) FILTER (WHERE direction = 'outbound')::int as outbound,
      COUNT(*) FILTER (WHERE status = 'completed')::int as completed,
      COUNT(*) FILTER (WHERE status = 'no-answer')::int as no_answer,
      COUNT(*) FILTER (WHERE status = 'voicemail')::int as voicemail,
      ROUND(AVG(duration_seconds) FILTER (WHERE duration_seconds > 0))::int as avg_duration_seconds
    FROM swell_calls WHERE tenant_id = ${tenantId}
  `;
  res.json({ ...stats[0], vapiConfigured: isVapiConfigured() });
});

// POST /api/calls/outbound — trigger outbound call to a lead or direct phone
router.post("/api/calls/outbound", async (req: Request, res: Response) => {
  const { leadId, phone: directPhone, name: directName } = req.body ?? {};
  if (!leadId && !directPhone) return res.status(400).json({ error: "leadId or phone required" });
  if (!isVapiConfigured()) return res.status(503).json({ error: "VAPI not configured" });

  const tenant = req.tenant!;
  const assistantId = (tenant as any).vapi_assistant_id
    ?? process.env[`${tenant.id.toUpperCase()}_VAPI_ASSISTANT_ID`];
  if (!assistantId) return res.status(400).json({ error: "No VAPI assistant configured" });

  let targetPhone: string;
  let resolvedLeadId: number | null = null;

  if (leadId) {
    const leads = await sql`SELECT * FROM swell_leads WHERE id = ${leadId} AND tenant_id = ${tenant.id} LIMIT 1`;
    if (!leads.length || !leads[0].phone) return res.status(404).json({ error: "Lead not found or no phone" });
    targetPhone = leads[0].phone;
    resolvedLeadId = leads[0].id;
  } else {
    targetPhone = directPhone;
    // Try to find existing lead by phone
    const existing = await sql`
      SELECT id FROM swell_leads WHERE tenant_id = ${tenant.id}
        AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE ${'%' + directPhone.replace(/\D/g,'').slice(-10)}
      LIMIT 1
    `;
    if (existing.length) {
      resolvedLeadId = existing[0].id;
    } else if (directPhone) {
      // Create a lead for this new number
      const rows = await sql`
        INSERT INTO swell_leads (tenant_id, meta_lead_id, phone, full_name, status, notes)
        VALUES (${tenant.id}, ${'dial_' + Date.now()}, ${normalizePhone(directPhone) ?? directPhone},
                ${directName ?? null}, 'new', 'Created from CRM dialer')
        RETURNING id
      `;
      resolvedLeadId = rows[0].id;
    }
  }

  const result = await createOutboundCall({
    toPhone: normalizePhone(targetPhone) ?? targetPhone,
    fromPhone: tenant.twilio_from ?? "",
    assistantId,
    metadata: { tenantId: tenant.id, leadId: resolvedLeadId },
  });

  if (!result) return res.status(500).json({ error: "Failed to initiate call" });

  await sql`
    INSERT INTO swell_calls (tenant_id, lead_id, vapi_call_id, direction, status, to_phone, from_phone)
    VALUES (${tenant.id}, ${resolvedLeadId}, ${result.callId}, 'outbound', 'queued',
            ${targetPhone}, ${tenant.twilio_from})
  `;

  res.json({ ok: true, callId: result.callId, leadId: resolvedLeadId });
});

export default router;

// GET /api/reports — list call analysis reports
router.get("/api/reports", async (req: Request, res: Response) => {
  const reports = await sql`
    SELECT id, tenant_id, period_from, period_to, call_count, report_text, sent_at, created_at
    FROM swell_call_reports
    ORDER BY created_at DESC
    LIMIT 20
  `;
  res.json(reports);
});
