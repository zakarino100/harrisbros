/**
 * Super admin routes for managing all tenants
 * Protected by requireSuperAdmin middleware
 */
import { Router, type Request, type Response } from "express";
import { requireSuperAdmin } from "../middleware/tenant.js";
import { listTenants, getTenantById, upsertTenant, type Tenant } from "../db/queries.js";
import { sql } from "../db/index.js";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const router = Router();
router.use(requireSuperAdmin);

// GET /admin/api/tenants - list all tenants with stats
router.get("/admin/api/tenants", async (req: Request, res: Response) => {
  try {
    const tenants = await listTenants();
    
    // Enrich with stats
    const enriched = await Promise.all(
      tenants.map(async (t) => {
        try {
          const [leadRow, apptRow, revRow] = await Promise.all([
            sql`SELECT COUNT(*) as count FROM swell_leads WHERE tenant_id = ${t.id}`,
            sql`SELECT COUNT(*) as count FROM swell_appointments WHERE tenant_id = ${t.id} AND status = 'completed'`,
            sql`SELECT SUM(quoted_price_cents) as total FROM swell_appointments WHERE tenant_id = ${t.id} AND status = 'completed'`,
          ]);
          
          const leadCount = parseInt(leadRow[0]?.count ?? "0", 10);
          const apptCount = parseInt(apptRow[0]?.count ?? "0", 10);
          const revenue = (revRow[0]?.total ?? 0) / 100;
          
          return {
            ...t,
            leadCount,
            appointmentCount: apptCount,
            revenue,
          };
        } catch (e) {
          return { ...t, leadCount: 0, appointmentCount: 0, revenue: 0 };
        }
      })
    );
    
    res.json(enriched);
  } catch (err: any) {
    console.error("[admin] list tenants failed:", err?.message);
    res.status(500).json({ error: err?.message || "Failed to list tenants" });
  }
});

// POST /admin/api/tenants - create new tenant
router.post("/admin/api/tenants", async (req: Request, res: Response) => {
  try {
    const { name, slug, password, brandColor, accentColor, logoUrl, contactPhone, twilioFrom, fbPageId, fbFormId } = req.body;
    
    if (!name || !slug || !password) {
      return res.status(400).json({ error: "name, slug, and password required" });
    }
    
    // Hash password
    const hash = await bcrypt.hash(password, 10);
    const id = randomUUID();
    
    await upsertTenant({
      id,
      name,
      slug: slug.toLowerCase(),
      password_hash: hash,
      brand_color: brandColor || "#fbbf24",
      accent_color: accentColor || "#fde68a",
      logo_url: logoUrl || null,
      contact_phone: contactPhone || null,
      twilio_from: twilioFrom || null,
      fb_page_ids: fbPageId ? [fbPageId] : null,
      fb_form_ids: fbFormId ? [fbFormId] : null,
      enabled: true,
    });
    
    const tenant = await getTenantById(id);
    res.json(tenant);
  } catch (err: any) {
    console.error("[admin] create tenant failed:", err?.message);
    res.status(500).json({ error: err?.message || "Failed to create tenant" });
  }
});

// PATCH /admin/api/tenants/:id - update tenant config
router.patch("/admin/api/tenants/:id", async (req: Request, res: Response) => {
  try {
    const tenantId = String(req.params.id);
    const { name, slug, brandColor, accentColor, logoUrl, contactPhone, twilioFrom, fbPageId, fbFormId, enabled, password } = req.body;
    
    const existing = await getTenantById(tenantId);
    if (!existing) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (slug !== undefined) updates.slug = slug.toLowerCase();
    if (brandColor !== undefined) updates.brand_color = brandColor;
    if (accentColor !== undefined) updates.accent_color = accentColor;
    if (logoUrl !== undefined) updates.logo_url = logoUrl;
    if (contactPhone !== undefined) updates.contact_phone = contactPhone;
    if (twilioFrom !== undefined) updates.twilio_from = twilioFrom;
    if (fbPageId !== undefined) updates.fb_page_ids = fbPageId ? [fbPageId] : null;
    if (fbFormId !== undefined) updates.fb_form_ids = fbFormId ? [fbFormId] : null;
    if (enabled !== undefined) updates.enabled = enabled;
    if (password !== undefined) updates.password_hash = await bcrypt.hash(password, 10);
    
    await upsertTenant({ id: tenantId, ...updates });
    
    const updated = await getTenantById(tenantId);
    res.json(updated);
  } catch (err: any) {
    console.error("[admin] patch tenant failed:", err?.message);
    res.status(500).json({ error: err?.message || "Failed to update tenant" });
  }
});

// GET /admin/api/tenants/:id/stats - tenant stats
router.get("/admin/api/tenants/:id/stats", async (req: Request, res: Response) => {
  try {
    const tenantId = String(req.params.id);
    
    const [leadRow, apptRow, revRow, convRow] = await Promise.all([
      sql`SELECT COUNT(*) as count FROM swell_leads WHERE tenant_id = ${tenantId}`,
      sql`SELECT COUNT(*) as count FROM swell_appointments WHERE tenant_id = ${tenantId}`,
      sql`SELECT SUM(quoted_price_cents) as total FROM swell_appointments WHERE tenant_id = ${tenantId} AND status = 'completed'`,
      sql`SELECT COUNT(*) as count FROM swell_conversations WHERE tenant_id = ${tenantId}`,
    ]);
    
    res.json({
      leadCount: parseInt(leadRow[0]?.count ?? "0", 10),
      appointmentCount: parseInt(apptRow[0]?.count ?? "0", 10),
      revenue: ((revRow[0]?.total ?? 0) / 100).toFixed(2),
      conversationCount: parseInt(convRow[0]?.count ?? "0", 10),
    });
  } catch (err: any) {
    console.error("[admin] get stats failed:", err?.message);
    res.status(500).json({ error: err?.message || "Failed to get stats" });
  }
});

export default router;
