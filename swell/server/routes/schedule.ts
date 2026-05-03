import { Router, type Request, type Response } from "express";
import { sql } from "../db/index.js";
import { capiAppointmentConfirmed, capiJobCompleted } from "../services/meta-capi.js";
import { requireTenant } from "../middleware/tenant.js";
import { requireAuth } from "../middleware/auth.js";
import {
  getScheduleConfig, upsertScheduleConfig,
  listAppointments, createAppointment, updateAppointment,
  getAIConfig,
} from "../db/queries.js";
import { getAvailableSlots } from "../services/scheduling.js";
import { getCachedForecast } from "../services/weather.js";

const router = Router();
router.use(requireTenant, requireAuth);

// GET /api/schedule/config
router.get("/api/schedule/config", async (req: Request, res: Response) => {
  const cfg = await getScheduleConfig(req.tenant!.id);
  res.json(cfg ?? null);
});

// PUT /api/schedule/config
router.put("/api/schedule/config", async (req: Request, res: Response) => {
  await upsertScheduleConfig({ tenant_id: req.tenant!.id, ...req.body });
  res.json({ ok: true });
});

// GET /api/schedule/slots?days=14
router.get("/api/schedule/slots", async (req: Request, res: Response) => {
  const days = Math.min(Number(req.query.days ?? 14), 30);
  const slots = await getAvailableSlots(req.tenant!.id, days);
  res.json(slots);
});

// GET /api/schedule/appointments?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/api/schedule/appointments", async (req: Request, res: Response) => {
  const appts = await listAppointments(
    req.tenant!.id,
    req.query.from as string | undefined,
    req.query.to as string | undefined,
  );
  res.json(appts);
});

// POST /api/schedule/appointments
router.post("/api/schedule/appointments", async (req: Request, res: Response) => {
  const id = await createAppointment({ tenant_id: req.tenant!.id, ...req.body });
  res.json({ ok: true, id });
});

// PATCH /api/schedule/appointments/:id
router.patch("/api/schedule/appointments/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const tenant = req.tenant!;
  await updateAppointment(id, tenant.id, req.body);
  res.json({ ok: true });

  // Fire CAPI events when appointment status changes
  const newStatus = req.body?.status;
  if (newStatus === "confirmed" || newStatus === "completed") {
    try {
      const appts = await sql`
        SELECT a.*, l.phone, l.email, l.full_name
        FROM swell_appointments a
        JOIN swell_leads l ON l.id = a.lead_id
        WHERE a.id = ${id} AND a.tenant_id = ${tenant.id}
        LIMIT 1
      `;
      const appt = appts[0];
      if (appt) {
        if (newStatus === "confirmed") {
          await capiAppointmentConfirmed({
            tenantId: tenant.id, tenant,
            leadId: appt.lead_id,
            phone: appt.phone, email: appt.email,
            quotedCents: appt.quoted_price_cents ?? undefined,
            service: appt.service_summary,
          });
        } else if (newStatus === "completed" && appt.quoted_price_cents) {
          await capiJobCompleted({
            tenantId: tenant.id, tenant,
            leadId: appt.lead_id,
            phone: appt.phone, email: appt.email,
            priceCents: appt.quoted_price_cents,
            service: appt.service_summary,
          });
        }
      }
    } catch (e: any) {
      console.error("[capi] appointment status event failed:", e?.message);
    }
  }
});

// POST /api/schedule/appointments/:id/complete
router.post("/api/schedule/appointments/:id/complete", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const tenant = req.tenant!;
  await updateAppointment(id, tenant.id, { status: "completed" });
  res.json({ ok: true });
});

// POST /api/schedule/appointments/:id/review
router.post("/api/schedule/appointments/:id/review", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const tenant = req.tenant!;
  // Trigger review follow-up SMS
  try {
    const appts = await sql`
      SELECT a.*, l.phone, l.id as lead_id
      FROM swell_appointments a
      JOIN swell_leads l ON l.id = a.lead_id
      WHERE a.id = ${id} AND a.tenant_id = ${tenant.id}
      LIMIT 1
    `;
    const appt = appts[0];
    if (appt && appt.phone) {
      // Create review follow-up record
      await sql`
        INSERT INTO swell_review_follows (tenant_id, lead_id, appointment_id, follow_up_phone)
        VALUES (${tenant.id}, ${appt.lead_id}, ${id}, ${appt.phone})
        ON CONFLICT DO NOTHING
      `;
    }
  } catch (e: any) {
    console.error("[review] follow-up failed:", e?.message);
  }
  res.json({ ok: true });
});

