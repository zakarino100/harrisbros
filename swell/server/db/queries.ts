/**
 * Async typed query helpers for PostgreSQL.
 * Every lead/activity query is tenant-scoped — no global lead lookups.
 */
import { sql } from "./index.js";

// ─── Tenants ───────────────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  brand_color: string;
  accent_color: string;
  logo_url: string | null;
  contact_phone: string | null;
  twilio_from: string | null;
  fb_form_ids: string[] | null;
  fb_page_ids: string[] | null;
  fb_page_token: string | null;
  password_hash: string;
  enabled: boolean;
  created_at: string;
}

export async function getTenantBySlug(slug: string): Promise<Tenant | undefined> {
  const rows = await sql<Tenant[]>`
    SELECT * FROM swell_tenants WHERE slug = ${slug} AND enabled = TRUE
  `;
  return rows[0];
}

export async function getTenantById(id: string): Promise<Tenant | undefined> {
  const rows = await sql<Tenant[]>`
    SELECT * FROM swell_tenants WHERE id = ${id}
  `;
  return rows[0];
}

export async function listTenants(): Promise<Tenant[]> {
  return await sql<Tenant[]>`
    SELECT * FROM swell_tenants ORDER BY name ASC
  `;
}

export async function findTenantByFormId(formId: string): Promise<Tenant | undefined> {
  if (!formId) return undefined;
  const rows = await sql<Tenant[]>`
    SELECT * FROM swell_tenants WHERE ${formId} = ANY(fb_form_ids)
  `;
  return rows[0];
}

export async function findTenantByPageId(pageId: string): Promise<Tenant | undefined> {
  if (!pageId) return undefined;
  const rows = await sql<Tenant[]>`
    SELECT * FROM swell_tenants WHERE ${pageId} = ANY(fb_page_ids)
  `;
  return rows[0];
}

export async function upsertTenant(
  t: Partial<Tenant> & { id: string; name: string; slug: string; password_hash: string }
): Promise<void> {
  await sql`
    INSERT INTO swell_tenants
      (id, name, slug, brand_color, accent_color, logo_url, contact_phone, twilio_from,
       fb_form_ids, fb_page_ids, fb_page_token, password_hash, enabled)
     VALUES (${t.id}, ${t.name}, ${t.slug}, ${t.brand_color ?? "#fbbf24"}, ${t.accent_color ?? "#fde68a"},
             ${t.logo_url ?? null}, ${t.contact_phone ?? null}, ${t.twilio_from ?? null},
             ${t.fb_form_ids ?? []}, ${t.fb_page_ids ?? []}, ${t.fb_page_token ?? null},
             ${t.password_hash}, ${t.enabled ?? true})
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, slug=excluded.slug, brand_color=excluded.brand_color,
       accent_color=excluded.accent_color, logo_url=excluded.logo_url,
       contact_phone=excluded.contact_phone, twilio_from=excluded.twilio_from,
       fb_form_ids=excluded.fb_form_ids, fb_page_ids=excluded.fb_page_ids,
       fb_page_token=excluded.fb_page_token, password_hash=excluded.password_hash,
       enabled=excluded.enabled
  `;
}

// ─── Leads ─────────────────────────────────────────────────────────────────────

export interface Lead {
  id: number;
  tenant_id: string;
  created_at: string;
  meta_lead_id: string;
  meta_page_id: string | null;
  meta_form_id: string | null;
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  meta_ad_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  raw_payload: Record<string, unknown>;
  status: string;
  notes: string | null;
  sms_alert_sent: boolean;
  sms_alert_sent_at: string | null;
  discord_thread_id: string | null;
  lead_score: number | null;
  repeat_probability: string | null;
}

export async function listLeads(tenantId: string, limit = 200): Promise<Lead[]> {
  return sql<Lead[]>`
    SELECT * FROM swell_leads
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export async function getLeadByIdForTenant(tenantId: string, leadId: number): Promise<Lead | undefined> {
  const rows = await sql<Lead[]>`
    SELECT * FROM swell_leads WHERE id = ${leadId} AND tenant_id = ${tenantId}
  `;
  return rows[0];
}

export async function getLeadByMetaId(metaLeadId: string): Promise<Lead | undefined> {
  const rows = await sql<Lead[]>`
    SELECT * FROM swell_leads WHERE meta_lead_id = ${metaLeadId}
  `;
  return rows[0];
}

export async function insertLead(
  values: Omit<Lead, "id" | "created_at" | "sms_alert_sent" | "sms_alert_sent_at" | "discord_thread_id" | "lead_score" | "repeat_probability">
): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO swell_leads
      (tenant_id, meta_lead_id, meta_page_id, meta_form_id, meta_campaign_id, meta_adset_id, meta_ad_id,
       full_name, phone, email, address, city, state, zip, raw_payload, status, notes)
     VALUES (${values.tenant_id}, ${values.meta_lead_id}, ${values.meta_page_id}, ${values.meta_form_id},
             ${values.meta_campaign_id}, ${values.meta_adset_id}, ${values.meta_ad_id},
             ${values.full_name}, ${values.phone}, ${values.email}, ${values.address},
             ${values.city}, ${values.state}, ${values.zip}, ${(values.raw_payload) as any}, ${values.status},
             ${values.notes})
     RETURNING id
  `;
  return rows[0].id;
}

export async function markSmsSent(leadId: number): Promise<void> {
  await sql`
    UPDATE swell_leads SET sms_alert_sent = TRUE, sms_alert_sent_at = NOW() WHERE id = ${leadId}
  `;
}

