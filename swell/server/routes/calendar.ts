/**
 * Google Calendar routes
 * All require auth except the OAuth callback
 */
import { Router, type Request, type Response } from "express";
import { requireTenant } from "../middleware/tenant.js";
import { requireAuth } from "../middleware/auth.js";
import * as calendar from "../services/calendar.js";

const router = Router();

// ─── Public (OAuth callback) ──────────────────────────────────────────────────

router.get("/api/calendar/oauth/callback", requireTenant, async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string;
    const state = req.query.state as string;

    if (!code) {
      return res.status(400).json({ error: "Missing authorization code" });
    }

    const result = await calendar.handleCallback(code, state || req.tenant!.id);

    if (!result.success) {
      return res.redirect(`/settings?calendar=error&msg=${encodeURIComponent(result.error || "Unknown error")}`);
    }

    return res.redirect("/settings?calendar=connected");
  } catch (err) {
    console.error("[calendar] OAuth callback error:", err);
    return res.redirect("/settings?calendar=error&msg=server_error");
  }
});

// ─── Protected routes ─────────────────────────────────────────────────────────

router.use(requireTenant, requireAuth);

router.get("/api/calendar/auth-url", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const url = calendar.generateAuthUrl(tenantId);
    res.json({ authUrl: url });
  } catch (err) {
    console.error("[calendar] GET auth-url error:", err);
    res.status(500).json({ error: "Failed to generate auth URL" });
  }
});

router.get("/api/calendar/status", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const status = await calendar.getCalendarStatus(tenantId);
    res.json(status);
  } catch (err) {
    console.error("[calendar] GET status error:", err);
    res.status(500).json({ error: "Failed to fetch calendar status" });
  }
});

router.get("/api/calendar/calendars", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const calendars = await calendar.listCalendars(tenantId);
    res.json({ calendars });
  } catch (err) {
    console.error("[calendar] GET calendars error:", err);
    res.status(500).json({ error: "Failed to fetch calendars" });
  }
});

router.post("/api/calendar/select", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const { calendarId, calendarName } = req.body ?? {};

    if (!calendarId || !calendarName) {
      return res.status(400).json({ error: "calendarId and calendarName required" });
    }

    await calendar.selectCalendar(tenantId, calendarId, calendarName);
    res.json({ ok: true });
  } catch (err) {
    console.error("[calendar] POST select error:", err);
    res.status(500).json({ error: "Failed to select calendar" });
  }
});

router.get("/api/calendar/availability", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const daysAhead = Number(req.query.daysAhead) || 14;
    const availability = await calendar.getAvailability(tenantId, daysAhead);
    res.json({ availability });
  } catch (err) {
    console.error("[calendar] GET availability error:", err);
    res.status(500).json({ error: "Failed to fetch availability" });
  }
});

router.get("/api/calendar/blocked", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const blocked = await calendar.getBlockedDatesList(tenantId);
    res.json({ blocked });
  } catch (err) {
    console.error("[calendar] GET blocked error:", err);
    res.status(500).json({ error: "Failed to fetch blocked dates" });
  }
});

router.post("/api/calendar/blocked", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const { date, reason } = req.body ?? {};

    if (!date) {
      return res.status(400).json({ error: "date required" });
    }

    await calendar.addBlockedDateToCalendar(tenantId, date, reason);
    res.json({ ok: true });
  } catch (err) {
    console.error("[calendar] POST blocked error:", err);
    res.status(500).json({ error: "Failed to add blocked date" });
  }
});

router.delete("/api/calendar/blocked/:date", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const date = req.params.date;

    if (!date) {
      return res.status(400).json({ error: "date required" });
    }

    await calendar.removeBlockedDateFromCalendar(tenantId, date);
    res.json({ ok: true });
  } catch (err) {
    console.error("[calendar] DELETE blocked error:", err);
    res.status(500).json({ error: "Failed to remove blocked date" });
  }
});

export default router;
