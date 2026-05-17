import { Router, type Request, type Response } from "express";
import { requireTenant } from "../middleware/tenant.js";
import { requireAuth } from "../middleware/auth.js";
import { sql } from "../db/index.js";
import { sendSms } from "../services/twilio.js";
import {
  insertConversationMessage,
  getOrCreateConversation,
  updateConversation,
  findOrCreateCustomer,
  logActivity,
} from "../db/queries.js";

const router = Router();
router.use(requireTenant, requireAuth);

// GET /api/messages — list all conversations with last message for this tenant
router.get("/api/messages", async (req, res) => {
  try {
    const conversations = await sql`
      SELECT
        c.id, c.status, c.total_messages, c.last_message_at, c.last_role,
        c.discord_thread_id, c.handoff_reason, c.created_at,
        l.id as lead_id, l.full_name, l.phone, l.email,
        m.body as last_message_body, m.role as last_message_role,
        m.created_at as last_message_time
      FROM swell_conversations c
      JOIN swell_leads l ON l.id = c.lead_id
      LEFT JOIN LATERAL (
        SELECT body, role, created_at FROM swell_conversation_messages
        WHERE conversation_id = c.id AND role IN ('user','assistant','rep') AND (error IS NULL OR error != '_hidden')
        ORDER BY created_at DESC LIMIT 1
      ) m ON true
      WHERE c.tenant_id = ${req.tenant!.id}
        AND l.status NOT IN ('archived')
        AND (l.full_name IS NULL OR l.full_name NOT LIKE '<test%')
      ORDER BY COALESCE(m.created_at, c.created_at) DESC
      LIMIT 100
    `;
    res.json(conversations);
  } catch (err) {
    console.error("[messages list]", err);
    res.status(500).json({ error: "Failed to load conversations" });
  }
});

