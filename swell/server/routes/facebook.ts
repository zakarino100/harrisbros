/**
 * Facebook lead-ad webhook (shared endpoint, multi-tenant routing).
 *
 * One single URL serves every tenant:
 *   POST https://swell.nopressurelaunch.com/api/facebook/webhook
 *
 * Tenant resolved from the lead's form_id (or page_id as fallback)
 * by looking it up in the tenants table. If no tenant matches we drop
 * the lead — better than mis-routing it to the wrong client.
 *
 * Verify token: env var FACEBOOK_WEBHOOK_VERIFY_TOKEN (single, app-level).
 */
import { Router, type Request, type Response } from "express";
import {
  findTenantByFormId,
  findTenantByPageId,
  getLeadByMetaId,
  getTenantById,
  insertLead,
  markSmsSent,
  logActivity,
  findOrCreateCustomer,
} from "../db/queries.js";
import { fetchGraphLead, parseFieldData } from "../services/facebook.js";
import { sendSms, sendNotification } from "../services/twilio.js";
import { kickoffConversationForNewLead } from "../services/conversation.js";
import { geocodeAddress } from "../services/geocoder.js";
import { notifyNewLeadDiscord } from "../services/discord.js";
import { capiLeadCreated } from "../services/meta-capi.js";
import { sql } from "../db/index.js";

const router = Router();

