/**
 * Swell — multi-tenant lead command center
 *
 * One Express app, one Replit deploy, one SQLite DB.
 * Tenant resolved per-request from req.hostname (e.g. mackwash.nopressurelaunch.com).
 *
 * Required env vars:
 *   FACEBOOK_WEBHOOK_VERIFY_TOKEN   ← single, app-level
 *   FACEBOOK_PAGE_ACCESS_TOKEN      ← optional fallback (per-tenant token preferred)
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_PHONE_NUMBER             ← global default; tenants may override
 *   SWELL_COOKIE_SECRET             ← MUST set in prod (random 32+ char string)
 *   SWELL_APEX_DOMAIN               ← defaults to nopressurelaunch.com
 */
// Force .env to override Replit Secrets (dotenv/config doesn't override existing env vars)
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ override: true });
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import url from "node:url";

import { tenantMiddleware } from "./middleware/tenant.js";
import authRouter from "./routes/auth.js";
import leadsRouter from "./routes/leads.js";
import facebookRouter from "./routes/facebook.js";
import twilioRouter from "./routes/twilio.js";
import vapiRouter from "./routes/vapi.js";
import callsRouter from "./routes/calls.js";
import calendarRouter from "./routes/calendar.js";
import scheduleRouter from "./routes/schedule.js";
import testRouter from "./routes/test.js";
import feedbackRouter from "./routes/feedback.js";
import settingsRouter from "./routes/settings.js";
import reviewsRouter from "./routes/reviews.js";
import statsRouter from "./routes/stats.js";
import analyticsRouter from "./routes/analytics.js";
import messagesRouter from "./routes/messages.js";
import usersRouter from "./routes/users.js";
import customersRouter from "./routes/customers.js";
import adminRouter from "./routes/admin.js";
import { runSeed } from "./seed.js";
import { startNurtureLoop } from "./services/nurture-loop.js";
import { startLeadSyncLoop } from "./services/lead-sync.js";
import { startDiscordGateway } from "./services/discord-gateway.js";
import { fireEodCheck, shouldFireEodCheck } from "./services/owner-eod.js";
import { fireAppointmentReminders } from "./services/appointment-reminders.js";
import { maybeFireCallReport } from "./services/call-reporter.js";
import { fireMorningReviewFollowups, sendNoResponseNudges } from "./services/review-followup.js";
import { listTenants } from "./db/queries.js";
import { notifyNewLeadDiscord } from "./services/discord.js";
import { sql } from "./db/index.js";
import "./db/index.js"; // ensure schema applied

const app = express();
const port = Number(process.env.PORT || 3000);

app.set("trust proxy", true); // Replit sits behind a proxy

app.use(cors({ credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ─── Health (no tenant required) ───────────────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({ ok: true, app: "swell" }));

// ─── Tenant resolution runs first for everything else ──────────────────────────
app.use(tenantMiddleware);

// ─── Webhooks (public — verify_token gates writes) ─────────────────────────────
app.use(facebookRouter);
app.use(twilioRouter);
app.use(vapiRouter); // VAPI webhook — before tenant middleware

// ─── Public forms (no auth required) ───────────────────────────────────────────
app.use(feedbackRouter);

// ─── Static assets (no auth required — must come before requireAuth routes) ───
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../client");
app.use(express.static(clientDist));

// ─── Auth (login/logout) ───────────────────────────────────────────────────────
app.use(authRouter);

// ─── Super Admin APIs (require admin secret) ─────────────────────────────────────
app.use(adminRouter);

// ─── Tenant-scoped APIs (require auth) ─────────────────────────────────────────
app.use(leadsRouter);
app.use(messagesRouter);
app.use(calendarRouter);
app.use(callsRouter);
app.use(scheduleRouter);
app.use(testRouter);
app.use(settingsRouter);
app.use(reviewsRouter);
app.use(statsRouter);
app.use(analyticsRouter);
app.use(usersRouter);
app.use(customersRouter);

// SPA fallback for non-API routes (Express 5 needs named wildcard)
app.get(/^\/(?!api\/).*/, (req, res) => {
  // If no tenant + no slug → show landing
  if (!req.tenant) {
    return res.send(landingHtml());
  }
  const indexPath = path.join(clientDist, "index.html");
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(404).send("Build not found — run `npm run build`");
    }
  });
});

