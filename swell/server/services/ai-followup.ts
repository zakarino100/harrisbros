/**
 * AI followup — STUB.
 *
 * Per-tenant call site that fires after a new lead lands. Currently a no-op
 * that just logs an activity row. Wire up Anthropic Haiku (or per-tenant
 * provider) here when Boss greenlights the qualifier flow.
 *
 * Expected future shape:
 *   - Send a SMS (or email) to the lead from the tenant's Twilio number
 *   - Greet, label as AI, offer to qualify (sqft / timeline / service)
 *   - On reply, classify + update lead status
 *   - Hand off to human via tenant SMS alert when needed
 */
import { logActivity, type Lead, type Tenant } from "../db/queries.js";

export async function maybeStartAIFollowup(tenant: Tenant, lead: Lead) {
  // Stub: log the trigger so we can verify wiring end-to-end before we add
  // an LLM call + provider keys per-tenant.
  logActivity({
    lead_id: lead.id,
    tenant_id: tenant.id,
    type: "ai_followup_stub",
    direction: "internal",
    body: `AI followup trigger fired for lead ${lead.id} (${lead.full_name || "unknown"}).`,
    metadata: { trigger: "new_lead", note: "stub — wire LLM later" },
  });
}
