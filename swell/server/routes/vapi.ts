/**
 * VAPI webhook — receives call lifecycle events.
 * POST /api/vapi/webhook
 *
 * On assistant-request: returns dynamic caller context so the prompt knows
 * if this is a new caller, a known lead, or an existing customer.
 *
 * Events handled: assistant-request, call-started, call-ended, end-of-call-report
 */
import { Router, type Request, type Response } from "express";
import { sql } from "../db/index.js";
import { listTenants, logActivity, findOrCreateCustomer } from "../db/queries.js";
import { notifyNewLeadDiscord, mirrorSmsToThread } from "../services/discord.js";
import { normalizeStatus } from "../services/vapi.js";
import { sendNotification, sendSms } from "../services/twilio.js";
import { getAvailableSlots } from "../services/scheduling.js";
import { extractAndSyncLeadData } from "../services/lead-extractor.js";

// ─── Post-call scheduling SMS ─────────────────────────────────────────────────
// Called when a caller expressed booking intent on a VAPI call.
// Looks up the next available slot, texts the customer, creates a pending appointment.
async function triggerPostCallSchedulingSms(opts: {
  tenantId: string;
  tenantName: string;
  twilioFrom: string | null;
  customerPhone: string;
  callerName: string | null;
  serviceRequested: string | null;
  homeAddress: string | null;
  homeSqft: number | null;
  preferredDays: string | null;
  preferredTimes: string | null;
  quotedPrice: number | null;
  leadId: number | null;
}): Promise<void> {
  const { tenantId, tenantName, twilioFrom, customerPhone, callerName,
          serviceRequested, homeAddress, homeSqft, preferredDays, preferredTimes,
          quotedPrice, leadId } = opts;

  // Get available slots, try to match preferred days if provided
  const allSlots = await getAvailableSlots(tenantId, 14);
  const goodSlots = allSlots.filter(s => s.weatherOk);

  let matchedSlots = goodSlots;
  if (preferredDays) {
    const prefLower = preferredDays.toLowerCase();
    const filtered = goodSlots.filter(s => prefLower.includes(s.dayName.toLowerCase().slice(0, 3)));
    if (filtered.length > 0) matchedSlots = filtered;
  }

  const offerSlots = matchedSlots.slice(0, 2).length > 0 ? matchedSlots.slice(0, 2) : allSlots.slice(0, 2);

  if (!offerSlots.length) {
    console.warn(`[vapi] No available slots for post-call SMS to ${customerPhone}`);
    return;
  }

  const firstName = (callerName ?? "").split(" ")[0] || "there";
  const service = serviceRequested ?? "your service";
  const slotList = offerSlots.map(s => `${s.dayName} ${s.date}`).join(" or ");

  const msg = `Hey ${firstName}! Hayden with ${tenantName} here — following up from our call. ` +
    `I checked the schedule and we have ${slotList} available for ${service}. ` +
    `Does one of those work, or do you have a preference? Reply and we’ll lock it in! 👍`;

  await sendSms(customerPhone, msg, twilioFrom);

  // Upsert lead if new
  let resolvedLeadId = leadId;
  if (!resolvedLeadId) {
    const rows = await sql`
      INSERT INTO swell_leads
        (tenant_id, meta_lead_id, phone, full_name, address, status, notes)
      VALUES
        (${tenantId}, ${'call_' + Date.now()}, ${customerPhone},
         ${callerName ?? null}, ${homeAddress ?? null}, 'new',
         ${'Inbound call — requested scheduling'})
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    resolvedLeadId = rows[0]?.id ?? null;
  } else if (homeAddress) {
    // Update address on existing lead if we got it from the call
    await sql`UPDATE swell_leads SET address = ${homeAddress} WHERE id = ${resolvedLeadId} AND address IS NULL`;
  }

  // Create pending appointment
  if (resolvedLeadId) {
    const notes = [
      homeAddress ? `Address: ${homeAddress}` : null,
      homeSqft ? `Sqft: ${homeSqft}` : null,
      preferredDays ? `Preferred days: ${preferredDays}` : null,
      preferredTimes ? `Preferred times: ${preferredTimes}` : null,
      `Booked via voice call`,
    ].filter(Boolean).join(" | ");

    await sql`
      INSERT INTO swell_appointments
        (tenant_id, lead_id, status, scheduled_date, service_summary, quoted_price_cents, preferred_day, notes)
      VALUES
        (${tenantId}, ${resolvedLeadId}, 'pending', ${offerSlots[0].date},
         ${serviceRequested ?? null}, ${quotedPrice ? quotedPrice * 100 : null},
         ${preferredDays ?? null}, ${notes})
      ON CONFLICT DO NOTHING
    `;
  }

  console.log(`[vapi] Post-call scheduling SMS sent to ${customerPhone} — offered: ${slotList}`);
}

const router = Router();

router.post("/api/vapi/webhook", async (req: Request, res: Response) => {
  const event = req.body as any;
  const type: string = event?.message?.type ?? event?.type ?? "";
  const call = event?.message?.call ?? event?.call ?? {};

  // ─── assistant-request: inject dynamic caller context ──────────────────────
  // VAPI calls this when a call comes in if Server URL is set on the phone number
  // (not the assistant). We respond with variable overrides that get injected
  // into the assistant's system prompt via {{variable}} syntax.
  if (type === "assistant-request") {
    const fromPhone = event?.message?.call?.customer?.number ?? "";
    const toPhone = event?.message?.phoneNumber?.number ?? "";

    const all = await listTenants();
    const tenant = all.find(t =>
      (t.twilio_from ?? "").replace(/\D/g, "").slice(-10) === (toPhone ?? "").replace(/\D/g, "").slice(-10)
    );

    let callerName = "there";
    let callerContext = "new_caller";
    let callerHistory = "No prior history.";
    let upcomingAppt = "";

    if (tenant && fromPhone) {
      const norm = fromPhone.replace(/\D/g, "").slice(-10);

      // Check for known lead
      const leads = await sql`
        SELECT l.full_name, l.status, a.scheduled_date, a.service_summary, a.status as appt_status
        FROM swell_leads l
        LEFT JOIN swell_appointments a ON a.lead_id = l.id AND a.status IN ('pending','confirmed')
        WHERE l.tenant_id = ${tenant.id}
          AND regexp_replace(l.phone, '[^0-9]', '', 'g') LIKE ${'%' + norm}
        ORDER BY l.created_at DESC
        LIMIT 1
      `;

      if (leads.length) {
        const lead = leads[0];
        callerName = (lead.full_name ?? "").split(" ")[0] || "there";

        if (lead.scheduled_date) {
          callerContext = "existing_customer";
          upcomingAppt = `They have a ${lead.appt_status} appointment for ${lead.service_summary ?? "service"} on ${lead.scheduled_date}.`;
          callerHistory = `Existing customer with a ${lead.appt_status} appointment on ${lead.scheduled_date} for ${lead.service_summary ?? "service"}.`;
        } else if (lead.status === "new" || lead.status === "quoted") {
          callerContext = "known_lead";
          callerHistory = `This person submitted a lead for ${tenant.name} and hasn't booked yet. Status: ${lead.status}.`;
        } else if (lead.status === "sold" || lead.status === "completed") {
          callerContext = "past_customer";
          callerHistory = `Past customer — has previously completed a job with ${tenant.name}.`;
        }
      }
    }

    // Build context block to prepend AND set variableValues so {{callerName}} etc. resolve
    let contextBlock = "";
    if (callerContext === "existing_customer") {
      contextBlock = `CALLER CONTEXT: Existing customer${callerName !== "there" ? ` — ${callerName}` : ""}. ${callerHistory}${upcomingAppt ? " " + upcomingAppt : ""} They may be calling about scheduling, rescheduling, or a question about their service.`;
    } else if (callerContext === "known_lead") {
      contextBlock = `CALLER CONTEXT: Known lead${callerName !== "there" ? ` — ${callerName}` : ""}. ${callerHistory} They haven't booked yet. Warm re-engage.`;
    } else if (callerContext === "past_customer") {
      contextBlock = `CALLER CONTEXT: Past customer${callerName !== "there" ? ` — ${callerName}` : ""}. ${callerHistory} Welcome them back warmly.`;
    } else {
      contextBlock = `CALLER CONTEXT: New caller — no prior record. You don't know their name. Open with a friendly greeting and find out what they need.`;
    }

    return res.json({
      assistantOverrides: {
        variableValues: { callerName, callerContext, callerHistory, upcomingAppt },
        model: {
          messages: [{ role: "system", content: contextBlock }],
        },
      },
    });
  }

  // ─── All other events — fire and forget ────────────────────────────────────
  res.sendStatus(200);

  if (!call.id) return;

  try {
    const all = await listTenants();
    const toPhone = call.phoneNumber?.number ?? call.to ?? "";
    const tenant = all.find(t =>
      (t.twilio_from ?? "").replace(/\D/g, "").slice(-10) === (toPhone ?? "").replace(/\D/g, "").slice(-10)
    );
    if (!tenant) return;

    const fromPhone = call.customer?.number ?? call.from ?? "";
    const leadRows = fromPhone ? await sql`
      SELECT id FROM swell_leads
      WHERE tenant_id = ${tenant.id}
        AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE ${'%' + fromPhone.replace(/\D/g, '').slice(-10)}
      LIMIT 1
    ` : [];
    const leadId = leadRows[0]?.id ?? null;

    if (type === "call-started" || type === "call.started") {
      await sql`
        INSERT INTO swell_calls
          (tenant_id, lead_id, vapi_call_id, direction, status, from_phone, to_phone, started_at)
        VALUES
          (${tenant.id}, ${leadId}, ${call.id},
           ${call.type === "outboundPhoneCall" ? "outbound" : "inbound"},
           'in-progress', ${fromPhone}, ${toPhone}, NOW())
        ON CONFLICT (vapi_call_id) DO NOTHING
      `;

      // Mirror call start to Discord thread if lead has one
      if (leadId) {
        const threadRows = await sql`SELECT discord_thread_id, full_name FROM swell_leads WHERE id = ${leadId} LIMIT 1`;
        const threadId = threadRows[0]?.discord_thread_id;
        const name = threadRows[0]?.full_name ?? fromPhone;
        if (threadId) {
          await mirrorSmsToThread(threadId, "assistant",
            `📞 **Call started** — ${call.type === "outboundPhoneCall" ? "Outbound to" : "Inbound from"} ${name}`
          ).catch(() => {});
        }
      }

    } else if (type === "call-ended" || type === "call.ended" || type === "end-of-call-report") {
      const report = event?.message ?? event ?? {};
      const transcript = report.transcript ?? call.artifact?.transcript ?? null;
      const summary = report.summary ?? report.analysis?.summary ?? null;
      const endedReason = report.endedReason ?? call.endedReason ?? null;
      const duration = call.duration ?? null;
      const status = normalizeStatus(endedReason ?? call.status ?? "completed");
      const recordingUrl = call.artifact?.recordingUrl ?? null;
      const structured = report.analysis?.structuredData ?? {};

      await sql`
        INSERT INTO swell_calls
          (tenant_id, lead_id, vapi_call_id, direction, status, from_phone, to_phone,
           duration_seconds, transcript, summary, recording_url, ended_reason, structured_data, started_at, ended_at)
        VALUES
          (${tenant.id}, ${leadId}, ${call.id},
           ${call.type === "outboundPhoneCall" ? "outbound" : "inbound"},
           ${status}, ${fromPhone}, ${toPhone},
           ${duration}, ${transcript}, ${summary}, ${recordingUrl}, ${endedReason},
           ${Object.keys(structured).length > 0 ? structured as any : null},
           ${call.startedAt ?? null}, NOW())
        ON CONFLICT (vapi_call_id) DO UPDATE SET
          status = excluded.status,
          duration_seconds = excluded.duration_seconds,
          transcript = excluded.transcript,
          summary = excluded.summary,
          recording_url = excluded.recording_url,
          ended_reason = excluded.ended_reason,
          structured_data = excluded.structured_data,
          ended_at = excluded.ended_at
      `;

      // Always save structured data separately for analysis even if no booking
      if (structured && Object.keys(structured).length > 0) {
        await sql`
          UPDATE swell_calls SET structured_data = ${structured as any}
          WHERE vapi_call_id = ${call.id}
        `;
      }

      // ─── Lead enrichment from call data ───────────────────────────────────
      // If we matched a lead and got new info from the call, update their record
      if (leadId && structured && Object.keys(structured).length > 0) {
        const homeAddress = structured.homeAddress ?? null;
        const callerName = structured.callerName ?? null;
        const homeSqft = structured.homeSqft ?? null;

        if (homeAddress) {
          await sql`UPDATE swell_leads SET address = ${homeAddress} WHERE id = ${leadId} AND (address IS NULL OR address = '')`;
        }
        if (callerName) {
          await sql`UPDATE swell_leads SET full_name = ${callerName} WHERE id = ${leadId} AND (full_name IS NULL OR full_name = '')`;
        }
        if (homeSqft) {
          // Store sqft in notes if not already captured
          await sql`
            UPDATE swell_leads
            SET notes = CASE
              WHEN notes IS NULL OR notes = '' THEN ${'Sqft (from call): ' + homeSqft}
              WHEN notes NOT LIKE '%Sqft%' THEN notes || ' | Sqft (from call): ' || ${String(homeSqft)}
              ELSE notes
            END
            WHERE id = ${leadId}
          `;
        }
      }

      // ─── Activity timeline logging ──────────────────────────────────────
      if (leadId) {
        const dur = duration ? `${Math.floor(duration / 60)}m ${duration % 60}s` : null;
        const callDir = call.type === "outboundPhoneCall" ? "outbound" : "inbound";
        const callStatus = status;

        let activityBody = `${callDir === "inbound" ? "Inbound" : "Outbound"} call — ${callStatus}`;
        if (dur) activityBody += ` (${dur})`;
        if (summary) activityBody += `\nSummary: ${summary.slice(0, 200)}`;
        if (structured?.serviceRequested) activityBody += `\nService: ${structured.serviceRequested}`;
        if (structured?.homeAddress) activityBody += `\nAddress: ${structured.homeAddress}`;
        if (structured?.homeSqft) activityBody += `\nSqft: ${structured.homeSqft}`;
        if (structured?.preferredDays) activityBody += `\nPreferred days: ${structured.preferredDays}`;
        if (structured?.quotedPrice) activityBody += `\nQuoted: $${structured.quotedPrice}`;
        if (structured?.bookingIntent) activityBody += `\n✅ Booking intent detected`;

        await logActivity({
          lead_id: leadId,
          tenant_id: tenant.id,
          type: `call_${callStatus}`,
          direction: callDir,
          body: activityBody,
          metadata: {
            vapi_call_id: call.id,
            duration_seconds: duration,
            recording_url: recordingUrl ?? null,
            structured_data: structured ?? null,
          },
        }).catch(e => console.error("[vapi] activity log failed:", e?.message));

        // ── Auto-extract from call transcript ──────────────────────
        if (leadId && transcript) {
          // Build messages array from transcript text for the extractor
          const transcriptMessages = (transcript as string)
            .split(/\n/)
            .filter((l: string) => l.trim())
            .map((l: string) => ({
              role: /^(AI|assistant|Hayden)/i.test(l) ? "assistant" : "user",
              body: l.replace(/^[^:]+:\s*/, ""),
            }));
          extractAndSyncLeadData({
            tenantId: tenant.id,
            leadId,
            messages: transcriptMessages.length > 1 ? transcriptMessages
              : [{ role: "user", content: transcript as string }] as any,
          }).catch((e: any) => console.error("[extractor] Call extraction error:", e?.message));
        }
      }

      // Post-call scheduling trigger — fires if booking intent detected
      if (structured?.bookingIntent === true && fromPhone) {
        try {
          await triggerPostCallSchedulingSms({
            tenantId: tenant.id,
            tenantName: tenant.name,
            twilioFrom: tenant.twilio_from,
            customerPhone: fromPhone,
            callerName: structured.callerName ?? null,
            serviceRequested: structured.serviceRequested ?? null,
            homeAddress: structured.homeAddress ?? null,
            homeSqft: structured.homeSqft ?? null,
            preferredDays: structured.preferredDays ?? null,
            preferredTimes: structured.preferredTimes ?? null,
            quotedPrice: structured.quotedPrice ?? null,
            leadId: leadId ?? null,
          });
        } catch (e: any) {
          console.error("[vapi] post-call scheduling failed:", e?.message);
        }
      }

      const ownerPhone = (tenant as any).owner_phone ?? tenant.contact_phone;
      if (ownerPhone && status !== "queued") {
        const dur = duration ? `${Math.round(duration / 60)}m ${duration % 60}s` : "?";
        const callerLabel = fromPhone || "Unknown";
        const bookingFlag = structured?.bookingIntent ? " 📅 Booking intent detected — scheduling SMS sent." : "";
        const msg = `📞 ${status === "completed" ? "Call completed" : `Call ${status}`}: ${callerLabel} — ${dur}${summary ? `\n${summary.slice(0, 120)}` : ""}${bookingFlag}`;
        await sendNotification(ownerPhone, msg, tenant.twilio_from, tenant.name).catch(() => {});
      }

      // ─── New caller lead creation + Discord ───────────────────────────────
      // If caller is unknown and expressed booking intent, create a lead + Discord thread
      if (!leadId && structured?.bookingIntent && fromPhone) {
        try {
          const callerName = structured.callerName ?? null;
          const newLeadRows = await sql`
            INSERT INTO swell_leads
              (tenant_id, meta_lead_id, phone, full_name, address, status, notes)
            VALUES
              (${tenant.id}, ${'call_' + call.id}, ${fromPhone},
               ${callerName ?? null}, ${structured.homeAddress ?? null},
               'new', ${'Inbound call lead — service: ' + (structured.serviceRequested ?? 'quote request')})
            ON CONFLICT DO NOTHING
            RETURNING id
          `;
          const newLeadId = newLeadRows[0]?.id;
          if (newLeadId) {
            // Link to customer
            const custId = await findOrCreateCustomer(tenant.id, {
              phone: fromPhone,
              source: 'call',
            });
            if (custId) {
              await sql`UPDATE swell_leads SET customer_id = ${custId} WHERE id = ${newLeadId}`;
              await sql`UPDATE swell_calls SET customer_id = ${custId} WHERE vapi_call_id = ${call.id}`;
            }

            const threadId = await notifyNewLeadDiscord(tenant.id, tenant.name, {
              leadId: newLeadId,
              name: callerName,
              phone: fromPhone,
              email: null,
              timeline: structured.serviceRequested ?? null,
            });
            if (threadId) {
              await sql`UPDATE swell_leads SET discord_thread_id = ${threadId} WHERE id = ${newLeadId}`;
              await sql`UPDATE swell_calls SET lead_id = ${newLeadId} WHERE vapi_call_id = ${call.id}`;
              // Post call summary to the new thread
              if (summary) {
                await mirrorSmsToThread(threadId, "assistant",
                  `📞 **Call summary** (inbound, ${duration ? Math.round(duration/60)+'m' : '?'}): ${summary.slice(0, 500)}`
                ).catch(() => {});
              }
            }
          }
        } catch (e: any) {
          console.error("[vapi] new caller lead creation failed:", e?.message);
        }
      }

      // ─── Mirror call summary to existing lead's Discord thread ──────────────────
      if (leadId && summary) {
        try {
          const threadRows = await sql`SELECT discord_thread_id FROM swell_leads WHERE id = ${leadId} LIMIT 1`;
          const threadId = threadRows[0]?.discord_thread_id;
          if (threadId) {
            const dur = duration ? `${Math.floor(duration/60)}m ${duration % 60}s` : "?";
            const statusEmoji = status === "completed" ? "✅" : status === "no-answer" ? "🔇" : status === "voicemail" ? "📨" : "📞";
            let msg = `${statusEmoji} **Call ${status}** (${dur})`;
            if (structured?.serviceRequested) msg += `\nService: ${structured.serviceRequested}`;
            if (structured?.homeAddress) msg += `\nAddress: ${structured.homeAddress}`;
            if (structured?.quotedPrice) msg += `\nQuoted: $${structured.quotedPrice}`;
            if (structured?.bookingIntent) msg += `\n✅ Booking intent`;
            if (summary) msg += `\n\n${summary.slice(0, 800)}`;
            await mirrorSmsToThread(threadId, "assistant", msg).catch(() => {});
          }
        } catch (e: any) {
          console.error("[vapi] discord mirror failed:", e?.message);
        }
      }
    }
  } catch (e: any) {
    console.error("[vapi/webhook] error:", e?.message);
  }
});

export default router;