export async function updateLeadStatus(
  tenantId: string,
  leadId: number,
  status: string,
  notes?: string | null
): Promise<void> {
  await sql`
    UPDATE swell_leads 
    SET status = ${status}, notes = COALESCE(${notes ?? null}, notes)
    WHERE id = ${leadId} AND tenant_id = ${tenantId}
  `;
}

// ─── Activity ──────────────────────────────────────────────────────────────────

export interface ActivityEntry {
  id: number;
  lead_id: number;
  tenant_id: string;
  type: string;
  direction: string | null;
  body: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export async function listActivityForLead(tenantId: string, leadId: number): Promise<ActivityEntry[]> {
  return sql<ActivityEntry[]>`
    SELECT * FROM swell_lead_activity
    WHERE lead_id = ${leadId} AND tenant_id = ${tenantId}
    ORDER BY created_at DESC
  `;
}

export async function getLeadActivity(tenantId: string, leadId: number): Promise<ActivityEntry[]> {
  return listActivityForLead(tenantId, leadId);
}

export async function logActivity(values: {
  lead_id: number;
  tenant_id: string;
  type: string;
  direction?: string | null;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  await sql`
    INSERT INTO swell_lead_activity (lead_id, tenant_id, type, direction, body, metadata)
    VALUES (${values.lead_id}, ${values.tenant_id}, ${values.type}, ${values.direction ?? null},
            ${values.body ?? null}, ${(values.metadata ?? null) as any})
  `;
}

// ─── AI config ─────────────────────────────────────────────────────────────────

export interface AIConfig {
  tenant_id: string;
  enabled: boolean;
  model_primary: string;
  model_classifier: string;
  persona_name: string;
  business_name: string | null;
  services_json: unknown[];
  pricing_matrix: Record<string, unknown>;
  route_cities_json: unknown[];
  transport_waive: number;
  review_discount: number;
  business_hours_json: Record<string, unknown>;
  max_msgs_per_lead: number;
  max_tokens_per_msg: number;
  custom_brand_notes: string | null;
  pricing_locked: boolean;
  learned_notes: string | null;
  mode: string; // 'closer' (default) | 'receptionist'
  created_at: string;
  updated_at: string;
}

export async function getAIConfig(tenantId: string): Promise<AIConfig | undefined> {
  const rows = await sql<AIConfig[]>`
    SELECT * FROM swell_ai_configs WHERE tenant_id = ${tenantId}
  `;
  return rows[0];
}

export async function upsertAIConfig(
  c: Partial<AIConfig> & { tenant_id: string }
): Promise<void> {
  await sql`
    INSERT INTO swell_ai_configs
      (tenant_id, enabled, model_primary, model_classifier, persona_name, business_name,
       services_json, pricing_matrix, route_cities_json, transport_waive, review_discount, business_hours_json,
       max_msgs_per_lead, max_tokens_per_msg, custom_brand_notes, pricing_locked, learned_notes, updated_at)
     VALUES (${c.tenant_id}, ${c.enabled ?? true}, ${c.model_primary ?? "claude-sonnet-4-6"},
             ${c.model_classifier ?? "claude-haiku-4-5"}, ${c.persona_name ?? "Hayden"}, ${c.business_name ?? null},
             ${(c.services_json ?? []) as any}, ${(c.pricing_matrix ?? {}) as any}, ${(c.route_cities_json ?? []) as any},
             ${c.transport_waive ?? 50}, ${c.review_discount ?? 20}, ${(c.business_hours_json ?? {}) as any},
             ${c.max_msgs_per_lead ?? 30}, ${c.max_tokens_per_msg ?? 700}, ${c.custom_brand_notes ?? null},
             ${c.pricing_locked ?? true}, ${c.learned_notes ?? null}, NOW())
     ON CONFLICT(tenant_id) DO UPDATE SET
       enabled=excluded.enabled, model_primary=excluded.model_primary, model_classifier=excluded.model_classifier,
       persona_name=excluded.persona_name, business_name=excluded.business_name,
       services_json=excluded.services_json, pricing_matrix=excluded.pricing_matrix,
       route_cities_json=excluded.route_cities_json, transport_waive=excluded.transport_waive,
       review_discount=excluded.review_discount, business_hours_json=excluded.business_hours_json,
       max_msgs_per_lead=excluded.max_msgs_per_lead, max_tokens_per_msg=excluded.max_tokens_per_msg,
       custom_brand_notes=excluded.custom_brand_notes, pricing_locked=excluded.pricing_locked,
       learned_notes=excluded.learned_notes,
       updated_at=CURRENT_TIMESTAMP
  `;
}

// ─── Conversations ────────────────────────────────────────────────────────────

export interface Conversation {
  id: number;
  tenant_id: string;
  lead_id: number;
  status: string;
  handoff_reason: string | null;
  last_message_at: string | null;
  last_role: string | null;
  total_messages: number;
  total_tokens_in: number;
  total_tokens_out: number;
  total_cost_cents: number;
  quoted_price_cents: number | null;
  discount_applied: boolean;
  discord_thread_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function getConversationByLeadId(leadId: number): Promise<Conversation | undefined> {
  const rows = await sql<Conversation[]>`
    SELECT * FROM swell_conversations WHERE lead_id = ${leadId}
  `;
  return rows[0];
}

export async function getConversationById(id: number): Promise<Conversation | undefined> {
  const rows = await sql<Conversation[]>`
    SELECT * FROM swell_conversations WHERE id = ${id}
  `;
  return rows[0];
}

export async function getOrCreateConversation(
  tenantId: string,
  leadId: number
): Promise<Conversation> {
  const existing = await getConversationByLeadId(leadId);
  if (existing) return existing;
  
  const rows = await sql<Conversation[]>`
    INSERT INTO swell_conversations (tenant_id, lead_id, status)
    VALUES (${tenantId}, ${leadId}, 'active')
    RETURNING *
  `;
  return rows[0];
}

export async function updateConversation(id: number, patch: Partial<Conversation>): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  
  // Build dynamic update clause
  const updates: Record<string, unknown> = { ...patch, id };
  const setClause = Object.keys(patch)
    .filter((k) => k !== "id" && k !== "created_at")
    .map((k) => {
      const key = k as keyof Conversation;
      return sql.unsafe(`${k} = ${sql.unsafe("$" + (Object.keys(updates).indexOf(key) + 1))}`);
    })
    .join(", ");

  // Use simpler approach: just update the fields we care about
  const fields = Object.keys(patch)
    .filter((k) => k !== "id" && k !== "created_at" && patch[k as keyof Conversation] !== undefined);
  if (fields.length === 0) return;

  // Rebuild with safer approach
  const updateValues = fields.map((f) => {
    const val = patch[f as keyof Conversation];
    return val !== undefined ? val : null;
  });
  
  const fieldsStr = fields.map((f) => `${f} = $${fields.indexOf(f) + 1}`).join(", ");
  await sql.unsafe(
    `UPDATE swell_conversations SET ${fieldsStr}, updated_at = NOW() WHERE id = $${fields.length + 1}`,
    [...updateValues, id]
  );
}

export async function listConversations(tenantId: string): Promise<Conversation[]> {
  return await sql<Conversation[]>`
    SELECT * FROM swell_conversations WHERE tenant_id = ${tenantId} ORDER BY updated_at DESC
  `;
}

export async function findConversationByPhone(
  tenantId: string,
  phone: string
): Promise<Conversation | undefined> {
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length < 7) return undefined;
  
  const rows = await sql<Conversation[]>`
    SELECT c.* FROM swell_conversations c
    JOIN swell_leads l ON l.id = c.lead_id
    WHERE c.tenant_id = ${tenantId}
      AND REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g') LIKE ${'%' + digits + '%'}
    ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
    LIMIT 1
  `;
  return rows[0];
}

// ─── Conversation messages ────────────────────────────────────────────────────

export interface ConversationMessage {
  id: number;
  conversation_id: number;
  tenant_id: string;
  role: string;
  body: string;
  twilio_sid: string | null;
  model_used: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_cents: number | null;
  error: string | null;
  created_at: string;
}

export async function listConversationMessages(conversationId: number): Promise<ConversationMessage[]> {
  return await sql<ConversationMessage[]>`
    SELECT * FROM swell_conversation_messages WHERE conversation_id = ${conversationId} ORDER BY id ASC
  `;
}

export async function insertConversationMessage(
  values: Omit<ConversationMessage, "id" | "created_at">
): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO swell_conversation_messages
      (conversation_id, tenant_id, role, body, twilio_sid, model_used, tokens_in, tokens_out, cost_cents, error)
     VALUES (${values.conversation_id}, ${values.tenant_id}, ${values.role}, ${values.body},
             ${values.twilio_sid}, ${values.model_used}, ${values.tokens_in}, ${values.tokens_out},
             ${values.cost_cents}, ${values.error})
     RETURNING id
  `;
  const msgId = rows[0].id;

  // Discord mirroring is now handled explicitly by conversation.ts via mirrorSmsToThread()
  // This avoids double-posting and allows proper sender labeling (Lead vs Customer vs Hayden)

  return msgId;
}

// ─── Nurture jobs ────────────────────────────────────────────────────────────

export interface NurtureJob {
  id: number;
  tenant_id: string;
  lead_id: number;
  conversation_id: number | null;
  kind: string;
  fire_at: string;
  fired_at: string | null;
  status: string;
  payload: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
}

export async function scheduleNurture(
  values: Omit<NurtureJob, "id" | "fired_at" | "status" | "error" | "created_at"> & { status?: string }
): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO swell_nurture_jobs (tenant_id, lead_id, conversation_id, kind, fire_at, status, payload)
    VALUES (${values.tenant_id}, ${values.lead_id}, ${values.conversation_id ?? null}, ${values.kind},
            ${values.fire_at}, ${values.status ?? "scheduled"}, ${(values.payload ?? null) as any})
    RETURNING id
  `;
  return rows[0].id;
}

