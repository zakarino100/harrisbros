/**
 * Test/development routes
 * - SMS widget: test Hayden conversation in real-time
 * - Twilio trigger: send real SMS for full loop testing
 */
import { Router, type Request, type Response } from "express";
import { requireTenant } from "../middleware/tenant.js";
import { requireAuth } from "../middleware/auth.js";
import {
  insertLead,
  getLeadByIdForTenant,
  getOrCreateConversation,
  listLeads,
} from "../db/queries.js";
import { handleInboundSms, kickoffConversationForNewLead } from "../services/conversation.js";
import { sendSms } from "../services/twilio.js";

const router = Router();

router.use(requireTenant, requireAuth);

// ─── Test SMS: Simulated conversation ──────────────────────────────────────────

/**
 * POST /api/test/sms
 * Body: { message: string, conversationId?: number }
 * Response: { response: string, tokens: { in, out }, model: string, costCents: number }
 *
 * Creates a test lead on first call, reuses it for follow-ups.
 * Sends message through Hayden, returns AI response.
 */
router.post("/api/test/sms", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const { message, conversationId } = req.body ?? {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message required" });
    }

    // Find or create test lead
    let testLead = null;
    if (conversationId) {
      // Try to get lead from conversation ID
      const leads = await listLeads(tenantId, 1000);
      const testLeads = leads.filter((l) => l.status === "test");
      // For simplicity, use the first test lead if it has this conversation
      if (testLeads.length > 0) {
        testLead = testLeads[0];
      }
    }

    if (!testLead) {
      // Create fresh test lead
      const leadId = await insertLead({
        tenant_id: tenantId,
        meta_lead_id: `test_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        meta_page_id: null,
        meta_form_id: null,
        meta_campaign_id: null,
        meta_adset_id: null,
        meta_ad_id: null,
        full_name: "Test User",
        phone: "+1-TEST-000-0000",
        email: null,
        address: null,
        city: null,
        state: null,
        zip: null,
        raw_payload: { test: true },
        status: "test",
        notes: "Auto-generated test lead for widget",
      });
      testLead = await getLeadByIdForTenant(tenantId, leadId);
    }

    if (!testLead) {
      return res.status(500).json({ error: "Failed to create test lead" });
    }

    // Get or create conversation
    const conversation = await getOrCreateConversation(tenantId, testLead.id);

    // Route through Hayden
    const result = await handleInboundSms({
      tenant: req.tenant!,
      lead: testLead,
      body: message,
      twilioSid: null,
    });

    // Format response
    res.json({
      response: result.reply || "No response",
      ok: result.ok,
      reason: result.reason,
      conversationId: conversation.id,
    });
  } catch (err: any) {
    console.error("[test] POST /api/test/sms error:", err);
    res.status(500).json({ error: err?.message || "Failed to process test SMS" });
  }
});

/**
 * DELETE /api/test/sms/:conversationId
 * Clears the test conversation (resets for fresh test)
 */
router.delete("/api/test/sms/:conversationId", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const conversationId = Number(req.params.conversationId);

    if (!Number.isFinite(conversationId)) {
      return res.status(400).json({ error: "Invalid conversation ID" });
    }

    // For now, just return ok. In production, you'd mark conversation as archived
    // or delete test messages, but keep for history.

    res.json({ ok: true });
  } catch (err: any) {
    console.error("[test] DELETE /api/test/sms/:conversationId error:", err);
    res.status(500).json({ error: "Failed to clear test conversation" });
  }
});

// ─── Twilio trigger: Real SMS test ────────────────────────────────────────────

/**
 * POST /api/test/sms-trigger
 * Body: { testPhoneNumber: string }
 * Sends a real SMS from tenant's Twilio number to the test number.
 * Good for testing the full webhook loop.
 */
router.post("/api/test/sms-trigger", async (req: Request, res: Response) => {
  try {
    const tenantId = req.tenant!.id;
    const tenant = req.tenant!;
    const { testPhoneNumber } = req.body ?? {};

    if (!testPhoneNumber || typeof testPhoneNumber !== "string") {
      return res.status(400).json({ error: "testPhoneNumber required" });
    }

    if (!tenant.twilio_from) {
      return res.status(400).json({ error: "Tenant has no Twilio number configured" });
    }

    // Send test SMS
    const testMessage = `🤖 Swell test SMS from ${tenant.name}. Reply to test the full webhook loop.`;

    const result = await sendSms(testPhoneNumber, testMessage, tenant.twilio_from);

    res.json({
      ok: true,
      message: "Test SMS sent",
      from: tenant.twilio_from,
      to: testPhoneNumber,
      sid: result.sid || null,
    });
  } catch (err: any) {
    console.error("[test] POST /api/test/sms-trigger error:", err);
    res.status(500).json({ error: err?.message || "Failed to send test SMS" });
  }
});

/**
 * POST /api/test/real-loop
 * Body: { phone: string, name?: string }
 * Creates a real lead with the given phone, kicks off Hayden's opening SMS.
 * When the recipient replies, Twilio webhook routes back to Hayden.
 * Returns { ok, leadId, conversationId, from }
 */
router.post("/api/test/real-loop", async (req: Request, res: Response) => {
  try {
    const tenant = req.tenant!;
    const { phone, name } = req.body ?? {};

    if (!phone || typeof phone !== "string") {
      return res.status(400).json({ error: "phone required" });
    }
    if (!tenant.twilio_from) {
      return res.status(400).json({ error: "Tenant has no twilio_from configured" });
    }

    // Create a real-loop test lead
    const leadId = await insertLead({
      tenant_id: tenant.id,
      meta_lead_id: `realtest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      meta_page_id: null,
      meta_form_id: null,
      meta_campaign_id: null,
      meta_adset_id: null,
      meta_ad_id: null,
      full_name: name || "Real Loop Test",
      phone,
      email: null,
      address: null,
      city: null,
      state: null,
      zip: null,
      raw_payload: { test: true, mode: "real-loop" },
      status: "test",
      notes: "Real-loop test — created via /api/test/real-loop",
    });

    const lead = await getLeadByIdForTenant(tenant.id, leadId);
    if (!lead) return res.status(500).json({ error: "Lead creation failed" });

    const result = await kickoffConversationForNewLead(tenant, lead);

    res.json({
      ok: result.ok,
      reason: result.reason,
      leadId,
      reply: result.reply,
      from: tenant.twilio_from,
      to: phone,
    });
  } catch (err: any) {
    console.error("[test] POST /api/test/real-loop error:", err);
    res.status(500).json({ error: err?.message || "Failed to kick off real loop test" });
  }
});

export default router;