// ─── Seed tenants on first boot ────────────────────────────────────────────────
runSeed()
  .then(() => {
    startNurtureLoop();
    startLeadSyncLoop();
  })
  .catch((err) => {
    console.error("[seed]", err);
    startNurtureLoop();
    startLeadSyncLoop();
  });

// ─── Phase 2: EOD check loop ──────────────────────────────────────────────────────
setInterval(async () => {
  try {
    const tenants = await listTenants();
    for (const tenant of tenants) {
      if (await shouldFireEodCheck(tenant)) {
        await fireEodCheck(tenant);
      }
    }
  } catch (e) {
    console.error("[eod-loop]", e);
  }
}, 60_000);

// ─── Phase 2: Morning review follow-up loop ───────────────────────────────────────
let lastReviewFollowupDate = "";
setInterval(async () => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== lastReviewFollowupDate) {
      const hour = new Date().getHours();
      if (hour >= 9 && hour < 10) {
        // Fire between 9-10am
        await fireMorningReviewFollowups();
        await sendNoResponseNudges();
        lastReviewFollowupDate = today;
      }
    }
  } catch (e) {
    console.error("[review-loop]", e);
  }
}, 60 * 60 * 1000);

// Call report loop — runs every hour, fires report every 48h between 9–11am
setInterval(async () => {
  try { await maybeFireCallReport(); } catch (e) { console.error("[report-loop]", e); }
}, 60 * 60 * 1000);

// Appointment reminder loop — runs every 15 minutes, fires between 5-7pm in tenant timezone
setInterval(async () => {
  try {
    await fireAppointmentReminders();
  } catch (e) { console.error("[reminder-loop]", e); }
}, 15 * 60 * 1000);

app.listen(port, "0.0.0.0", () => {
  console.log(`🌊  Swell running on :${port}`);
  startDiscordGateway();
  // Catch-up: fire Discord notifications for any leads that missed them
  // (happens when server was down during lead arrival or token was wrong)
  setTimeout(catchUpMissingDiscordNotifications, 8_000);
});

async function catchUpMissingDiscordNotifications(): Promise<void> {
  try {
    const tenants = await listTenants();
    for (const tenant of tenants) {
      if (!tenant.enabled) continue; // skip disabled tenants
      const missed = await sql<Array<{id: number; full_name: string|null; phone: string|null; email: string|null}>>`
        SELECT id, full_name, phone, email
        FROM swell_leads
        WHERE tenant_id = ${tenant.id}
          AND discord_thread_id IS NULL
          AND status NOT IN ('archived','test')
          AND created_at > NOW() - INTERVAL '24 hours'
        ORDER BY created_at ASC
        LIMIT 50
      `;
      if (!missed.length) continue;
      console.log(`[startup] Catching up ${missed.length} missed Discord notification(s) for ${tenant.id}`);
      for (const lead of missed) {
        try {
          const threadId = await notifyNewLeadDiscord(tenant.id, tenant.name ?? tenant.id, {
            leadId: lead.id, name: lead.full_name, phone: lead.phone, email: lead.email,
          });
          if (threadId) {
            await sql`UPDATE swell_leads SET discord_thread_id = ${threadId} WHERE id = ${lead.id}`;
            console.log(`[startup] Discord catch-up: lead ${lead.id} (${lead.full_name}) → thread ${threadId}`);
          }
        } catch (e: any) {
          console.error(`[startup] Discord catch-up failed for lead ${lead.id}:`, e?.message);
        }
        await new Promise(r => setTimeout(r, 500)); // rate limit
      }
    }
  } catch (e: any) {
    console.error("[startup] Discord catch-up error:", e?.message);
  }
}

function landingHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Swell — Blue Ocean</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>html{background:#0a0a0a;color:#fff;font-family:system-ui;height:100%}body{display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;text-align:center;padding:24px}
  h1{color:#fbbf24;font-size:42px;letter-spacing:.02em;margin:0 0 8px}p{color:#9ca3af;font-size:14px;margin:0}small{color:#4b5563;display:block;margin-top:24px;font-size:12px}</style></head>
  <body><div><h1>🌊 Swell</h1><p>Lead Command, by Blue Ocean</p><small>Visit your client subdomain to log in.</small></div></body></html>`;
}