export async function getDueNurtureJobs(limit = 50): Promise<NurtureJob[]> {
  return await sql<NurtureJob[]>`
    SELECT * FROM swell_nurture_jobs
    WHERE status = 'scheduled' AND fire_at <= NOW()
    ORDER BY fire_at ASC
    LIMIT ${limit}
  `;
}

export async function markNurtureJobFired(id: number, ok: boolean, error?: string | null): Promise<void> {
  await sql`
    UPDATE swell_nurture_jobs
    SET status = ${ok ? "fired" : "failed"}, fired_at = NOW(), error = ${error ?? null}
    WHERE id = ${id}
  `;
}

export async function cancelOpenNurtureForLead(leadId: number, exceptId?: number): Promise<void> {
  if (exceptId !== undefined) {
    await sql`
      UPDATE swell_nurture_jobs SET status = 'cancelled'
      WHERE lead_id = ${leadId} AND status = 'scheduled' AND id != ${exceptId}
    `;
  } else {
    await sql`
      UPDATE swell_nurture_jobs SET status = 'cancelled'
      WHERE lead_id = ${leadId} AND status = 'scheduled'
    `;
  }
}

// ─── DNC ────────────────────────────────────────────────────────────────────

export async function isOnDNC(tenantId: string, phone: string): Promise<boolean> {
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length < 7) return false;
  
  const rows = await sql<{ count: number }[]>`
    SELECT COUNT(*)::INT as count FROM swell_dnc_phones
    WHERE tenant_id = ${tenantId}
      AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE ${'%' + digits + '%'}
    LIMIT 1
  `;
  return (rows[0]?.count ?? 0) > 0;
}

