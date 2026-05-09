/**
 * lead-extractor.ts
 *
 * Haiku-powered extraction pass that runs after a conversation has meaningful
 * content (SMS or call transcript). Pulls:
 *   - Service address
 *   - Quoted / agreed price
 *   - Technician notes (gate codes, dogs, access, sqft, special instructions)
 *   - Customer name (if more complete than what we have)
 *
 * Then writes back to swell_leads, swell_customers, and swell_conversations.
 * Always fire-and-forget (never blocks the reply path).
 */

import { sql } from "../db/index.js";
import { anthropicChat } from "./anthropic.js";

interface ExtractResult {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  quoted_price_cents: number | null;
  tech_notes: string | null;
  customer_name: string | null;
}

const SYSTEM = `You are a data extraction assistant. Given a conversation transcript between a sales AI and a customer, extract the following fields. Return ONLY valid JSON, no commentary.

Fields to extract:
- address: street address the customer mentioned (string or null)
- city: city name (string or null)  
- state: 2-letter state code (string or null)
- zip: zip code (string or null)
- quoted_price_cents: the price quoted or agreed to in cents as an integer (e.g. $299 = 29900), or null if not found
- tech_notes: any technician-relevant info the customer mentioned — gate codes, dogs, access instructions, property notes, square footage, special requests (string or null)
- customer_name: full name of the customer if they mentioned it clearly (string or null)

Rules:
- Only extract what is clearly stated. Do not infer or guess.
- For price: use the final/agreed price, not a range. Ignore discounts unless the final agreed price is explicit.
- For tech_notes: be concise but complete. Combine multiple notes into one string.
- Return null for any field not found.`;

export async function extractAndSyncLeadData(opts: {
  tenantId: string;
  leadId: number;
  conversationId?: number | null;
  messages: { role: string; body: string }[];
}): Promise<void> {
  const { tenantId, leadId, conversationId, messages } = opts;

  if (messages.length < 2) return; // Not enough content to extract from

  // Build transcript — skip system/error messages
  const transcript = messages
    .filter(m => m.role === "user" || m.role === "assistant" || m.role === "customer")
    .map(m => `${m.role === "assistant" ? "Hayden (AI)" : "Customer"}: ${(m.body ?? "").slice(0, 500)}`)
    .join("\n")
    .slice(0, 4000);

  if (!transcript.trim()) return;

  let extracted: ExtractResult;
  try {
    const result = await anthropicChat({
      model: "claude-haiku-4-5",
      system: SYSTEM,
      messages: [{ role: "user", content: `Transcript:\n${transcript}` }],
      maxTokens: 300,
      temperature: 0.1,
      tenantId,
    });

    // Strip markdown fences if present
    const raw = result.text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    extracted = JSON.parse(raw) as ExtractResult;
  } catch (err: any) {
    console.error("[extractor] Haiku extraction failed:", err?.message);
    return;
  }

  const hasData = Object.values(extracted).some(v => v !== null && v !== undefined);
  if (!hasData) return;

  // ── Write back to swell_leads ──────────────────────────────────────────────
  try {
    const [lead] = await sql<any[]>`
      SELECT id, address, city, state, zip, notes, full_name, customer_id
      FROM swell_leads WHERE id = ${leadId} AND tenant_id = ${tenantId} LIMIT 1
    `;
    if (!lead) return;

    const updates: string[] = [];
    const params: any[] = [];

    // Address — only fill blanks
    if (extracted.address && !lead.address) {
      await sql`UPDATE swell_leads SET address = ${extracted.address} WHERE id = ${leadId}`;
    }
    if (extracted.city && !lead.city) {
      await sql`UPDATE swell_leads SET city = ${extracted.city} WHERE id = ${leadId}`;
    }
    if (extracted.state && !lead.state) {
      await sql`UPDATE swell_leads SET state = ${extracted.state} WHERE id = ${leadId}`;
    }
    if (extracted.zip && !lead.zip) {
      await sql`UPDATE swell_leads SET zip = ${extracted.zip} WHERE id = ${leadId}`;
    }

    // Customer name — only fill if we don't have one
    if (extracted.customer_name && !lead.full_name) {
      await sql`UPDATE swell_leads SET full_name = ${extracted.customer_name} WHERE id = ${leadId}`;
    }

    // Tech notes — append to existing notes (don't overwrite)
    if (extracted.tech_notes) {
      const existingNotes: string = lead.notes ?? "";
      // Only add if this note isn't already in there (rough dedup)
      const noteClean = extracted.tech_notes.trim();
      if (noteClean && !existingNotes.includes(noteClean.slice(0, 40))) {
        const newNotes = existingNotes
          ? `${existingNotes}\n[Auto] ${noteClean}`
          : `[Auto] ${noteClean}`;
        await sql`UPDATE swell_leads SET notes = ${newNotes} WHERE id = ${leadId}`;
      }
    }

    // ── Write back to swell_customers (if linked) ────────────────────────────
    if (lead.customer_id) {
      const customerId = lead.customer_id;

      if (extracted.address) {
        await sql`
          UPDATE swell_customers SET address = ${extracted.address}
          WHERE id = ${customerId} AND (address IS NULL OR address = '')
        `;
      }
      if (extracted.city) {
        await sql`
          UPDATE swell_customers SET city = ${extracted.city}
          WHERE id = ${customerId} AND (city IS NULL OR city = '')
        `;
      }
      if (extracted.state) {
        await sql`
          UPDATE swell_customers SET state = ${extracted.state}
          WHERE id = ${customerId} AND (state IS NULL OR state = '')
        `;
      }
      if (extracted.zip) {
        await sql`
          UPDATE swell_customers SET zip = ${extracted.zip}
          WHERE id = ${customerId} AND (zip IS NULL OR zip = '')
        `;
      }
      if (extracted.customer_name) {
        await sql`
          UPDATE swell_customers SET full_name = ${extracted.customer_name}
          WHERE id = ${customerId} AND (full_name IS NULL OR full_name = '')
        `;
      }
    }

    // ── Write quoted price back to conversation ──────────────────────────────
    if (conversationId && extracted.quoted_price_cents && extracted.quoted_price_cents > 0) {
      await sql`
        UPDATE swell_conversations
        SET quoted_price_cents = ${extracted.quoted_price_cents}
        WHERE id = ${conversationId} AND (quoted_price_cents IS NULL OR quoted_price_cents = 0)
      `;
    }

    console.log(`[extractor] Lead ${leadId} synced:`, {
      address: extracted.address,
      city: extracted.city,
      price: extracted.quoted_price_cents,
      notes: extracted.tech_notes?.slice(0, 60),
    });
  } catch (err: any) {
    console.error("[extractor] DB write-back failed:", err?.message);
  }
}