// Verification: GET handshake from Meta
router.get("/api/facebook/webhook", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Lead delivery: POST from Meta
router.post("/api/facebook/webhook", async (req: Request, res: Response) => {
  // Always 200 immediately so Meta doesn't retry. We handle the rest async.
  res.sendStatus(200);

  const body = (req.body ?? {}) as any;
  if (!body || body.object !== "page") return;

  for (const entry of body.entry ?? []) {
    const pageId = String(entry.id ?? "");
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;
      const value = change.value ?? {};
      const leadgenId = String(value.leadgen_id ?? "");
      if (!leadgenId) continue;

      // Idempotency
      if (await getLeadByMetaId(leadgenId)) continue;

      try {
        const formIdHint = String(value.form_id ?? "");
        const pageIdHint = pageId;

        // Resolve tenant before hitting Graph API. We need the per-tenant
        // page access token to fetch the lead, so order is:
        //   form_id → tenant → token
        //   else page_id → tenant → token
        //   else fall back to env-level token (single-client legacy mode).
        let tenant =
          (formIdHint && (await findTenantByFormId(formIdHint))) ||
          (pageIdHint && (await findTenantByPageId(pageIdHint))) ||
          undefined;

        const graphLead = await fetchGraphLead(
          leadgenId,
          tenant?.fb_page_token ?? null
        );

        // If tenant wasn't resolved by webhook envelope, try again with the
        // form_id from the Graph response — covers cases where Meta omits
        // form_id in the webhook.
        if (!tenant) {
          const formIdFromGraph = String(graphLead.form_id ?? "");
          if (formIdFromGraph) tenant = await findTenantByFormId(formIdFromGraph);
        }

        if (!tenant) {
          console.warn(
            `[fb/webhook] No tenant matched lead ${leadgenId} (form=${formIdHint || graphLead.form_id || "?"} page=${pageIdHint || graphLead.page_id || "?"}) — dropping`
          );
          continue;
        }

        const parsed = parseFieldData(graphLead.field_data ?? []);

        const leadId = await insertLead({
          tenant_id: tenant.id,
          meta_lead_id: leadgenId,
          meta_page_id: pageIdHint || (graphLead.page_id ?? null) || null,
          meta_form_id:
            String(value.form_id ?? graphLead.form_id ?? "") || null,
          meta_campaign_id:
            String(value.campaign_id ?? graphLead.campaign_id ?? "") || null,
          meta_adset_id:
            String(value.adset_id ?? graphLead.adset_id ?? "") || null,
          meta_ad_id:
            String(value.ad_id ?? graphLead.ad_id ?? "") || null,
          full_name: parsed.fullName,
          phone: parsed.phone,
          email: parsed.email,
          address: parsed.address,
          city: parsed.city,
          state: parsed.state,
          zip: parsed.zip,
          raw_payload: graphLead as Record<string, unknown>,
          status: "new",
          notes: null,
        });

        // Auto-link to customer profile
        try {
          const customerId = await findOrCreateCustomer(tenant.id, {
            phone: parsed.phone,
            email: parsed.email,
            name: parsed.fullName,
            address: parsed.address,
            city: parsed.city,
            state: parsed.state,
            zip: parsed.zip,
            source: 'facebook_ad',
          });
          await sql`UPDATE swell_leads SET customer_id = ${customerId} WHERE id = ${leadId}`;

          // Auto-geocode in background — pins appear on map immediately
          geocodeAddress(parsed.address, parsed.city, parsed.state, parsed.zip).then(async (geo) => {
            if (geo) {
              await sql`UPDATE swell_customers SET address_lat=${geo.lat}, address_lon=${geo.lon}, geocoded_at=NOW() WHERE id=${customerId}`.catch(() => {});
              await sql`UPDATE swell_leads SET address_lat=${geo.lat}, address_lon=${geo.lon} WHERE id=${leadId}`.catch(() => {});
            }
          }).catch(() => {});
        } catch (e: any) {
          console.error("[facebook] customer link failed:", e?.message);
        }

        // Assign A/B variant for nurture sequence (50/50 split A vs B)
        try {
          const variant = Math.random() < 0.5 ? 'A' : 'B';
          await sql`
            INSERT INTO swell_ab_variants (tenant_id, lead_id, variant_group, variant)
            VALUES (${tenant.id}, ${leadId}, 'nurture_sequence', ${variant})
            ON CONFLICT DO NOTHING
          `;
        } catch (e: any) {
          console.error("[facebook] A/B variant assignment failed:", e?.message);
        }

        await logActivity({
          lead_id: leadId,
          tenant_id: tenant.id,
          type: "lead_received",
          direction: "inbound",
          body: `Facebook lead: ${parsed.fullName || "Unknown"}${parsed.phone ? ` · ${parsed.phone}` : ""}`,
          metadata: {
            source: "facebook_lead_ad",
            formId: graphLead.form_id ?? null,
            adId: graphLead.ad_id ?? null,
          },
        });

        // CAPI: fire Lead event back to Meta for conversion optimization
        capiLeadCreated({
          tenantId: tenant.id,
          tenant,
          leadId,
          phone: parsed.phone,
          email: parsed.email,
          formId: String(graphLead.form_id ?? "") || null,
        }).catch(e => console.error("[capi] lead_received failed:", e?.message));

        // SMS alert to tenant contact_phone
        if (tenant.contact_phone) {
          try {
            const smsBody = [
              `🔔 New ${tenant.name} lead`,
              `Name: ${parsed.fullName || "Unknown"}`,
              `Phone: ${parsed.phone || "—"}`,
              `Email: ${parsed.email || "—"}`,
              `Time: ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`,
            ].join("\n");
            await sendNotification(tenant.contact_phone, smsBody, tenant.twilio_from, tenant.name);
            await markSmsSent(leadId);
            await logActivity({
              lead_id: leadId,
              tenant_id: tenant.id,
              type: "sms_alert_sent",
              direction: "outbound",
              body: `SMS alert sent to ${tenant.contact_phone}`,
              metadata: { to: tenant.contact_phone },
            });
          } catch (smsErr: any) {
            console.error("[fb/webhook] SMS alert failed:", smsErr);
            await logActivity({
              lead_id: leadId,
              tenant_id: tenant.id,
              type: "sms_alert_failed",
              direction: "outbound",
              body: `SMS alert failed: ${smsErr?.message ?? smsErr}`,
              metadata: { error: String(smsErr?.message ?? smsErr) },
            });
          }
        }

        // Discord notification — Hayden posts to leads channel
        try {
          const lead = await getLeadByMetaId(leadgenId);
          if (lead) {
            const rawParsed = parseFieldData(graphLead.field_data ?? []);
            const threadId = await notifyNewLeadDiscord(tenant.id, tenant.name, {
              leadId: lead.id,
              name: lead.full_name,
              phone: lead.phone,
              email: lead.email,
              timeline: rawParsed.timeline || null,
              homeSize: rawParsed.squareFootage || null,
            });
            if (threadId) {
              await logActivity({ lead_id: lead.id, tenant_id: tenant.id, type: "discord_thread_created",
                direction: "internal", body: `Discord thread: ${threadId}`, metadata: { threadId } });
            }
          }
        } catch (dcErr: any) {
          console.error("[fb/webhook] Discord notify error:", dcErr);
        }

        // AI conversation kickoff — Hayden takes over
        try {
          const lead = await getLeadByMetaId(leadgenId);
          if (lead) {
            const r = await kickoffConversationForNewLead(tenant, lead);
            await logActivity({
              lead_id: lead.id,
              tenant_id: tenant.id,
              type: r.ok ? "ai_conversation_started" : "ai_conversation_skipped",
              direction: "internal",
              body: r.ok
                ? `Hayden sent the opening message to ${lead.full_name || lead.phone}.`
                : `AI kickoff skipped: ${r.reason ?? "unknown"}`,
              metadata: r as any,
            });
          }
        } catch (aiErr: any) {
          console.error("[fb/webhook] AI kickoff error:", aiErr);
          const lead = await getLeadByMetaId(leadgenId);
          if (lead) {
            await logActivity({
              lead_id: lead.id,
              tenant_id: tenant.id,
              type: "ai_conversation_error",
              direction: "internal",
              body: `AI kickoff threw: ${aiErr?.message ?? aiErr}`,
              metadata: { error: String(aiErr?.message ?? aiErr) },
            });
          }
        }
      } catch (error) {
        console.error("[fb/webhook] processing error:", error);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/backfill
//
// Pull all historical leads from Meta Graph API for a tenant's form IDs
// and insert any that aren't already in the DB. Idempotent.
//
// Auth: requires ?secret=SWELL_COOKIE_SECRET in query string
// Body: { tenantId: string }
// ---------------------------------------------------------------------------
router.post("/api/admin/backfill", async (req: Request, res: Response) => {
  const secret = req.query.secret || req.body?.secret;
  if (secret !== process.env.SWELL_COOKIE_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { tenantId } = req.body ?? {};
  const tenant = await getTenantById(tenantId);
  if (!tenant) return res.status(404).json({ error: `Tenant '${tenantId}' not found` });

  const formIds: string[] = tenant.fb_form_ids ? tenant.fb_form_ids : [];
  if (!formIds.length) return res.status(400).json({ error: "No FB form IDs configured for tenant" });

  const GRAPH_BASE = "https://graph.facebook.com/v25.0";
  const token = tenant.fb_page_token ?? process.env.FACEBOOK_PAGE_ACCESS_TOKEN ?? "";
  if (!token) return res.status(500).json({ error: "No FB page token for tenant" });

  let inserted = 0, skipped = 0, errors = 0;
  const results: any[] = [];

  for (const formId of formIds) {
    const fields = "id,created_time,field_data,ad_id,adset_id,campaign_id,ad_name,adset_name,campaign_name,form_id";
    let nextUrl: string | null = `${GRAPH_BASE}/${formId}/leads?fields=${fields}&limit=100&access_token=${token}`;
    let pageNum = 0;

    while (nextUrl) {
      const page = await fetch(nextUrl).then(r => r.json()) as any;
      if (page.error) {
        console.error(`[backfill] Graph error for form ${formId}:`, page.error);
        errors++;
        break;
      }
      pageNum++;
      console.log(`[backfill] form=${formId} page=${pageNum} leads=${page.data?.length ?? 0}`);

      for (const graphLead of page.data ?? []) {
        const leadgenId = String(graphLead.id ?? "");
        if (!leadgenId) { errors++; continue; }

        if (await getLeadByMetaId(leadgenId)) { skipped++; results.push({ metaLeadId: leadgenId, action: "skipped" }); continue; }

        try {
          const parsed = parseFieldData(graphLead.field_data ?? []);
          const createdAt = graphLead.created_time ?? new Date().toISOString();
          const leadId = await insertLead({
            tenant_id: tenant.id,
            meta_lead_id: leadgenId,
            meta_page_id: null,
            meta_form_id: formId,
            meta_campaign_id: graphLead.campaign_id ?? null,
            meta_adset_id: graphLead.adset_id ?? null,
            meta_ad_id: graphLead.ad_id ?? null,
            full_name: parsed.fullName,
            phone: parsed.phone,
            email: parsed.email,
            address: parsed.address,
            city: parsed.city,
            state: parsed.state,
            zip: parsed.zip,
            raw_payload: ({ ...graphLead, created_time: createdAt }) as Record<string, unknown>,
            status: "new",
            notes: null,
          });
          await logActivity({ lead_id: leadId, tenant_id: tenant.id, type: "lead_received", direction: "inbound",
            body: `Backfill: ${parsed.fullName || "Unknown"}${parsed.phone ? ` · ${parsed.phone}` : ""}`,
            metadata: { source: "backfill", formId } });
          inserted++;
          results.push({ metaLeadId: leadgenId, action: "inserted", name: parsed.fullName });

          // Fire the same post-creation flow as the live webhook
          const newLead = await getLeadByMetaId(leadgenId);
          if (newLead) {
            // Owner SMS alert
            if (tenant.contact_phone) {
              const smsBody = [
                `🔔 New ${tenant.name} lead`,
                `Name: ${newLead.full_name || "Unknown"}`,
                `Phone: ${newLead.phone || "—"}`,
                `Email: ${newLead.email || "—"}`,
              ].join("\n");
              sendNotification(tenant.contact_phone, smsBody, tenant.twilio_from, tenant.name)
                .then(() => markSmsSent(leadId))
                .catch(e => console.error("[backfill] owner SMS failed:", e?.message));
            }
            // Discord thread
            notifyNewLeadDiscord(tenant.id, tenant.name, {
              leadId: newLead.id, name: newLead.full_name, phone: newLead.phone, email: newLead.email,
            }).catch(e => console.error("[backfill] discord notify failed:", e?.message));
            // Hayden opening message (60s delay to feel human)
            setTimeout(() => {
              kickoffConversationForNewLead(tenant, newLead)
                .then(r => logActivity({ lead_id: newLead.id, tenant_id: tenant.id,
                  type: r.ok ? "ai_conversation_started" : "ai_conversation_skipped",
                  direction: "internal", body: r.ok ? `Hayden sent opening to ${newLead.full_name || newLead.phone}` : `AI skipped: ${r.reason}`,
                  metadata: r as any }))
                .catch(e => console.error("[backfill] AI kickoff failed:", e?.message));
            }, 60_000);
          }
        } catch (err: any) {
          errors++;
          results.push({ metaLeadId: leadgenId, action: "error", error: err?.message });
        }
      }

      nextUrl = page.paging?.next ?? null;
    }
  }

  console.log(`[backfill] tenant=${tenantId} inserted=${inserted} skipped=${skipped} errors=${errors}`);
  return res.json({ tenant: tenantId, inserted, skipped, errors, results });
});

export default router;