export async function addToDNC(tenantId: string, phone: string, reason?: string): Promise<void> {
  await sql`
    INSERT INTO swell_dnc_phones (tenant_id, phone, reason)
    VALUES (${tenantId}, ${phone}, ${reason ?? null})
    ON CONFLICT DO NOTHING
  `;
}

// ─── Calendar tokens ────────────────────────────────────────────────────────

export interface CalendarToken {
  tenant_id: string;
  access_token: string;
  refresh_token: string;
  token_expiry: string;
  calendar_id: string | null;
  calendar_name: string | null;
  connected_at: string;
  updated_at: string;
}

export async function saveCalendarTokens(
  tenantId: string,
  accessToken: string,
  refreshToken: string,
  expiryMs: number,
  calendarId?: string | null,
  calendarName?: string | null
): Promise<void> {
  const expiry = new Date(expiryMs).toISOString();
  await sql`
    INSERT INTO swell_calendar_tokens
      (tenant_id, access_token, refresh_token, token_expiry, calendar_id, calendar_name)
    VALUES (${tenantId}, ${accessToken}, ${refreshToken}, ${expiry}, ${calendarId ?? null}, ${calendarName ?? null})
    ON CONFLICT(tenant_id) DO UPDATE SET
      access_token=excluded.access_token,
      refresh_token=excluded.refresh_token,
      token_expiry=excluded.token_expiry,
      calendar_id=COALESCE(excluded.calendar_id, swell_calendar_tokens.calendar_id),
      calendar_name=COALESCE(excluded.calendar_name, swell_calendar_tokens.calendar_name),
      updated_at=NOW()
  `;
}

export async function getCalendarTokens(tenantId: string): Promise<CalendarToken | undefined> {
  const rows = await sql<CalendarToken[]>`
    SELECT * FROM swell_calendar_tokens WHERE tenant_id = ${tenantId}
  `;
  return rows[0];
}

// ─── Blocked dates ──────────────────────────────────────────────────────────

export interface BlockedDate {
  id: number;
  tenant_id: string;
  date: string;
  reason: string | null;
  created_at: string;
}

export async function getBlockedDates(tenantId: string): Promise<BlockedDate[]> {
  return sql<BlockedDate[]>`
    SELECT * FROM swell_blocked_dates WHERE tenant_id = ${tenantId} ORDER BY date ASC
  `;
}

export async function addBlockedDate(tenantId: string, date: string, reason?: string): Promise<void> {
  await sql`
    INSERT INTO swell_blocked_dates (tenant_id, date, reason)
    VALUES (${tenantId}, ${date}, ${reason ?? null})
    ON CONFLICT DO NOTHING
  `;
}

export async function removeBlockedDate(tenantId: string, date: string): Promise<void> {
  await sql`
    DELETE FROM swell_blocked_dates WHERE tenant_id = ${tenantId} AND date = ${date}
  `;
}

export async function getAvailableDays(
  tenantId: string,
  daysAhead = 14
): Promise<{ date: string; status: "available" | "blocked" | "busy" }[]> {
  // Get blocked dates
  const blocked = await sql<{ date: string }[]>`
    SELECT DISTINCT date FROM swell_blocked_dates WHERE tenant_id = ${tenantId}
  `;

  // For now, return simple availability (no calendar integration yet)
  const result: { date: string; status: "available" | "blocked" | "busy" }[] = [];
  const today = new Date();
  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split("T")[0];
    const isBlocked = blocked.some((b) => b.date === dateStr);
    result.push({
      date: dateStr,
      status: (isBlocked ? "blocked" : "available") as "available" | "blocked" | "busy",
    });
  }
  return result;
}

// ─── KPI rollups (fast, indexed scans) ───────────────────────────────────────

