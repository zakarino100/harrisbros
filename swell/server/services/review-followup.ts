/**
 * Post-service customer follow-up.
 * Runs the morning after a job is completed.
 * Sends a satisfaction check, classifies response, routes to review or feedback.
 */
import {
  type Tenant,
  type Lead,
  createReviewFollow,
  updateReviewFollow,
  getPendingReviewFollow,
  getReviewFollowByToken,
  listAppointments,
} from "../db/queries.js";
import { sql } from "../db/index.js";
import { anthropicChat } from "./anthropic.js";
import { sendSms } from "./twilio.js";
import { applyScoreEvent } from "./lead-scoring.js";

const APEX = process.env.SWELL_APEX_DOMAIN ?? "nopressurelaunch.com";

export async function fireMorningReviewFollowups(): Promise<void> {
  // Find appointments completed yesterday across all tenants
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const appts = await sql<any[]>`
    SELECT a.*, t.twilio_from, t.slug, t.name as tenant_name,
           t.owner_phone, t.google_review_url,
           (t.eod_offset_hours) as eod_offset_hours
    FROM swell_appointments a
    JOIN swell_tenants t ON t.id = a.tenant_id
    WHERE a.status = 'completed'
      AND a.scheduled_date = ${yesterdayStr}
      AND NOT EXISTS (
        SELECT 1 FROM swell_review_follows rf WHERE rf.appointment_id = a.id
      )
  `;

  for (const appt of appts) {
    const lead = await sql<any[]>`SELECT * FROM swell_leads WHERE id = ${appt.lead_id} LIMIT 1`;
    if (!lead.length || !lead[0].phone) continue;
    await sendReviewFollowup(appt as any, lead[0] as any);
    await new Promise((r) => setTimeout(r, 500)); // rate limiting
  }
}

async function sendReviewFollowup(appt: any, lead: any): Promise<void> {
  const firstName = (lead.full_name ?? "").split(" ")[0] || "there";
  const service = appt.service_summary ?? "your recent service";
  const msg = `Hey ${firstName}, this is Hayden with ${appt.tenant_name}. Just checking in — how did everything go with ${service} yesterday? 😊`;

  const rfId = await createReviewFollow({
    tenant_id: appt.tenant_id,
    lead_id: appt.lead_id,
    appointment_id: appt.id,
    follow_up_phone: lead.phone,
  });

  try {
    await sendSms(lead.phone, msg, appt.twilio_from);
    await updateReviewFollow(rfId, { status: "sent", sent_at: new Date().toISOString() });
    console.log(`[review] Follow-up sent to ${lead.phone} for appt ${appt.id}`);
  } catch (e) {
    console.error(`[review] Send failed for appt ${appt.id}:`, e);
  }
}

export async function handleReviewFollowReply(opts: {
  tenant: any;
  reviewFollow: any;
  body: string;
}): Promise<void> {
  const { tenant, reviewFollow, body } = opts;

  await updateReviewFollow(reviewFollow.id, {
    status: "replied",
    replied_at: new Date().toISOString(),
    reply_text: body,
  });

  // Classify sentiment with Haiku
  const result = await anthropicChat({
    model: "claude-haiku-4-5",
    system:
      'Classify customer satisfaction from their reply to a post-service check-in. Return ONLY JSON: { "score": 1-5, "confidence": 0.0-1.0, "reasoning": "brief" }',
    messages: [{ role: "user", content: `Customer reply: "${body}"` }],
    maxTokens: 150,
    tenantId: tenant.id,
  });

  let sentiment = { score: 3, confidence: 0.5, reasoning: "" };
  try {
    sentiment = JSON.parse(result.text.trim());
  } catch {}

  await updateReviewFollow(reviewFollow.id, {
    sentiment_score: sentiment.score,
    sentiment_confidence: sentiment.confidence,
  });

  const lead = (await sql<any[]>`SELECT * FROM swell_leads WHERE id = ${reviewFollow.lead_id} LIMIT 1`)[0];
  const firstName = (lead?.full_name ?? "").split(" ")[0] || "there";

  if (sentiment.score >= 4) {
    // Positive — route to Google review
    const reviewUrl = (tenant as any).google_review_url;
    if (reviewUrl) {
      const msg = `So glad to hear it, ${firstName}! 🙌 If you have 60 seconds, a quick Google review would mean the world to us: ${reviewUrl}`;
      await sendSms(reviewFollow.follow_up_phone, msg, tenant.twilio_from);
      await updateReviewFollow(reviewFollow.id, {
        status: "routed_review",
        route_taken: "google_review",
        review_link_sent_at: new Date().toISOString(),
      });
      await applyScoreEvent(tenant.id, reviewFollow.lead_id, "review_positive", sentiment.score);
    } else {
      // No review URL configured — just thank them
      await sendSms(
        reviewFollow.follow_up_phone,
        `So glad to hear it, ${firstName}! Thanks for letting us know. 🙌`,
        tenant.twilio_from
      );
      await updateReviewFollow(reviewFollow.id, { status: "closed", route_taken: "none" });
      await applyScoreEvent(tenant.id, reviewFollow.lead_id, "review_positive", sentiment.score);
    }
  } else {
    // Negative/neutral — route to internal feedback form
    const slug = (tenant as any).slug ?? tenant.id;
    const feedbackUrl = `https://${slug}.${APEX}/feedback/${reviewFollow.feedback_token}`;
    const msg = `We're really sorry to hear that, ${firstName}. Your experience matters to us — could you share more here so the owner can address it personally? ${feedbackUrl}`;
    await sendSms(reviewFollow.follow_up_phone, msg, tenant.twilio_from);
    await updateReviewFollow(reviewFollow.id, {
      status: "routed_feedback",
      route_taken: "feedback_form",
      feedback_link_sent_at: new Date().toISOString(),
    });
    await applyScoreEvent(tenant.id, reviewFollow.lead_id, "review_negative", sentiment.score);
  }

  // Update lead score for engagement
  await applyScoreEvent(tenant.id, reviewFollow.lead_id, "conversation_engaged");
}

export async function sendNoResponseNudges(): Promise<void> {
  // Nudge review follows that haven't replied after 24h
  const rows = await sql<any[]>`
    SELECT rf.*, t.twilio_from, t.name as tenant_name
    FROM swell_review_follows rf
    JOIN swell_tenants t ON t.id = rf.tenant_id
    WHERE rf.status = 'sent'
      AND rf.nudge_sent_at IS NULL
      AND rf.sent_at < NOW() - INTERVAL '24 hours'
  `;

  for (const rf of rows) {
    const firstName = "there"; // Could join lead for name
    const msg = `Hey ${firstName}! Just wanted to make sure you got our message — hope everything was great with your service. Let us know how it went! 😊`;
    try {
      await sendSms(rf.follow_up_phone, msg, rf.twilio_from);
      await updateReviewFollow(rf.id, { nudge_sent_at: new Date().toISOString() });
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
}
