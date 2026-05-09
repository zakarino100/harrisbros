import { Router, type Request, type Response } from "express";
import { requireTenant } from "../middleware/tenant.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { updateTenantOwner, createPhoneVerification, verifyPhoneCode, getAIConfig, upsertAIConfig } from "../db/queries.js";
import { sendSms } from "../services/twilio.js";

const router = Router();
router.use(requireTenant, requireAuth);

// GET /api/settings — returns all tenant settings visible to the owner
router.get("/api/settings", async (req: Request, res: Response) => {
  const t = (req as any).tenant!;
  res.json({
    owner_name: (t as any).owner_name ?? null,
    owner_phone: (t as any).owner_phone ?? null,
    owner_phone_verified: (t as any).owner_phone_verified ?? false,
    google_review_url: (t as any).google_review_url ?? null,
    eod_offset_hours: (t as any).eod_offset_hours ?? 1.0,
    contact_phone: t.contact_phone,
  });
});

// PATCH /api/settings — update non-sensitive fields (admin only)
router.patch("/api/settings", requireRole("admin"), async (req: Request, res: Response) => {
  const { owner_name, google_review_url, eod_offset_hours } = req.body ?? {};
  const tenantId = (req as any).tenant!.id;
  await updateTenantOwner(tenantId, {
    ...(owner_name !== undefined && { owner_name }),
    ...(google_review_url !== undefined && { google_review_url }),
    ...(eod_offset_hours !== undefined && { eod_offset_hours }),
  });
  res.json({ ok: true });
});

// POST /api/settings/phone-verify/request — send code to new phone (admin only)
router.post("/api/settings/phone-verify/request", requireRole("admin"), async (req: Request, res: Response) => {
  const { phone } = req.body ?? {};
  if (!phone) return res.status(400).json({ error: "phone required" });

  const tenantId = (req as any).tenant!.id;
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await createPhoneVerification(tenantId, phone, code);

  try {
    const tenant = (req as any).tenant;
    await sendSms(
      phone,
      `Your Swell verification code is: ${code}. Expires in 10 minutes.`,
      tenant.twilio_from
    );
    // Store the pending phone
    await updateTenantOwner(tenantId, { owner_phone_pending: phone });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "SMS send failed" });
  }
});

// POST /api/settings/phone-verify/confirm — verify code and set phone (admin only)
router.post("/api/settings/phone-verify/confirm", requireRole("admin"), async (req: Request, res: Response) => {
  const { code } = req.body ?? {};
  if (!code) return res.status(400).json({ error: "code required" });

  const tenant = (req as any).tenant;
  const pending = (tenant as any).owner_phone_pending;
  if (!pending) return res.status(400).json({ error: "No pending phone verification" });

  const valid = await verifyPhoneCode(tenant.id, pending, code);
  if (!valid) return res.status(400).json({ error: "Invalid or expired code" });

  await updateTenantOwner(tenant.id, {
    owner_phone: pending,
    owner_phone_verified: true,
    owner_phone_pending: null,
  });
  res.json({ ok: true });
});

// GET /api/settings/ai — returns full AI config for this tenant
router.get("/api/settings/ai", async (req: Request, res: Response) => {
  const tenantId = (req as any).tenant!.id;
  const cfg = await getAIConfig(tenantId);
  res.json(cfg ?? null);
});

// PUT /api/settings/ai — full AI config update (admin only)
router.put("/api/settings/ai", requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).tenant!.id;
    await upsertAIConfig({ tenant_id: tenantId, ...req.body });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Failed to save AI config" });
  }
});

export default router;