export async function getTenantKpis(tenantId: string) {
  const rows = await sql<
    {
      total_leads: number;
      leads_new: number;
      leads_contacted: number;
      leads_quoted: number;
      leads_sold: number;
      leads_lost: number;
      leads_24h: number;
      leads_7d: number;
      leads_30d: number;
    }[]
  >`
    SELECT
      COUNT(*)::INT as total_leads,
      SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END)::INT as leads_new,
      SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END)::INT as leads_contacted,
      SUM(CASE WHEN status = 'quoted' THEN 1 ELSE 0 END)::INT as leads_quoted,
      SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END)::INT as leads_sold,
      SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END)::INT as leads_lost,
      SUM(CASE WHEN created_at >= NOW() - INTERVAL '1 day' THEN 1 ELSE 0 END)::INT as leads_24h,
      SUM(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::INT as leads_7d,
      SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 ELSE 0 END)::INT as leads_30d
    FROM swell_leads
    WHERE tenant_id = ${tenantId}
  `;

  const totals = rows[0];
  return {
    totalLeads: totals?.total_leads ?? 0,
    leadsNew: totals?.leads_new ?? 0,
    leadsContacted: totals?.leads_contacted ?? 0,
    leadsQuoted: totals?.leads_quoted ?? 0,
    leadsSold: totals?.leads_sold ?? 0,
    leadsLost: totals?.leads_lost ?? 0,
    leads24h: totals?.leads_24h ?? 0,
    leads7d: totals?.leads_7d ?? 0,
    leads30d: totals?.leads_30d ?? 0,
  };
}

// ─── Schedule config ────────────────────────────────────────────────────

export interface ScheduleConfig {
  tenant_id: string;
  timezone: string;
  work_days: number[];
  work_start: string;
  work_end: string;
  max_jobs_per_day: number;
  avg_job_hours: number;
  buffer_mins: number;
  service_cities: string[];
  updated_at: string;
}

export async function getScheduleConfig(tenantId: string): Promise<ScheduleConfig | undefined> {
  const rows = await sql<ScheduleConfig[]>`SELECT * FROM swell_schedule_configs WHERE tenant_id = ${tenantId}`;
  return rows[0];
}

export async function upsertScheduleConfig(c: Partial<ScheduleConfig> & { tenant_id: string }): Promise<void> {
  await sql`
    INSERT INTO swell_schedule_configs
      (tenant_id, timezone, work_days, work_start, work_end, max_jobs_per_day, avg_job_hours, buffer_mins, service_cities, updated_at)
    VALUES (${c.tenant_id}, ${c.timezone ?? 'America/New_York'}, ${c.work_days ?? [1,2,3,4,5,6]},
            ${c.work_start ?? '08:00'}, ${c.work_end ?? '18:00'}, ${c.max_jobs_per_day ?? 3},
            ${c.avg_job_hours ?? 2.0}, ${c.buffer_mins ?? 30}, ${c.service_cities ?? []}, NOW())
    ON CONFLICT(tenant_id) DO UPDATE SET
      timezone=excluded.timezone, work_days=excluded.work_days, work_start=excluded.work_start,
      work_end=excluded.work_end, max_jobs_per_day=excluded.max_jobs_per_day,
      avg_job_hours=excluded.avg_job_hours, buffer_mins=excluded.buffer_mins,
      service_cities=excluded.service_cities, updated_at=NOW()
  `;
}

// ─── Appointments ──────────────────────────────────────────────────────

