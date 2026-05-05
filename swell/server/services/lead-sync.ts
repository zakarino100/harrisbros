/**
 * Lead sync loop — pulls new FB leads for all enabled tenants every hour.
 *
 * Runs a backfill against the Meta Graph API for each tenant's configured
 * form IDs. Idempotent (skips leads already in the DB). Fires owner SMS,
 * Discord thread, and Hayden opening message for any newly inserted leads.
 *
 * First tick fires 30 seconds after server start (warm-up), then every hour.
 */

import { sql } from "../db/index.js";
import { getTenantById } from "../db/queries.js";
import {
  insertLead,
  getLeadByMetaId,
  markSmsSent,
  logActivity,
} from "../db/queries.js";
import { parseFieldData } from "./facebook.js";
import { sendNotification } from "./twilio.js";
import { notifyNewLeadDiscord } from "./discord.js";
import { kickoffConversationForNewLead } from "./conversation.js";
import { capiLeadCreated } from "./meta-capi.js";
import { geocodeAddress } from "./geocoder.js";

const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const GRAPH_BASE = "https://graph.facebook.com/v25.0";

let running = false;

export function startLeadSyncLoop() {
  if (running) return;
  running = true;

  // First tick after 30s (let server fully warm up)
  setTimeout(() => tick().catch(console.error), 30_000);

  // Then every hour on the hour
  setInterval(() => tick().catch(console.error), TICK_INTERVAL_MS);

  console.log("[lead-sync] hourly sync loop started");
}

async function tick() {
  // Get all enabled tenants with FB form IDs configured
  const tenants = await sql<Array<{
    id: string;
    name: string;
    fb_form_ids: string[];
    fb_page_token: string | null;
    contact_phone: string | null;
    twilio_from: string | null;
  }>>`
    SELECT id, name, fb_form_ids, fb_page_token, contact_phone, twilio_from
    FROM swell_tenants
    WHERE enabled = true
      AND fb_form_ids IS NOT NULL
      AND array_length(fb_form_ids, 1) > 0
  `;

  if (!tenants.length) return;

  console.log(`[lead-sync] syncing ${tenants.length} tenant(s)`);

  for (const t of tenants) {
    try {
      await syncTenant(t);
    } catch (err: any) {
      console.error(`[lead-sync] tenant ${t.id} failed:`, err?.message);
    }
  }
}

async function syncTenant(tenant: {
  id: string;
  name: string;
  fb_form_ids: string[];
  fb_page_token: string | null;
  contact_phone: string | null;
  twilio_from: string | null;
}) {
  const token =
    tenant.fb_page_token ??
    process.env[`${tenant.id.toUpperCase()}_FB_PAGE_TOKEN`] ??
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN ??
    "";

  if (!token) {
    console.warn(`[lead-sync] no FB token for ${tenant.id} — skipping`);
    return;
  }

  let inserted = 0;

  for (const formId of tenant.fb_form_ids) {
    const fields =
      "id,created_time,field_data,ad_id,adset_id,campaign_id,ad_name,adset_name,campaign_name,form_id";
    let nextUrl: string | null = `${GRAPH_BASE}/${formId}/leads?fields=${fields}&limit=100&access_token=${token}`;

    while (nextUrl) {
      const page = (await fetch(nextUrl).then((r) => r.json())) as any;

      if (page.error) {
        console.error(`[lead-sync] Graph error for form ${formId}:`, page.error?.message);
        break;
      }

      for (const graphLead of page.data ?? []) {
        const leadgenId = String(graphLead.id ?? "");
        if (!leadgenId) continue;
        if (await getLeadByMetaId(leadgenId)) continue; // already exists

        try {
          const parsed = parseFieldData(graphLead.field_data ?? []);
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
            raw_payload: { ...graphLead } as Record<string, unknown>,
            status: "new",
            notes: null,
          });

          await logActivity({
            lead_id: leadId,
            tenant_id: tenant.id,
            type: "lead_received",
            direction: "inbound",
            body: `Hourly sync: ${parsed.fullName || "Unknown"}${parsed.phone ? ` · ${parsed.phone}` : ""}`,
            metadata: { source: "hourly_sync", formId },
          });

          inserted++;
          console.log(`[lead-sync] new lead ${leadId} for ${tenant.id}: ${parsed.fullName || parsed.phone}`);

          // Fire post-intake flow (non-blocking)
          const fullTenant = await getTenantById(tenant.id);
          const newLead = await getLeadByMetaId(leadgenId);

          if (fullTenant && newLead) {
            // Owner SMS
            if (fullTenant.contact_phone) {
              const smsBody = [
                `🔔 New ${fullTenant.name} lead`,
                `Name: ${newLead.full_name || "Unknown"}`,
                `Phone: ${newLead.phone || "—"}`,
                `Email: ${newLead.email || "—"}`,
              ].join("\n");
              sendNotification(fullTenant.contact_phone, smsBody, fullTenant.twilio_from, fullTenant.name)
                .then(() => markSmsSent(leadId))
                .catch((e: any) => console.error("[lead-sync] owner SMS failed:", e?.message));
            }

            // Geocode
            if (newLead.address && !(newLead as any).address_lat) {
              geocodeAddress(newLead.address, newLead.city, newLead.state, newLead.zip)
                .then(async (geo) => {
                  if (geo) {
                    await sql`UPDATE swell_leads SET address_lat=${geo.lat}, address_lon=${geo.lon} WHERE id=${leadId}`;
                  }
                })
                .catch(() => {});
            }

            // Discord thread
            notifyNewLeadDiscord(fullTenant.id, fullTenant.name ?? fullTenant.id, {
              leadId: newLead.id,
              name: newLead.full_name,
              phone: newLead.phone,
              email: newLead.email,
            }).catch((e: any) => console.error("[lead-sync] discord failed:", e?.message));

            // CAPI
            capiLeadCreated({
              tenantId: fullTenant.id,
              tenant: fullTenant as any,
              leadId,
              phone: newLead.phone,
              email: newLead.email,
              formId,
            }).catch(() => {});

            // Hayden opening (5s delay so Discord thread is ready)
            setTimeout(() => {
              kickoffConversationForNewLead(fullTenant as any, newLead as any)
                .then((r) =>
                  logActivity({
                    lead_id: newLead.id,
                    tenant_id: fullTenant.id,
                    type: r.ok ? "ai_conversation_started" : "ai_conversation_skipped",
                    direction: "internal",
                    body: r.ok
                      ? `Hayden sent opening to ${newLead.full_name || newLead.phone}`
                      : `AI skipped: ${(r as any).reason}`,
                    metadata: r as any,
                  })
                )
                .catch((e: any) => console.error("[lead-sync] AI kickoff failed:", e?.message));
            }, 5_000);
          }
        } catch (err: any) {
          console.error(`[lead-sync] failed to insert lead ${leadgenId}:`, err?.message);
        }
      }

      nextUrl = page.paging?.next ?? null;
    }
  }

  if (inserted > 0) {
    console.log(`[lead-sync] tenant=${tenant.id} inserted=${inserted} new leads`);
  }
}
