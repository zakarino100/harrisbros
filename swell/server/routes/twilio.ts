/**
 * Twilio inbound SMS webhook.
 *
 * Configured in Twilio console as:
 *   POST https://swell.nopressurelaunch.com/api/twilio/inbound
 *   (form-urlencoded; Twilio sends `application/x-www-form-urlencoded`)
 *
 * Multi-tenant routing: each tenant has its own Twilio number stored
 * in tenants.twilio_from. We match req.body.To against that to resolve
 * the tenant, then look up the lead by the customer's From number.
 *
 * Twilio expects a TwiML <Response> body — we always return an empty
 * one, since we send replies asynchronously through the API.
 */
import { Router, type Request, type Response } from "express";
import {
  listTenants,
  findConversationByPhone,
  getLeadByIdForTenant,
  getPendingEodCheck,
  getPendingReviewFollow,
  insertLead,
  getAIConfig,
} from "../db/queries.js";
import { handleInboundSms, handleOwnerSmsFromRoute } from "../services/conversation.js";
import { logActivity, getOrCreateConversation } from "../db/queries.js";
import { sql } from "../db/index.js";
import { notifyNewLeadDiscord } from "../services/discord.js";
import { handleOwnerEodReply } from "../services/owner-eod.js";
import { handleReviewFollowReply } from "../services/review-followup.js";
import { findAppointmentByPhone, handleAppointmentReply } from "../services/appointment-reminders.js";
import { sendNotification } from "../services/twilio.js";

const router = Router();

/**
 * POST /api/twilio/voice
 * Handles inbound voice calls to tenant numbers.
 * Returns TwiML that either connects to VAPI or plays a fallback message.
 */
router.post("/api/twilio/voice", async (req: Request, res: Response) => {
  res.set("Content-Type", "text/xml");

  const body = (req.body ?? {}) as Record<string, string>;
  const toPhone = body.To;
  const fromPhone = body.Called ?? body.To;

  const all = await listTenants();
  const tenant = all.find(t => normalize(t.twilio_from) === normalize(toPhone));

  if (!tenant) {
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response><Say>Sorry, we couldn't route your call. Please try again later.</Say></Response>`);
  }

  const assistantId = (tenant as any).vapi_assistant_id
    ?? process.env[`${tenant.id.toUpperCase()}_VAPI_ASSISTANT_ID`];

  if (!assistantId || !process.env.VAPI_API_KEY) {
    // Fallback: record a message and notify owner
    const ownerPhone = (tenant as any).owner_phone ?? tenant.contact_phone ?? "";
    return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Hi, thanks for calling ${tenant.name}. We're not available right now but will get back to you shortly.</Say>
  <Record maxLength="60" transcribe="true" />
</Response>`);
  }

  // Forward to VAPI — VAPI handles the call from here
  return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://phone.vapi.ai">
      <Parameter name="vapiApiKey" value="${process.env.VAPI_API_KEY}" />
      <Parameter name="vapiAssistantId" value="${assistantId}" />
    </Stream>
  </Connect>
</Response>`);
});