export interface Appointment {
  id: number;
  tenant_id: string;
  lead_id: number;
  conversation_id: number | null;
  status: string;
  scheduled_date: string;
  scheduled_time: string | null;
  duration_hours: number;
  service_summary: string | null;
  quoted_price_cents: number | null;
  preferred_day: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function listAppointments(tenantId: string, fromDate?: string, toDate?: string): Promise<Appointment[]> {
  if (fromDate && toDate) {
    return sql<Appointment[]>`
      SELECT * FROM swell_appointments
      WHERE tenant_id = ${tenantId} AND scheduled_date BETWEEN ${fromDate} AND ${toDate}
      ORDER BY scheduled_date ASC, scheduled_time ASC NULLS LAST
    `;
  }
  return sql<Appointment[]>`
    SELECT * FROM swell_appointments WHERE tenant_id = ${tenantId}
    ORDER BY scheduled_date ASC, scheduled_time ASC NULLS LAST
  `;
}

export async function createAppointment(a: Omit<Appointment, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO swell_appointments
      (tenant_id, lead_id, conversation_id, status, scheduled_date, scheduled_time,
       duration_hours, service_summary, quoted_price_cents, preferred_day, notes)
    VALUES (${a.tenant_id}, ${a.lead_id}, ${a.conversation_id ?? null}, ${a.status},
            ${a.scheduled_date}, ${a.scheduled_time ?? null}, ${a.duration_hours ?? 2.0},
            ${a.service_summary ?? null}, ${a.quoted_price_cents ?? null},
            ${a.preferred_day ?? null}, ${a.notes ?? null})
    RETURNING id
  `;
  return rows[0].id;
}

export async function updateAppointment(id: number, tenantId: string, patch: Partial<Appointment>): Promise<void> {
  await sql`
    UPDATE swell_appointments SET
      status = COALESCE(${patch.status ?? null}, status),
      scheduled_date = COALESCE(${patch.scheduled_date ?? null}, scheduled_date),
      scheduled_time = COALESCE(${patch.scheduled_time ?? null}, scheduled_time),
      notes = COALESCE(${patch.notes ?? null}, notes),
      updated_at = NOW()
    WHERE id = ${id} AND tenant_id = ${tenantId}
  `;
}

export async function countAppointmentsOnDate(tenantId: string, date: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT COUNT(*) as count FROM swell_appointments
    WHERE tenant_id = ${tenantId} AND scheduled_date = ${date}
      AND status NOT IN ('cancelled', 'no_show')
  `;
  return parseInt(rows[0]?.count ?? '0', 10);
}

// ─── Phase 2: Review & Reputation Engine ─────────────────────────────────────

// ─── Owner settings ────────────────────────────────────────────────────────────

export async function updateTenantOwner(tenantId: string, patch: {
  owner_name?: string;
  owner_phone?: string;
  owner_phone_verified?: boolean;
  owner_phone_pending?: string | null;
  google_review_url?: string | null;
  eod_offset_hours?: number;
}): Promise<void> {
  if (patch.owner_name !== undefined)
    await sql`UPDATE swell_tenants SET owner_name = ${patch.owner_name} WHERE id = ${tenantId}`;
  if (patch.owner_phone !== undefined)
    await sql`UPDATE swell_tenants SET owner_phone = ${patch.owner_phone} WHERE id = ${tenantId}`;
  if (patch.owner_phone_verified !== undefined)
    await sql`UPDATE swell_tenants SET owner_phone_verified = ${patch.owner_phone_verified} WHERE id = ${tenantId}`;
  if (patch.owner_phone_pending !== undefined)
    await sql`UPDATE swell_tenants SET owner_phone_pending = ${patch.owner_phone_pending} WHERE id = ${tenantId}`;
  if (patch.google_review_url !== undefined)
    await sql`UPDATE swell_tenants SET google_review_url = ${patch.google_review_url} WHERE id = ${tenantId}`;
  if (patch.eod_offset_hours !== undefined)
    await sql`UPDATE swell_tenants SET eod_offset_hours = ${patch.eod_offset_hours} WHERE id = ${tenantId}`;
}

// ─── Phone verification ───────────────────────────────────────────────────────

export async function createPhoneVerification(tenantId: string, phone: string, code: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await sql`
    INSERT INTO swell_phone_verifications (tenant_id, phone, code, expires_at)
    VALUES (${tenantId}, ${phone}, ${code}, ${expiresAt})
  `;
}

export async function verifyPhoneCode(tenantId: string, phone: string, code: string): Promise<boolean> {
  const rows = await sql<{ id: number }[]>`
    SELECT id FROM swell_phone_verifications
    WHERE tenant_id = ${tenantId} AND phone = ${phone} AND code = ${code}
      AND used = false AND expires_at > NOW()
    LIMIT 1
  `;
  if (!rows.length) return false;
  await sql`UPDATE swell_phone_verifications SET used = true WHERE id = ${rows[0].id}`;
  return true;
}

// ─── EOD checks ──────────────────────────────────────────────────────────────

export async function createEodCheck(tenantId: string, checkDate: string): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO swell_eod_checks (tenant_id, check_date)
    VALUES (${tenantId}, ${checkDate})
    ON CONFLICT (tenant_id, check_date) DO NOTHING
    RETURNING id
  `;
  return rows[0]?.id ?? 0;
}

export async function getPendingEodCheck(tenantId: string): Promise<{ id: number; check_date: string } | undefined> {
  const rows = await sql<{ id: number; check_date: string }[]>`
    SELECT id, check_date FROM swell_eod_checks
    WHERE tenant_id = ${tenantId} AND status = 'sent'
    ORDER BY check_date DESC LIMIT 1
  `;
  return rows[0];
}

export async function resolveEodCheck(id: number, rawResponse: string): Promise<void> {
  await sql`
    UPDATE swell_eod_checks
    SET status = 'responded', responded_at = NOW(), raw_response = ${rawResponse}
    WHERE id = ${id}
  `;
}

export async function markEodCheckProcessed(id: number): Promise<void> {
  await sql`UPDATE swell_eod_checks SET status = 'processed', processed_at = NOW() WHERE id = ${id}`;
}

// ─── Review follows ───────────────────────────────────────────────────────────

export interface ReviewFollow {
  id: number;
  tenant_id: string;
  lead_id: number;
  appointment_id: number;
  status: string;
  follow_up_phone: string | null;
  sent_at: string | null;
  replied_at: string | null;
  reply_text: string | null;
  sentiment_score: number | null;
  sentiment_confidence: number | null;
  route_taken: string | null;
  review_link_sent_at: string | null;
  feedback_link_sent_at: string | null;
  feedback_token: string;
  nudge_sent_at: string | null;
  created_at: string;
}

export async function createReviewFollow(rf: Omit<ReviewFollow, 'id' | 'created_at' | 'feedback_token' | 'status' | 'sent_at' | 'replied_at' | 'reply_text' | 'sentiment_score' | 'sentiment_confidence' | 'route_taken' | 'review_link_sent_at' | 'feedback_link_sent_at' | 'nudge_sent_at'>): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO swell_review_follows (tenant_id, lead_id, appointment_id, follow_up_phone)
    VALUES (${rf.tenant_id}, ${rf.lead_id}, ${rf.appointment_id}, ${rf.follow_up_phone ?? null})
    RETURNING id
  `;
  return rows[0].id;
}

export async function getPendingReviewFollow(tenantId: string, phone: string): Promise<ReviewFollow | undefined> {
  const normalized = phone.replace(/\D/g, '').replace(/^1/, '');
  const rows = await sql<ReviewFollow[]>`
    SELECT rf.* FROM swell_review_follows rf
    WHERE rf.tenant_id = ${tenantId}
      AND rf.status = 'sent'
      AND regexp_replace(rf.follow_up_phone, '[^0-9]', '', 'g') LIKE ${'%' + normalized}
    ORDER BY rf.sent_at DESC LIMIT 1
  `;
  return rows[0];
}