// GET /api/messages/:conversationId — get all messages for a conversation
router.get("/api/messages/:conversationId", async (req, res) => {
  try {
    const convId = Number(req.params.conversationId);
    if (!Number.isInteger(convId)) return res.status(400).json({ error: "Invalid conversation ID" });

    const rows = await sql`
      SELECT m.*, c.discord_thread_id,
             l.full_name, l.phone
      FROM swell_conversation_messages m
      JOIN swell_conversations c ON c.id = m.conversation_id
      JOIN swell_leads l ON l.id = c.lead_id
      WHERE m.conversation_id = ${convId}
        AND c.tenant_id = ${req.tenant!.id}
        AND (m.error IS NULL OR m.error != '_hidden')
      ORDER BY m.created_at ASC
      LIMIT 500
    `;
    if (!rows.length) return res.status(404).json({ error: "Conversation not found" });

    // Get conversation metadata
    const convRows = await sql`
      SELECT c.* FROM swell_conversations c
      WHERE c.id = ${convId} AND c.tenant_id = ${req.tenant!.id}
      LIMIT 1
    `;
    if (!convRows.length) return res.status(404).json({ error: "Conversation not found" });

    const conv = convRows[0] as any;
    const firstRow = rows[0];

    res.json({
      id: convId,
      leadName: firstRow.full_name,
      leadPhone: firstRow.phone,
      status: conv.status,
      handoffReason: conv.handoff_reason,
      aiPaused: conv.ai_paused ?? false,
      totalMessages: conv.total_messages,
      messages: rows.map((r: any) => ({
        id: r.id,
        role: r.role,
        body: r.body,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error("[messages get]", err);
    res.status(500).json({ error: "Failed to load messages" });
  }
});

// POST /api/messages/:conversationId/send — rep sends a message in an existing thread
router.post("/api/messages/:conversationId/send", async (req, res) => {
  try {
    const convId = Number(req.params.conversationId);
    const { body } = req.body ?? {};
    if (!body?.trim()) return res.status(400).json({ error: "body required" });

    const tenant = req.tenant!;

    // Get conversation + lead phone
    const rows = await sql`
      SELECT c.*, l.phone, l.full_name
      FROM swell_conversations c
      JOIN swell_leads l ON l.id = c.lead_id
      WHERE c.id = ${convId} AND c.tenant_id = ${tenant.id}
      LIMIT 1
    `;
    if (!rows.length) return res.status(404).json({ error: "Conversation not found" });
    const conv = rows[0] as any;

    if (!conv.phone) return res.status(400).json({ error: "Lead has no phone number" });

    // Send SMS
    await sendSms(conv.phone, body, tenant.twilio_from);

    // Log as 'rep' role (distinct from 'assistant' = Hayden)
    await insertConversationMessage({
      conversation_id: convId,
      tenant_id: tenant.id,
      role: "rep",
      body,
      twilio_sid: null,
      model_used: null,
      tokens_in: null,
      tokens_out: null,
      cost_cents: null,
      error: null,
    });

    // Update conversation: mark as handed off (rep is now owner), freeze AI
    const isFirstRepMessage = conv.status === "active" || conv.status === "nurture";
    await updateConversation(convId, {
      last_role: "rep",
      last_message_at: new Date().toISOString(),
      total_messages: (conv.total_messages || 0) + 1,
      ...(isFirstRepMessage && { status: "handoff", handoff_reason: "rep_took_over" }),
    });

    // Log activity for learning
    if (isFirstRepMessage) {
      const { logActivity } = await import("../db/queries.js");
      await logActivity({
        lead_id: conv.lead_id,
        tenant_id: tenant.id,
        type: "handoff_initiated",
        direction: "internal",
        body: `Rep took over conversation. AI paused.`,
        metadata: { reason: "rep_took_over" },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[messages send]", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// POST /api/messages/new — start a new conversation (with existing lead or new phone)
router.post("/api/messages/new", async (req, res) => {
  try {
    const { phone, leadId, body } = req.body ?? {};
    if (!phone && !leadId) return res.status(400).json({ error: "phone or leadId required" });
    if (!body?.trim()) return res.status(400).json({ error: "body required" });

    const tenant = req.tenant!;

    let resolvedLeadId = leadId;
    let resolvedPhone = phone;

    if (leadId) {
      const leads = await sql`
        SELECT id, phone FROM swell_leads
        WHERE id = ${leadId} AND tenant_id = ${tenant.id}
        LIMIT 1
      `;
      if (!leads.length) return res.status(404).json({ error: "Lead not found" });
      resolvedPhone = leads[0].phone;
      resolvedLeadId = leads[0].id;
    } else {
      // Create a new lead for this phone if it doesn't exist
      const existing = await sql`
        SELECT id FROM swell_leads WHERE tenant_id = ${tenant.id}
          AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE ${"%" + phone.replace(/\D/g, "").slice(-10)}
        LIMIT 1
      `;
      if (existing.length) {
        resolvedLeadId = existing[0].id;
      } else {
        const rows = await sql`
          INSERT INTO swell_leads (tenant_id, meta_lead_id, phone, status, notes)
          VALUES (${tenant.id}, ${"manual_" + Date.now()}, ${phone}, 'new', 'Created from CRM manual SMS')
          RETURNING id
        `;
        resolvedLeadId = rows[0].id;
        
        // Link to customer
        try {
          const customerId = await findOrCreateCustomer(tenant.id, {
            phone,
            source: 'manual',
          });
          await sql`UPDATE swell_leads SET customer_id = ${customerId} WHERE id = ${resolvedLeadId}`;
        } catch (e: any) {
          console.error("[messages] customer link failed:", e?.message);
        }
      }
    }

    const conv = await getOrCreateConversation(tenant.id, resolvedLeadId);

    await sendSms(resolvedPhone, body, tenant.twilio_from);

    await insertConversationMessage({
      conversation_id: conv.id,
      tenant_id: tenant.id,
      role: "rep",
      body,
      twilio_sid: null,
      model_used: null,
      tokens_in: null,
      tokens_out: null,
      cost_cents: null,
      error: null,
    });

    // Mark as handed off if this is a new conversation (first message from rep)
    const isFirstMessage = (conv.total_messages || 0) === 0;
    await updateConversation(conv.id, {
      last_role: "rep",
      last_message_at: new Date().toISOString(),
      total_messages: (conv.total_messages || 0) + 1,
      ...(isFirstMessage && { status: "handoff", handoff_reason: "rep_initiated" }),
    });

    res.json({ ok: true, conversationId: conv.id, leadId: resolvedLeadId });
  } catch (err) {
    console.error("[messages new]", err);
    res.status(500).json({ error: "Failed to create message" });
  }
});

// PATCH /api/messages/:conversationId/resume-ai — re-enable Hayden for a paused conversation
router.patch("/api/messages/:conversationId/resume-ai", async (req, res) => {
  try {
    const convId = Number(req.params.conversationId);
    if (!Number.isInteger(convId)) return res.status(400).json({ error: "Invalid conversation ID" });

    const tenant = req.tenant!;

    // Verify the conversation belongs to this tenant
    const rows = await sql`
      SELECT c.id, c.status, l.full_name
      FROM swell_conversations c
      JOIN swell_leads l ON l.id = c.lead_id
      WHERE c.id = ${convId} AND c.tenant_id = ${tenant.id}
      LIMIT 1
    `;
    if (!rows.length) return res.status(404).json({ error: "Conversation not found" });

    const conv = rows[0] as any;
    if (conv.status === "stopped") {
      // Stopped means STOP keyword / DNC — don't re-enable
      return res.status(400).json({ error: "Cannot resume a stopped conversation (customer opted out)" });
    }

    await updateConversation(convId, { status: "active" } as any);

    console.log(`[messages] Conversation ${convId} AI resumed by rep (was: ${conv.status})`);
    res.json({ ok: true, previousStatus: conv.status });
  } catch (err) {
    console.error("[messages resume-ai]", err);
    res.status(500).json({ error: "Failed to resume AI" });
  }
});

// PATCH /api/messages/:conversationId/ai-toggle — manually pause or resume AI for a specific lead
router.patch("/api/messages/:conversationId/ai-toggle", async (req, res) => {
  try {
    const convId = Number(req.params.conversationId);
    if (!Number.isInteger(convId)) return res.status(400).json({ error: "Invalid conversation ID" });

    const tenant = req.tenant!;
    const rows = await sql`
      SELECT c.id, c.ai_paused, l.full_name
      FROM swell_conversations c
      JOIN swell_leads l ON l.id = c.lead_id
      WHERE c.id = ${convId} AND c.tenant_id = ${tenant.id}
      LIMIT 1
    `;
    if (!rows.length) return res.status(404).json({ error: "Conversation not found" });

    const conv = rows[0] as any;
    const newPaused = !conv.ai_paused;

    await sql`UPDATE swell_conversations SET ai_paused = ${newPaused} WHERE id = ${convId}`;

    console.log(`[ai-toggle] Conv ${convId} (${conv.full_name}): ai_paused → ${newPaused}`);
    res.json({ ok: true, ai_paused: newPaused });
  } catch (err) {
    console.error("[ai-toggle]", err);
    res.status(500).json({ error: "Failed to toggle AI" });
  }
});

// GET /api/leads/search — search leads by name or phone (for the new message modal)
router.get("/api/leads/search", async (req, res) => {
  try {
    const q = (req.query.q as string)?.trim() || "";
    if (q.length < 2)
      return res.json([]);

    const searchQuery = `%${q}%`;
    const leads = await sql`
      SELECT id, full_name, phone, email
      FROM swell_leads
      WHERE tenant_id = ${req.tenant!.id}
        AND (
          full_name ILIKE ${searchQuery}
          OR phone ILIKE ${searchQuery}
          OR email ILIKE ${searchQuery}
        )
        AND status NOT IN ('test', 'archived')
      ORDER BY full_name ASC
      LIMIT 20
    `;
    res.json(leads);
  } catch (err) {
    console.error("[leads search]", err);
    res.status(500).json({ error: "Failed to search leads" });
  }
});

export default router;
