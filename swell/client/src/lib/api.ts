/**
 * Tiny typed fetch helper. Cookies travel automatically (same-origin).
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    const err = new Error(`HTTP ${res.status}`) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface MePayload {
  tenant: {
    id: string;
    name: string;
    slug: string;
    brandColor: string;
    accentColor: string;
    logoUrl: string | null;
  };
  authenticated: boolean;
  role: string;
}

export interface LeadSummary {
  id: number;
  createdAt: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  status: string;
  notes: string | null;
  smsAlertSent: boolean;
  smsAlertSentAt: string | null;
  metaFormId: string | null;
  metaCampaignId: string | null;
  metaAdId: string | null;
  leadScore: number | null;
  repeatProbability: string | null;
  homeSqft: number | null;
  windowCount: number | null;
}

export interface LeadActivity {
  id: number;
  type: string;
  direction: string | null;
  body: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | string | null;
}

export interface ConversationMessageView {
  id: number;
  role: "assistant" | "user" | "system" | string;
  body: string;
  createdAt: string;
  modelUsed: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costCents: number | null;
  error: string | null;
}

export interface ConversationView {
  id: number;
  status: string;
  handoffReason: string | null;
  totalMessages: number;
  totalCostCents: number;
  quotedPriceCents: number | null;
  discountApplied: boolean;
  messages: ConversationMessageView[];
}

export interface ConversationListItem {
  id: number;
  leadId: number;
  leadName: string | null;
  leadPhone: string | null;
  status: string;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface ConversationThreadView {
  id: number;
  leadName: string | null;
  leadPhone: string | null;
  status: string;
  handoffReason: string | null;
  totalMessages: number;
  totalCostCents: number;
  messages: ConversationMessageView[];
}

export interface LeadDetail extends LeadSummary {
  metaLeadId: string;
  metaAdsetId: string | null;
  rawPayload: unknown;
  activity: LeadActivity[];
  conversation: ConversationView | null;
}

export interface KpiPayload {
  totalLeads: number;
  leadsNew: number;
  leadsContacted: number;
  leadsQuoted: number;
  leadsSold: number;
  leadsLost: number;
  leads24h: number;
  leads7d: number;
  leads30d: number;
}

// ─── Endpoints ─────────────────────────────────────────────────────────────────

export const api = {
  me: () => request<MePayload>("/api/me"),
  login: (password: string) =>
    request<{ ok: boolean; error?: string }>("/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ ok: boolean }>("/logout", { method: "POST" }),

  listLeads: () => request<LeadSummary[]>("/api/leads"),
  getLead: (id: number) => request<LeadDetail>(`/api/leads/${id}`),
  updateLead: (id: number, patch: { status?: string; notes?: string; full_name?: string; phone?: string; email?: string; address?: string; city?: string; state?: string; zip?: string; home_sqft?: number | null; window_count?: number | null }) =>
    request<{ id: number; status: string; notes: string | null }>(
      `/api/leads/${id}`,
      { method: "PATCH", body: JSON.stringify(patch) }
    ),

  kpis: () => request<KpiPayload>("/api/dashboard/kpis"),

  conversations: () => request<ConversationListItem[]>("/api/conversations"),
  conversationMessages: (id: number) => request<ConversationThreadView>(`/api/conversations/${id}/messages`),
  leadActivity: (id: number) => request<LeadActivity[]>(`/api/leads/${id}/activity`),

  // Messages API
  listMessages: () => request<Array<{
    id: number;
    lead_id: number;
    full_name: string | null;
    phone: string | null;
    status: string;
    last_message_body: string | null;
    last_message_role: string | null;
    last_message_time: string | null;
    created_at: string;
  }>>("/api/messages").then((msgs) =>
    msgs.map((m) => ({
      id: m.id,
      leadId: m.lead_id,
      leadName: m.full_name,
      leadPhone: m.phone,
      status: m.status,
      lastMessagePreview: m.last_message_body,
      lastMessageAt: m.last_message_time,
      createdAt: m.created_at,
    }))
  ),
  getThread: (convId: number) => request<ConversationThreadView>(`/api/messages/${convId}`),
  sendMessage: (convId: number, body: string) =>
    request<{ ok: boolean }>(`/api/messages/${convId}/send`, {
      method: "POST",
      body: JSON.stringify({ body }),
    }),
  startNewMessage: (payload: { phone?: string; leadId?: number; body: string }) =>
    request<{ ok: boolean; conversationId: number; leadId: number }>("/api/messages/new", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  searchLeads: (q: string) =>
    request<Array<{ id: number; full_name: string | null; phone: string | null; email: string | null }>>(
      `/api/leads/search?q=${encodeURIComponent(q)}`
    ),
  resumeAi: (convId: number) =>
    request<{ ok: boolean; previousStatus: string }>(`/api/messages/${convId}/resume-ai`, {
      method: "PATCH",
    }),
};