export async function updateReviewFollow(id: number, patch: Partial<ReviewFollow>): Promise<void> {
  if (patch.status !== undefined)
    await sql`UPDATE swell_review_follows SET status = ${patch.status} WHERE id = ${id}`;
  if (patch.sent_at !== undefined)
    await sql`UPDATE swell_review_follows SET sent_at = ${patch.sent_at} WHERE id = ${id}`;
  if (patch.replied_at !== undefined)
    await sql`UPDATE swell_review_follows SET replied_at = ${patch.replied_at} WHERE id = ${id}`;
  if (patch.reply_text !== undefined)
    await sql`UPDATE swell_review_follows SET reply_text = ${patch.reply_text} WHERE id = ${id}`;
  if (patch.sentiment_score !== undefined)
    await sql`UPDATE swell_review_follows SET sentiment_score = ${patch.sentiment_score} WHERE id = ${id}`;
  if (patch.sentiment_confidence !== undefined)
    await sql`UPDATE swell_review_follows SET sentiment_confidence = ${patch.sentiment_confidence} WHERE id = ${id}`;
  if (patch.route_taken !== undefined)
    await sql`UPDATE swell_review_follows SET route_taken = ${patch.route_taken} WHERE id = ${id}`;
  if (patch.review_link_sent_at !== undefined)
    await sql`UPDATE swell_review_follows SET review_link_sent_at = ${patch.review_link_sent_at} WHERE id = ${id}`;
  if (patch.feedback_link_sent_at !== undefined)
    await sql`UPDATE swell_review_follows SET feedback_link_sent_at = ${patch.feedback_link_sent_at} WHERE id = ${id}`;
  if (patch.nudge_sent_at !== undefined)
    await sql`UPDATE swell_review_follows SET nudge_sent_at = ${patch.nudge_sent_at} WHERE id = ${id}`;
}

export async function listReviewFollows(tenantId: string, limit = 100): Promise<ReviewFollow[]> {
  return sql<ReviewFollow[]>`
    SELECT * FROM swell_review_follows WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC LIMIT ${limit}
  `;
}

export async function getReviewFollowByToken(token: string): Promise<ReviewFollow | undefined> {
  const rows = await sql<ReviewFollow[]>`
    SELECT * FROM swell_review_follows WHERE feedback_token = ${token} LIMIT 1
  `;
  return rows[0];
}

// ─── Lead scoring ─────────────────────────────────────────────────────────────

export async function updateLeadScore(tenantId: string, leadId: number, delta: number, satisfactionScore?: number): Promise<void> {
  await sql`
    UPDATE swell_leads
    SET lead_score = GREATEST(0, LEAST(100, COALESCE(lead_score, 50) + ${delta})),
        satisfaction_score = COALESCE(${satisfactionScore ?? null}, satisfaction_score),
        repeat_probability = CASE
          WHEN GREATEST(0, LEAST(100, COALESCE(lead_score, 50) + ${delta})) >= 75 THEN 'hot'
          WHEN GREATEST(0, LEAST(100, COALESCE(lead_score, 50) + ${delta})) >= 45 THEN 'warm'
          ELSE 'cold'
        END
    WHERE id = ${leadId} AND tenant_id = ${tenantId}
  `;
}

// ─── Users (Team Members) ──────────────────────────────────────────────────────

export interface SwellUser {
  id: number;
  tenant_id: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  enabled: boolean;
  last_login_at: string | null;
  created_at: string;
}

export async function listUsers(tenantId: string): Promise<Omit<SwellUser, 'password_hash'>[]> {
  return sql<Omit<SwellUser, 'password_hash'>[]>`
    SELECT id, tenant_id, name, email, role, enabled, last_login_at, created_at
    FROM swell_users WHERE tenant_id = ${tenantId} ORDER BY created_at ASC
  `;
}

export async function getUserByEmail(tenantId: string, email: string): Promise<SwellUser | undefined> {
  const rows = await sql<SwellUser[]>`
    SELECT * FROM swell_users WHERE tenant_id = ${tenantId} AND email = ${email} AND enabled = true LIMIT 1
  `;
  return rows[0];
}

