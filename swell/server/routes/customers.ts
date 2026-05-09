import { Router, type Request, type Response } from "express";
import { requireTenant } from "../middleware/tenant.js";
import { requireAuth } from "../middleware/auth.js";
import { listCustomers, getCustomer, updateCustomer, getCustomerActivity } from "../db/queries.js";
import { sql } from "../db/index.js";
import { geocodeAddress } from "../services/geocoder.js";

const router = Router();
router.use(requireTenant, requireAuth);

// GET /api/customers — list all customers
router.get("/api/customers", async (req, res) => {
  try {
    const customers = await listCustomers(req.tenant!.id, 500);
    res.json(customers);
  } catch (err) {
    console.error("[customers list]", err);
    res.status(500).json({ error: "Failed to list customers" });
  }
});

// GET /api/customers/:id — customer profile with full activity
router.get("/api/customers/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const customer = await getCustomer(req.tenant!.id, id);
    if (!customer) return res.status(404).json({ error: "Not found" });
    const activity = await getCustomerActivity(req.tenant!.id, id);
    res.json({ ...customer, ...activity });
  } catch (err) {
    console.error("[customers get]", err);
    res.status(500).json({ error: "Failed to fetch customer" });
  }
});

// PATCH /api/customers/:id — update customer
router.patch("/api/customers/:id", async (req, res) => {
  try {
    await updateCustomer(Number(req.params.id), req.tenant!.id, req.body);
    res.json({ ok: true });
  } catch (err) {
    console.error("[customers patch]", err);
    res.status(500).json({ error: "Failed to update customer" });
  }
});

// GET /api/customers/:id/timeline — all activity in chronological order
router.get("/api/customers/:id/timeline", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const tenantId = req.tenant!.id;
    
    const [activity, calls, messages] = await Promise.all([
      sql`
        SELECT a.*, l.full_name FROM swell_lead_activity a
        JOIN swell_leads l ON l.id = a.lead_id
        WHERE l.customer_id = ${id} AND a.tenant_id = ${tenantId}
        ORDER BY a.created_at DESC LIMIT 100
      `,
      sql`SELECT * FROM swell_calls WHERE customer_id = ${id} AND tenant_id = ${tenantId} ORDER BY created_at DESC LIMIT 20`,
      sql`
        SELECT m.*, c.id as conv_id FROM swell_conversation_messages m
        JOIN swell_conversations c ON c.id = m.conversation_id
        JOIN swell_leads l ON l.id = c.lead_id
        WHERE l.customer_id = ${id} AND c.tenant_id = ${tenantId}
        ORDER BY m.created_at DESC LIMIT 100
      `,
    ]);

    // Merge and sort all events
    const timeline = [
      ...(activity as any[]).map(a => ({ ...a, _type: 'activity' })),
      ...(calls as any[]).map(c => ({ ...c, _type: 'call', created_at: c.created_at })),
      ...(messages as any[]).map(m => ({ ...m, _type: 'message', created_at: m.created_at })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    res.json(timeline);
  } catch (err) {
    console.error("[customers timeline]", err);
    res.status(500).json({ error: "Failed to fetch timeline" });
  }
});

// GET /api/map/pins — all geocoded customers + leads for the map
router.get("/api/map/pins", async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;

  try {
    // Get customers with addresses
    const customers = await sql`
      SELECT 
        c.id, c.full_name, c.phone, c.email, c.address, c.city, c.state, c.zip,
        c.address_lat as lat, c.address_lon as lon,
        c.lead_score, c.repeat_probability, c.lifetime_value_cents, c.job_count,
        c.tags, c.geocoded_at,
        COUNT(l.id)::int as lead_count,
        MAX(a.scheduled_date) as last_job_date,
        (SELECT status FROM swell_appointments WHERE lead_id IN 
          (SELECT id FROM swell_leads WHERE customer_id = c.id) 
         ORDER BY created_at DESC LIMIT 1) as last_appt_status
      FROM swell_customers c
      LEFT JOIN swell_leads l ON l.customer_id = c.id
      LEFT JOIN swell_appointments a ON a.lead_id = l.id AND a.status = 'completed'
      WHERE c.tenant_id = ${tenantId}
        AND (c.address IS NOT NULL OR c.city IS NOT NULL)
      GROUP BY c.id
      ORDER BY c.updated_at DESC
      LIMIT 500
    `;

    // Also get leads not yet linked to customers
    const standaloneLeads = await sql`
      SELECT 
        l.id, l.full_name, l.phone, l.email, l.address, l.city, l.state, l.zip,
        l.address_lat as lat, l.address_lon as lon,
        l.lead_score, l.repeat_probability, l.status
      FROM swell_leads l
      WHERE l.tenant_id = ${tenantId}
        AND l.customer_id IS NULL
        AND l.status NOT IN ('test','archived')
        AND (l.address IS NOT NULL OR l.city IS NOT NULL)
      LIMIT 200
    `;

    res.json({
      customers: customers,
      leads: standaloneLeads,
    });
  } catch (err) {
    console.error("[map/pins]", err);
    res.status(500).json({ error: "Failed to fetch map pins" });
  }
});

// POST /api/map/geocode — trigger geocoding for customers missing coordinates
router.post("/api/map/geocode", async (req: Request, res: Response) => {
  const tenantId = req.tenant!.id;
  res.json({ ok: true, message: "Geocoding started in background" });

  // Run async after response
  (async () => {
    const toGeocode = await sql`
      SELECT id, address, city, state, zip FROM swell_customers
      WHERE tenant_id = ${tenantId}
        AND geocoded_at IS NULL
        AND (address IS NOT NULL OR city IS NOT NULL)
      LIMIT 50
    `;

    for (const c of toGeocode as any[]) {
      const result = await geocodeAddress(c.address, c.city, c.state, c.zip);
      if (result) {
        await sql`
          UPDATE swell_customers 
          SET address_lat = ${result.lat}, address_lon = ${result.lon}, geocoded_at = NOW()
          WHERE id = ${c.id}
        `;
      }
      await new Promise(r => setTimeout(r, 1100)); // Nominatim rate limit: 1/sec
    }
  })().catch(e => console.error("[geocode]", e));
});

export default router;