router.post("/api/twilio/inbound", async (req: Request, res: Response) => {
  // Empty TwiML response — we'll send replies via REST API, not in-band.
  res.set("Content-Type", "text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response/>`);

  const body = (req.body ?? {}) as Record<string, string>;
  const fromPhone = body.From;
  const toPhone = body.To;
  const sid = body.MessageSid ?? null;
  const numMedia = parseInt(body.NumMedia ?? "0", 10);

  // Collect any MMS media URLs (Twilio sends MediaUrl0, MediaUrl1, etc.)
  const mediaUrls: string[] = [];
  for (let i = 0; i < numMedia; i++) {
    const url = body[`MediaUrl${i}`];
    if (url) mediaUrls.push(url);
  }

  // Build text body — if MMS has no text, use a placeholder so the conversation continues
  let text = body.Body ?? "";
  if (!text && mediaUrls.length > 0) {
    text = "[Photo attached]"; // ensure conversation engine runs even for image-only MMS
  }

  if (!fromPhone || !toPhone || (!text && mediaUrls.length === 0)) {
    console.warn("[twilio/inbound] missing From/To/Body, ignoring", body);
    return;
  }

  // Attach media context to text so Hayden + conversation log capture it
  if (mediaUrls.length > 0) {
    const mediaNote = `\n[Customer sent ${mediaUrls.length} photo(s): ${mediaUrls.join(", ")}]`;
    text = text ? text + mediaNote : mediaNote;
    console.log(`[twilio/inbound] MMS from ${fromPhone} — ${mediaUrls.length} media attachment(s)`);
  }

  // Resolve tenant by To-phone match
  const all = await listTenants();
  const tenant = all.find(
    (t) => normalize(t.twilio_from) === normalize(toPhone)
  );
  if (!tenant) {
    console.warn(`[twilio/inbound] no tenant matches To=${toPhone}, ignoring`);
    return;
  }

  // ── Owner / Admin detection — intercept before any lead lookup/creation ─────────────
  // Matches: tenant contact_phone (business owner) OR global SWELL_ADMIN_PHONE (Zak)
  const adminPhone = process.env.SWELL_ADMIN_PHONE ?? "";
  const isOwner = !!tenant.contact_phone && normalize(fromPhone) === normalize(tenant.contact_phone);
  const isAdmin = !!adminPhone && normalize(fromPhone) === normalize(adminPhone);
  if (isOwner || isAdmin) {
    const callerLabel = isAdmin ? "Zak (Admin)" : "Owner";
    console.log(`[twilio/inbound] ${callerLabel} message detected for ${tenant.id} from ${fromPhone}`);
    const ownerLead = {
      id: -1, tenant_id: tenant.id,
      full_name: callerLabel, phone: fromPhone, email: null,
      address: null, city: null, state: null, zip: null,
      status: "owner", meta_lead_id: "", meta_page_id: null, meta_form_id: null,
      meta_campaign_id: null, meta_adset_id: null, meta_ad_id: null,
      raw_payload: {}, sms_alert_sent: false, sms_alert_sent_at: null, discord_thread_id: null,
      created_at: new Date().toISOString(),
    } as any;
    handleOwnerSmsFromRoute(tenant, ownerLead, text).catch(
      (e: any) => console.error("[twilio/inbound] owner handler error:", e?.message)
    );
    return;
  }

  // Resolve lead via existing conversation lookup
  const conv = await findConversationByPhone(tenant.id, fromPhone);

  // ── New inbound inquiry (no prior conversation) ──────────────────────────
  // Someone texted the tenant's number cold. Create a lead + let Hayden reply.
  if (!conv) {
    const cfg = await getAIConfig(tenant.id);
    if (!cfg || cfg.enabled !== true) {
      console.log(`[twilio/inbound] new inquiry from ${fromPhone} but AI disabled for ${tenant.id} — dropping`);
      return;
    }
    try {
      console.log(`[twilio/inbound] new inbound inquiry from ${fromPhone} for tenant=${tenant.id} — creating lead`);
      const leadId = await insertLead({
        tenant_id: tenant.id,
        meta_lead_id: `sms_inbound_${Date.now()}_${fromPhone.replace(/\D/g, "").slice(-10)}`,
        meta_page_id: null,
        meta_form_id: null,
        meta_campaign_id: null,
        meta_adset_id: null,
        meta_ad_id: null,
        full_name: null,
        phone: fromPhone,
        email: null,
        address: null,
        city: null,
        state: null,
        zip: null,
        raw_payload: { source: "sms_inbound", body: text, to: toPhone },
        status: "new",
        notes: `Inbound SMS: "${text.slice(0, 200)}"`,
      });
      const newLead = await getLeadByIdForTenant(tenant.id, leadId);
      if (!newLead) return;
      // Log the inquiry as the first user message so Hayden has context
      await logActivity({
        lead_id: leadId,
        tenant_id: tenant.id,
        type: "inbound_sms",
        direction: "inbound",
        body: text,
        metadata: { twilio_sid: sid, from: fromPhone },
      });
      // Create Discord thread so the rep can see + intervene
      try {
        const conversation = await getOrCreateConversation(tenant.id, leadId);
        const threadId = await notifyNewLeadDiscord(tenant.id, tenant.name ?? tenant.id, {
          leadId,
          name: null,
          phone: fromPhone,
          email: null,
          homeSize: null,
          timeline: null,
        });
        if (threadId) {
          await sql`UPDATE swell_leads SET discord_thread_id = ${threadId} WHERE id = ${leadId}`;
          const { updateConversation } = await import("../db/queries.js");
          await updateConversation(conversation.id, { discord_thread_id: threadId });
        }
      } catch (dcErr: any) {
        console.error("[twilio/inbound] Discord thread creation failed:", dcErr?.message);
      }
      // Hayden kicks off — she'll see the inbound text as context in her first turn
      const r = await handleInboundSms({ tenant, lead: newLead, body: text, twilioSid: sid });
      console.log(`[twilio/inbound] new inquiry response:`, r?.ok, r?.reason ?? "");
    } catch (err: any) {
      console.error("[twilio/inbound] new inquiry handling failed:", err?.message);
    }
    return;
  }

  const lead = await getLeadByIdForTenant(tenant.id, conv.lead_id);
  if (!lead) {
    console.warn(`[twilio/inbound] lead missing for conv=${conv.id}, dropping`);
    return;
  }

  try {
    // 1. Check if this is an owner EOD reply
    const normalizedFrom = normalize(fromPhone);
    const ownerPhone = normalize((tenant as any).owner_phone ?? tenant.contact_phone ?? "");
    if (ownerPhone && normalizedFrom === ownerPhone) {
      const pendingEod = await getPendingEodCheck(tenant.id);
      if (pendingEod) {
        await handleOwnerEodReply({ tenant, body: text });
        return;
      }
    }

    // 2. Check if this is a review follow-up reply
    // 3. Check if this is an appointment reminder reply (reschedule/cancel/confirm)
    const pendingAppt = await findAppointmentByPhone(tenant.id, fromPhone);
    if (pendingAppt) {
      await handleAppointmentReply({
        tenantId: tenant.id,
        tenantName: tenant.name,
        twilio_from: tenant.twilio_from,
        body: text,
        appointment: pendingAppt,
      });
      return;
    }

    const pendingReview = await getPendingReviewFollow(tenant.id, fromPhone);
    if (pendingReview) {
      await handleReviewFollowReply({ tenant, reviewFollow: pendingReview, body: text });
      return;
    }

    // 3. Existing customer conversation flow (unchanged)
    await handleInboundSms({ tenant, lead, body: text, twilioSid: sid });
  } catch (err) {
    console.error("[twilio/inbound] handleInboundSms threw:", err);
  }
});

function normalize(p?: string | null): string {
  return (p ?? "").replace(/\D/g, "").replace(/^1/, "");
}

export default router;