export async function createUser(u: { tenant_id: string; name: string; email: string; password_hash: string; role: string }): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO swell_users (tenant_id, name, email, password_hash, role)
    VALUES (${u.tenant_id}, ${u.name}, ${u.email}, ${u.password_hash}, ${u.role})
    RETURNING id
  `;
  return rows[0].id;
}

export async function updateUser(id: number, tenantId: string, patch: { name?: string; role?: string; enabled?: boolean; password_hash?: string }): Promise<void> {
  if (patch.name !== undefined) await sql`UPDATE swell_users SET name = ${patch.name} WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (patch.role !== undefined) await sql`UPDATE swell_users SET role = ${patch.role} WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (patch.enabled !== undefined) await sql`UPDATE swell_users SET enabled = ${patch.enabled} WHERE id = ${id} AND tenant_id = ${tenantId}`;
  if (patch.password_hash !== undefined) await sql`UPDATE swell_users SET password_hash = ${patch.password_hash} WHERE id = ${id} AND tenant_id = ${tenantId}`;
}

export async function markUserLogin(id: number): Promise<void> {
  await sql`UPDATE swell_users SET last_login_at = NOW() WHERE id = ${id}`;
}

// ─── Customers ──────────────────────────────────────────────────────────────────

export interface Customer {
  id: number;
  tenant_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  tags: string[];
  notes: string | null;
  lead_score: number;
  lifetime_value_cents: number;
  job_count: number;
  last_job_at: string | null;
  source: string | null;
  repeat_probability: string;
  created_at: string;
  updated_at: string;
}

export async function findOrCreateCustomer(tenantId: string, opts: {
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  source?: string;
}): Promise<number> {
  const norm = (p?: string | null) => (p ?? "").replace(/\D/g, "").slice(-10);
  
  // Try match by phone first, then email
  if (opts.phone) {
    const phoneNorm = norm(opts.phone);
    const existing = await sql<{ id: number }[]>`
      SELECT id FROM swell_customers
      WHERE tenant_id = ${tenantId}
        AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE ${'%' + phoneNorm}
      LIMIT 1
    `;
    if (existing.length) {
      // Update with any new info
      await sql`
        UPDATE swell_customers SET
          full_name = COALESCE(${opts.name ?? null}, full_name),
          email = COALESCE(${opts.email ?? null}, email),
          address = COALESCE(${opts.address ?? null}, address),
          city = COALESCE(${opts.city ?? null}, city),
          state = COALESCE(${opts.state ?? null}, state),
          zip = COALESCE(${opts.zip ?? null}, zip),
          updated_at = NOW()
        WHERE id = ${existing[0].id}
      `;
      return existing[0].id;
    }
  }

  if (opts.email && !opts.phone) {
    const existing = await sql<{ id: number }[]>`
      SELECT id FROM swell_customers
      WHERE tenant_id = ${tenantId} AND lower(email) = ${(opts.email ?? "").toLowerCase()}
      LIMIT 1
    `;
    if (existing.length) return existing[0].id;
  }

  // Create new customer
  const rows = await sql<{ id: number }[]>`
    INSERT INTO swell_customers
      (tenant_id, full_name, phone, email, address, city, state, zip, source)
    VALUES
      (${tenantId}, ${opts.name ?? null}, ${opts.phone ?? null}, ${opts.email ?? null},
       ${opts.address ?? null}, ${opts.city ?? null}, ${opts.state ?? null}, ${opts.zip ?? null},
       ${opts.source ?? 'unknown'})
    RETURNING id
  `;
  const newId = rows[0].id;

  // Auto-geocode new customers with an address — fire-and-forget
  if (opts.address || opts.city) {
    import("../services/geocoder.js").then(async ({ geocodeAddress }) => {
      const geo = await geocodeAddress(opts.address ?? null, opts.city ?? null, opts.state ?? null, opts.zip ?? null);
      if (geo) {
        await sql`UPDATE swell_customers SET address_lat=${geo.lat}, address_lon=${geo.lon}, geocoded_at=NOW() WHERE id=${newId}`.catch(() => {});
      }
    }).catch(() => {});
  }

  return newId;
}

export async function getCustomer(tenantId: string, customerId: number): Promise<Customer | undefined> {
  const rows = await sql<Customer[]>`
    SELECT * FROM swell_customers WHERE id = ${customerId} AND tenant_id = ${tenantId} LIMIT 1
  `;
  return rows[0];
}

export async function listCustomers(tenantId: string, limit = 200): Promise<Customer[]> {
  return sql<Customer[]>`
    SELECT * FROM swell_customers WHERE tenant_id = ${tenantId}
    ORDER BY updated_at DESC LIMIT ${limit}
  `;
}

export async function updateCustomer(id: number, tenantId: string, patch: Partial<Customer>): Promise<void> {
  const fields = ['full_name','phone','email','address','city','state','zip','tags','notes','lead_score','lifetime_value_cents','job_count'] as const;
  for (const field of fields) {
    if (patch[field] !== undefined) {
      await sql`UPDATE swell_customers SET ${sql.unsafe(field)} = ${(patch as any)[field]}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId}`;
    }
  }
}

export async function getCustomerActivity(tenantId: string, customerId: number): Promise<{
  leads: any[];
  calls: any[];
  appointments: any[];
  reviews: any[];
  conversations: any[];
}> {
  const [leads, calls, appointments, reviews] = await Promise.all([
    sql`SELECT * FROM swell_leads WHERE customer_id = ${customerId} AND tenant_id = ${tenantId} ORDER BY created_at DESC`,
    sql`SELECT * FROM swell_calls WHERE customer_id = ${customerId} AND tenant_id = ${tenantId} ORDER BY created_at DESC`,
    sql`
      SELECT a.*, l.full_name as lead_name FROM swell_appointments a
      JOIN swell_leads l ON l.id = a.lead_id
      WHERE l.customer_id = ${customerId} AND a.tenant_id = ${tenantId}
      ORDER BY a.scheduled_date DESC
    `,
    sql`
      SELECT rf.*, l.full_name as lead_name FROM swell_review_follows rf
      JOIN swell_leads l ON l.id = rf.lead_id
      WHERE l.customer_id = ${customerId} AND rf.tenant_id = ${tenantId}
      ORDER BY rf.created_at DESC
    `,
  ]);

  // Get conversations via leads
  const leadIds = (leads as any[]).map((l: any) => l.id);
  const conversations = leadIds.length > 0 ? await sql`
    SELECT c.*, l.full_name FROM swell_conversations c
    JOIN swell_leads l ON l.id = c.lead_id
    WHERE c.lead_id = ANY(${leadIds}::bigint[]) AND c.tenant_id = ${tenantId}
    ORDER BY c.last_message_at DESC
  ` : [];

  return { leads: leads as any[], calls: calls as any[], appointments: appointments as any[], reviews: reviews as any[], conversations: conversations as any[] };
}