// GET /api/schedule/pending — leads in "ready to book" handoff awaiting scheduling
router.get("/api/schedule/pending", async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  const rows = await sql`
    SELECT
      c.id            AS conversation_id,
      c.handoff_reason,
      c.quoted_price_cents,
      c.created_at    AS conversation_created_at,
      l.id            AS lead_id,
      l.full_name,
      l.phone,
      l.email,
      l.address,
      l.city,
      l.state,
      l.zip,
      a.id            AS appointment_id
    FROM swell_conversations c
    JOIN swell_leads l ON l.id = c.lead_id
    -- exclude leads that already have a scheduled (non-cancelled) appointment
    LEFT JOIN swell_appointments a
      ON a.lead_id = l.id
     AND a.tenant_id = ${tenantId}
     AND a.status NOT IN ('cancelled', 'no_show')
    WHERE c.tenant_id = ${tenantId}
      AND c.status = 'handoff'
      AND (
        c.handoff_reason ILIKE '%ready to book%'
        OR c.handoff_reason ILIKE '%win%'
        OR c.handoff_reason ILIKE '%booked%'
      )
      AND l.status NOT IN ('test', 'archived')
      AND a.id IS NULL
    ORDER BY c.created_at DESC
    LIMIT 50
  `;
  res.json(rows);
});

// GET /api/schedule/weather
router.get("/api/schedule/weather", async (req: Request, res: Response) => {
  const aiCfg = await getAIConfig(req.tenant!.id);
  const scheduleCfg = await getScheduleConfig(req.tenant!.id);
  const cities: string[] = scheduleCfg?.service_cities?.length
    ? scheduleCfg.service_cities
    : (Array.isArray(aiCfg?.route_cities_json) ? aiCfg!.route_cities_json as string[] : []);
  const primaryCity = cities[0];
  if (!primaryCity) return res.json([]);
  const forecast = await getCachedForecast(primaryCity, scheduleCfg?.timezone ?? "America/New_York");
  res.json(forecast);
});

// GET /api/schedule/crews
router.get("/api/schedule/crews", async (req: Request, res: Response) => {
  const crews = await sql`SELECT * FROM swell_crews WHERE tenant_id = ${req.tenant!.id} AND active = true ORDER BY id`;
  res.json(crews);
});

// POST /api/schedule/crews
router.post("/api/schedule/crews", async (req: Request, res: Response) => {
  const { name, max_jobs_per_day, avg_job_hours, service_keys } = req.body ?? {};
  const rows = await sql`
    INSERT INTO swell_crews (tenant_id, name, max_jobs_per_day, avg_job_hours, service_keys)
    VALUES (${req.tenant!.id}, ${name}, ${max_jobs_per_day ?? 3}, ${avg_job_hours ?? 2.0}, ${service_keys ?? []})
    RETURNING *
  `;
  res.json(rows[0]);
});

// PATCH /api/schedule/crews/:id
router.patch("/api/schedule/crews/:id", async (req: Request, res: Response) => {
  const { name, max_jobs_per_day, avg_job_hours, service_keys, active } = req.body ?? {};
  const id = Number(req.params.id);
  if (name !== undefined) await sql`UPDATE swell_crews SET name = ${name} WHERE id = ${id} AND tenant_id = ${req.tenant!.id}`;
  if (max_jobs_per_day !== undefined) await sql`UPDATE swell_crews SET max_jobs_per_day = ${max_jobs_per_day} WHERE id = ${id} AND tenant_id = ${req.tenant!.id}`;
  if (avg_job_hours !== undefined) await sql`UPDATE swell_crews SET avg_job_hours = ${avg_job_hours} WHERE id = ${id} AND tenant_id = ${req.tenant!.id}`;
  if (service_keys !== undefined) await sql`UPDATE swell_crews SET service_keys = ${service_keys} WHERE id = ${id} AND tenant_id = ${req.tenant!.id}`;
  if (active !== undefined) await sql`UPDATE swell_crews SET active = ${active} WHERE id = ${id} AND tenant_id = ${req.tenant!.id}`;
  res.json({ ok: true });
});

// DELETE /api/schedule/crews/:id (soft delete)
router.delete("/api/schedule/crews/:id", async (req: Request, res: Response) => {
  await sql`UPDATE swell_crews SET active = false WHERE id = ${Number(req.params.id)} AND tenant_id = ${req.tenant!.id}`;
  res.json({ ok: true });
});

export default router;
