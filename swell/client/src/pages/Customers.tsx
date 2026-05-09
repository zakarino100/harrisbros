import { useEffect, useState } from "react";
import { api, type MePayload } from "../lib/api";

// ── Types ────────────────────────────────────────────────────────────────────

interface Customer {
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
  home_sqft: number | null;
  window_count: number | null;
  created_at: string;
  updated_at: string;
}

interface CustomerProfile extends Customer {
  leads?: LeadSummary[];
  appointments?: Appointment[];
  conversations?: ConvSummary[];
  calls?: CallSummary[];
  reviews?: ReviewSummary[];
}

interface LeadSummary {
  id: number;
  status: string;
  full_name: string | null;
  phone: string | null;
  created_at: string;
  source?: string;
  notes?: string | null;
}

interface Appointment {
  id: number;
  status: string;
  scheduled_date: string;
  service_summary: string | null;
  quoted_price_cents: number | null;
}

interface ConvSummary {
  id: number;
  status: string;
  total_messages: number;
  quoted_price_cents: number | null;
  last_message_at: string | null;
}

interface CallSummary {
  id: number;
  from_phone: string | null;
  duration_seconds: number | null;
  created_at: string;
  summary?: string | null;
}

interface ReviewSummary {
  id: number;
  status: string;
  route_taken: string | null;
  created_at: string;
}

interface TimelineItem {
  _type: "activity" | "call" | "message";
  created_at: string;
  [key: string]: any;
}

interface Props { me: MePayload; }

// ── Profile tier logic ───────────────────────────────────────────────────────

type Tier = "ghost" | "prospect" | "customer" | "repeat";

function getTier(c: Customer): Tier {
  if (c.job_count >= 2 || (c.job_count >= 1 && c.lifetime_value_cents > 0 && c.repeat_probability === "hot")) return "repeat";
  if (c.job_count >= 1 || c.lifetime_value_cents > 0) return "customer";
  if (c.lead_score >= 40) return "prospect";
  return "ghost";
}

const TIER: Record<Tier, { emoji: string; label: string; listCls: string; badgeCls: string; dim: boolean }> = {
  ghost:    { emoji: "👻", label: "Ghost",    listCls: "opacity-60",  badgeCls: "bg-white/5 text-[var(--color-text-faint)] border border-white/10",                           dim: true  },
  prospect: { emoji: "💬", label: "Prospect", listCls: "",            badgeCls: "bg-[var(--color-gold)]/15 text-[var(--color-gold)] border border-[var(--color-gold)]/30",    dim: false },
  customer: { emoji: "✅", label: "Customer", listCls: "",            badgeCls: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",                              dim: false },
  repeat:   { emoji: "⭐", label: "Repeat",   listCls: "",            badgeCls: "bg-[var(--color-gold)]/25 text-[var(--color-gold)] border border-[var(--color-gold)]/50",    dim: false },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(cents: number) {
  return "$" + (cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtDate(iso: string, short = false) {
  return new Date(iso).toLocaleString("en-US", short
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const LEAD_STATUS_CLS: Record<string, string> = {
  new:           "bg-blue-500/15 text-blue-300 border-blue-500/30",
  contacted:     "bg-[var(--color-gold)]/15 text-[var(--color-gold)] border-[var(--color-gold)]/30",
  quoted:        "bg-purple-500/15 text-purple-300 border-purple-500/30",
  sold:          "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  lost:          "bg-red-500/15 text-red-400 border-red-500/30",
  no_answer:     "bg-white/5 text-[var(--color-text-faint)] border-white/10",
  not_interested:"bg-red-500/10 text-red-400/70 border-red-500/20",
};

const APPT_STATUS_CLS: Record<string, string> = {
  pending:   "bg-[var(--color-gold)]/15 text-[var(--color-gold)] border-[var(--color-gold)]/30",
  confirmed: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  completed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  cancelled: "bg-red-500/15 text-red-400 border-red-500/30",
  no_show:   "bg-red-500/10 text-red-400/70 border-red-500/20",
};

// ── Component ────────────────────────────────────────────────────────────────

export function Customers({ me }: Props) {
  const [customers, setCustomers]             = useState<Customer[]>([]);
  const [profile, setProfile]                 = useState<CustomerProfile | null>(null);
  const [timeline, setTimeline]               = useState<TimelineItem[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [profileLoading, setProfileLoading]   = useState(false);
  const [error, setError]                     = useState<string | null>(null);
  const [search, setSearch]                   = useState("");
  const [tierFilter, setTierFilter]           = useState<Tier | "all">("all");
  const [editField, setEditField]             = useState<string | null>(null);
  const [editValue, setEditValue]             = useState("");
  const [expandedLead, setExpandedLead]       = useState<number | null>(null);
  const [leadEdits, setLeadEdits]             = useState<Record<number, { status: string; notes: string }>>({});
  const [leadSaving, setLeadSaving]           = useState<number | null>(null);

  async function fetchList() {
    try {
      setLoading(true);
      const res = await fetch("/api/customers", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch customers");
      setCustomers(await res.json() || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function openProfile(id: number) {
    setProfile(null);
    setTimeline([]);
    setProfileLoading(true);
    setEditField(null);
    try {
      const [cRes, tRes] = await Promise.all([
        fetch(`/api/customers/${id}`, { credentials: "include" }),
        fetch(`/api/customers/${id}/timeline`, { credentials: "include" }),
      ]);
      if (!cRes.ok) throw new Error("Not found");
      setProfile(await cRes.json());
      if (tRes.ok) setTimeline((await tRes.json()) || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setProfileLoading(false);
    }
  }

  async function saveField(field: string, value: any) {
    if (!profile) return;
    try {
      const res = await fetch(`/api/customers/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ [field]: value }),
      });
      if (res.ok) {
        setProfile({ ...profile, [field]: value });
        setCustomers(prev => prev.map(c => c.id === profile.id ? { ...c, [field]: value } : c));
      }
    } catch (err) { console.error(err); }
    setEditField(null);
  }

  function startLeadEdit(lead: LeadSummary) {
    setExpandedLead(lead.id);
    setLeadEdits(prev => ({
      ...prev,
      [lead.id]: { status: lead.status, notes: lead.notes ?? "" },
    }));
  }

  async function saveLeadEdit(leadId: number) {
    const edits = leadEdits[leadId];
    if (!edits) return;
    setLeadSaving(leadId);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: edits.status, notes: edits.notes }),
      });
      if (res.ok && profile) {
        const updated = await res.json();
        setProfile({
          ...profile,
          leads: profile.leads?.map(l =>
            l.id === leadId ? { ...l, status: updated.status, notes: updated.notes } : l
          ),
        });
        setExpandedLead(null);
      }
    } catch (err) { console.error(err); }
    setLeadSaving(null);
  }

  useEffect(() => { fetchList(); }, []);

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filtered = customers.filter(c => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      (c.full_name?.toLowerCase() || "").includes(q) ||
      (c.phone || "").includes(q) ||
      (c.email?.toLowerCase() || "").includes(q) ||
      (c.city?.toLowerCase() || "").includes(q);
    const matchesTier = tierFilter === "all" || getTier(c) === tierFilter;
    return matchesSearch && matchesTier;
  });

  // Tier counts for filter pills
  const tierCounts = customers.reduce((acc, c) => {
    acc[getTier(c)] = (acc[getTier(c)] || 0) + 1;
    return acc;
  }, {} as Record<Tier, number>);

  // ── Inline-edit helper ─────────────────────────────────────────────────────
  function Field({ field, label, value, type = "text" }: { field: string; label: string; value: string | null; type?: string }) {
    if (editField === field) {
      return (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-1">{label}</p>
          <input
            type={type}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => saveField(field, editValue || null)}
            onKeyDown={e => e.key === "Enter" && saveField(field, editValue || null)}
            autoFocus
            className="w-full px-2 py-1.5 rounded-lg bg-[var(--color-bg-soft)] border border-[var(--color-gold)]/50 text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-gold)]"
          />
        </div>
      );
    }
    return (
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-1">{label}</p>
        <p
          onClick={() => { setEditField(field); setEditValue(value || ""); }}
          className="text-sm text-[var(--color-text-soft)] cursor-pointer hover:text-[var(--color-gold)] transition-colors py-0.5 min-h-[20px]"
        >
          {value || <span className="text-[var(--color-text-faint)] italic">—</span>}
        </p>
      </div>
    );
  }

  // ── Left panel ─────────────────────────────────────────────────────────────
  const ListPanel = (
    <div className={`${profile ? "hidden lg:flex" : "flex"} w-full lg:w-[360px] flex-col border-r border-[var(--color-border)] bg-[var(--color-bg)] shrink-0`}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-[var(--color-border)] bg-[var(--color-bg-soft)] space-y-3">
        <div className="flex items-baseline gap-2">
          <h2 className="font-[family-name:var(--font-display)] text-base font-bold text-[var(--color-text)]">Customer Profiles</h2>
          <span className="text-xs text-[var(--color-text-faint)]">({customers.length})</span>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search name, phone, city…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full px-3 py-2 rounded-xl bg-[var(--color-bg)] border border-[var(--color-border)] text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-border-strong)] transition-colors"
        />

        {/* Tier filter pills */}
        <div className="flex gap-1.5 flex-wrap">
          {(["all", "ghost", "prospect", "customer", "repeat"] as const).map(t => {
            const count = t === "all" ? customers.length : (tierCounts[t] || 0);
            const isActive = tierFilter === t;
            return (
              <button
                key={t}
                onClick={() => setTierFilter(t)}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-colors ${
                  isActive
                    ? t === "all"
                      ? "bg-[var(--color-gold)] text-black border-[var(--color-gold)]"
                      : TIER[t].badgeCls + " !opacity-100"
                    : "bg-transparent text-[var(--color-text-faint)] border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
                }`}
              >
                {t === "all" ? `All ${count}` : `${TIER[t].emoji} ${count}`}
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-white/10 border-t-[var(--color-gold)] rounded-full animate-spin" />
          </div>
        ) : error ? (
          <p className="p-4 text-sm text-red-400">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-[var(--color-text-faint)] text-center">
            {search || tierFilter !== "all" ? "No profiles match your filters." : "No customer profiles yet."}
          </p>
        ) : (
          filtered.map(c => {
            const tier = getTier(c);
            const t = TIER[tier];
            const isActive = profile?.id === c.id;
            const displayName = c.full_name || c.phone || "Unknown";

            return (
              <button
                key={c.id}
                onClick={() => openProfile(c.id)}
                className={`w-full text-left px-4 py-3.5 border-b border-[var(--color-border)] transition-colors ${t.listCls} ${
                  isActive
                    ? "bg-[var(--color-gold)]/8 border-l-2 border-l-[var(--color-gold)] !opacity-100"
                    : "hover:bg-[var(--color-bg-soft)]"
                }`}
              >
                <div className="flex items-start gap-2">
                  {/* Name + tier badge */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className={`font-semibold text-sm truncate ${isActive ? "text-[var(--color-gold)]" : tier === "ghost" ? "text-[var(--color-text-muted)]" : "text-[var(--color-text)]"}`}>
                        {tier === "ghost" ? <span className="italic">{displayName}</span> : displayName}
                      </p>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${t.badgeCls}`}>
                        {t.emoji} {t.label}
                      </span>
                    </div>

                    {/* Phone / city */}
                    <p className="text-xs text-[var(--color-text-faint)] font-mono">
                      {c.phone || c.email || "No contact info"}
                      {c.city && <span className="font-sans not-italic"> · {c.city}</span>}
                    </p>

                    {/* Stats pills (customers / repeat only) */}
                    {(tier === "customer" || tier === "repeat") && (
                      <div className="flex gap-1.5 mt-1.5 flex-wrap">
                        {c.job_count > 0 && (
                          <span className="text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">
                            {c.job_count} job{c.job_count !== 1 ? "s" : ""}
                          </span>
                        )}
                        {c.lifetime_value_cents > 0 && (
                          <span className="text-[10px] font-semibold bg-[var(--color-gold)]/10 text-[var(--color-gold)] border border-[var(--color-gold)]/20 px-1.5 py-0.5 rounded-full">
                            {fmt$(c.lifetime_value_cents)}
                          </span>
                        )}
                        {c.last_job_at && (
                          <span className="text-[10px] text-[var(--color-text-faint)] border border-[var(--color-border)] px-1.5 py-0.5 rounded-full">
                            Last: {fmtDate(c.last_job_at, true)}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Prospect: show lead score */}
                    {tier === "prospect" && (
                      <div className="flex gap-1.5 mt-1.5">
                        <span className="text-[10px] text-[var(--color-gold)] border border-[var(--color-gold)]/20 px-1.5 py-0.5 rounded-full bg-[var(--color-gold)]/5">
                          Score {c.lead_score}
                        </span>
                        {c.source && (
                          <span className="text-[10px] text-[var(--color-text-faint)] border border-[var(--color-border)] px-1.5 py-0.5 rounded-full">
                            {c.source}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Ghost: just joined date */}
                    {tier === "ghost" && (
                      <p className="text-[10px] text-[var(--color-text-faint)] mt-1">
                        Added {fmtDate(c.created_at, true)} · no jobs yet
                      </p>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  // ── Right panel: profile ───────────────────────────────────────────────────
  const ProfilePanel = (() => {
    if (!profile && !profileLoading) {
      return (
        <div className="hidden lg:flex flex-1 items-center justify-center bg-[var(--color-bg)]">
          <div className="text-center space-y-2">
            <p className="text-3xl">👤</p>
            <p className="text-sm text-[var(--color-text-faint)]">Select a profile</p>
          </div>
        </div>
      );
    }

    const tier = profile ? getTier(profile) : null;
    const t = tier ? TIER[tier] : null;
    const displayName = profile?.full_name || profile?.phone || "Unknown";

    return (
      <div className="w-full lg:flex-1 flex flex-col bg-[var(--color-bg)] overflow-hidden">
        {/* Mobile back */}
        <button
          onClick={() => setProfile(null)}
          className="lg:hidden px-4 py-3 flex items-center gap-2 text-[var(--color-gold)] hover:bg-[var(--color-bg-soft)] border-b border-[var(--color-border)] font-semibold text-sm min-h-[44px]"
        >
          ← Back
        </button>

        {profileLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-white/10 border-t-[var(--color-gold)] rounded-full animate-spin" />
          </div>
        ) : profile && tier && t ? (
          <div className="flex-1 overflow-y-auto">

            {/* Profile header */}
            <div className="px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg-soft)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className={`font-[family-name:var(--font-display)] text-lg font-bold ${tier === "ghost" ? "text-[var(--color-text-muted)] italic" : "text-[var(--color-text)]"}`}>
                      {displayName}
                    </h3>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${t.badgeCls}`}>
                      {t.emoji} {t.label}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-text-faint)]">
                    Profile #{profile.id}
                    {profile.source && <> · via {profile.source}</>}
                    {profile.created_at && <> · since {fmtDate(profile.created_at, true)}</>}
                  </p>
                </div>
              </div>

              {/* Ghost CTA */}
              {tier === "ghost" && (
                <div className="mt-3 px-3 py-2.5 rounded-xl bg-white/4 border border-white/8 text-xs text-[var(--color-text-faint)]">
                  👻 Ghost profile — lead came in but no job booked yet. Profile auto-fills once a sale is made.
                </div>
              )}
            </div>

            {/* KPI strip — only meaningful for customers */}
            {(tier === "customer" || tier === "repeat") && (
              <div className="grid grid-cols-3 gap-px border-b border-[var(--color-border)] bg-[var(--color-border)]">
                {[
                  { label: "Jobs Done", value: String(profile.job_count) },
                  { label: "Revenue",   value: fmt$(profile.lifetime_value_cents) },
                  { label: "Lead Score",value: String(profile.lead_score) },
                ].map(stat => (
                  <div key={stat.label} className="bg-[var(--color-bg-soft)] px-3 py-3 text-center">
                    <p className="text-base font-[family-name:var(--font-display)] font-bold text-[var(--color-text)]">{stat.value}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)] mt-0.5">{stat.label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Contact info */}
            <div className="px-5 py-4 border-b border-[var(--color-border)] space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)]">Contact</p>
              <div className="grid grid-cols-2 gap-4">
                <Field field="phone" label="Phone" value={profile.phone} type="tel" />
                <Field field="email" label="Email" value={profile.email} type="email" />
              </div>
              <Field
                field="address"
                label="Address"
                value={[profile.address, profile.city, profile.state, profile.zip].filter(Boolean).join(", ")}
              />
            </div>

            {/* Leads attached to this profile */}
            {(profile.leads?.length ?? 0) > 0 && (
              <div className="px-5 py-4 border-b border-[var(--color-border)]">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-3">
                  Leads ({profile.leads!.length})
                </p>
                <div className="space-y-2">
                  {profile.leads!.map(lead => {
                    const scls = LEAD_STATUS_CLS[lead.status] || "bg-white/5 text-[var(--color-text-faint)] border-white/10";
                    const isExpanded = expandedLead === lead.id;
                    const draft = leadEdits[lead.id];
                    return (
                      <div key={lead.id} className="rounded-xl bg-[var(--color-bg-soft)] border border-[var(--color-border)] overflow-hidden">
                        {/* Row — tap to expand */}
                        <button
                          onClick={() => isExpanded ? setExpandedLead(null) : startLeadEdit(lead)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/4 transition-colors text-left"
                        >
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${scls}`}>
                            {lead.status.replace("_", " ")}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-[var(--color-text)] truncate">{lead.full_name || lead.phone || "Unknown"}</p>
                            {lead.notes && !isExpanded && <p className="text-[10px] text-[var(--color-text-faint)] truncate">{lead.notes}</p>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <p className="text-[10px] text-[var(--color-text-faint)]">{fmtDate(lead.created_at, true)}</p>
                            <span className="text-[var(--color-text-faint)] text-xs">{isExpanded ? "▲" : "▼"}</span>
                          </div>
                        </button>

                        {/* Inline editor */}
                        {isExpanded && draft && (
                          <div className="px-3 pb-3 pt-1 border-t border-[var(--color-border)] space-y-2.5">
                            {/* Status */}
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-1">Status</p>
                              <select
                                value={draft.status}
                                onChange={e => setLeadEdits(prev => ({ ...prev, [lead.id]: { ...prev[lead.id], status: e.target.value } }))}
                                className="w-full px-2.5 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-gold)] transition-colors"
                              >
                                {["new","contacted","quoted","sold","lost"].map(s => (
                                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                                ))}
                              </select>
                            </div>
                            {/* Notes */}
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-1">Notes</p>
                              <textarea
                                value={draft.notes}
                                onChange={e => setLeadEdits(prev => ({ ...prev, [lead.id]: { ...prev[lead.id], notes: e.target.value } }))}
                                rows={2}
                                placeholder="Notes about this lead…"
                                className="w-full px-2.5 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:border-[var(--color-gold)] resize-none transition-colors"
                              />
                            </div>
                            {/* Actions */}
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={() => setExpandedLead(null)}
                                className="px-3 py-1.5 text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] rounded-lg transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => saveLeadEdit(lead.id)}
                                disabled={leadSaving === lead.id}
                                className="px-3 py-1.5 text-xs font-bold bg-[var(--color-gold)] text-black rounded-lg hover:bg-yellow-400 disabled:opacity-50 transition-colors"
                              >
                                {leadSaving === lead.id ? "Saving…" : "Save"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Appointments */}
            {(profile.appointments?.length ?? 0) > 0 && (
              <div className="px-5 py-4 border-b border-[var(--color-border)]">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-3">
                  Appointments ({profile.appointments!.length})
                </p>
                <div className="space-y-2">
                  {profile.appointments!.map(appt => {
                    const scls = APPT_STATUS_CLS[appt.status] || "bg-white/5 text-[var(--color-text-faint)] border-white/10";
                    return (
                      <div key={appt.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[var(--color-bg-soft)] border border-[var(--color-border)]">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${scls}`}>
                          {appt.status}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-[var(--color-text)]">{appt.service_summary || "Service"}</p>
                          <p className="text-[10px] text-[var(--color-text-faint)]">{appt.scheduled_date}</p>
                        </div>
                        {appt.quoted_price_cents != null && (
                          <p className="text-xs font-semibold text-[var(--color-gold)] shrink-0">{fmt$(appt.quoted_price_cents)}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Conversations */}
            {(profile.conversations?.length ?? 0) > 0 && (
              <div className="px-5 py-4 border-b border-[var(--color-border)]">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-3">
                  Conversations ({profile.conversations!.length})
                </p>
                <div className="space-y-2">
                  {profile.conversations!.map(conv => (
                    <div key={conv.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[var(--color-bg-soft)] border border-[var(--color-border)]">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                        conv.status === "sold" ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                        : conv.status === "active" ? "bg-blue-500/15 text-blue-300 border-blue-500/30"
                        : "bg-white/5 text-[var(--color-text-faint)] border-white/10"
                      }`}>
                        {conv.status}
                      </span>
                      <p className="flex-1 text-xs text-[var(--color-text-soft)]">
                        {conv.total_messages} msg{conv.total_messages !== 1 ? "s" : ""}
                        {conv.last_message_at && <> · {fmtDate(conv.last_message_at, true)}</>}
                      </p>
                      {conv.quoted_price_cents != null && (
                        <p className="text-xs font-semibold text-[var(--color-gold)] shrink-0">{fmt$(conv.quoted_price_cents)}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Property details + Zillow */}
            <div className="px-5 py-4 border-b border-[var(--color-border)]">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-3">Property</p>

              {/* Zillow link */}
              {(profile.address || profile.city) && (() => {
                const q = encodeURIComponent([profile.address, profile.city, profile.state, profile.zip].filter(Boolean).join(' '));
                return (
                  <a
                    href={`https://www.zillow.com/homes/${q}_rb/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-[var(--color-border)] hover:border-[var(--color-border-strong)] bg-[var(--color-bg-soft)] text-sm font-semibold text-[var(--color-text-soft)] hover:text-[var(--color-text)] transition-colors mb-3"
                  >
                    <span className="text-base">🏠</span>
                    <span>View on Zillow</span>
                    <span className="ml-auto text-[10px] text-[var(--color-text-faint)] font-mono truncate max-w-[160px]">{[profile.address, profile.city].filter(Boolean).join(', ')}</span>
                    <svg className="w-3 h-3 text-[var(--color-text-faint)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                  </a>
                );
              })()}

              {/* Sqft + Windows inline edit */}
              <div className="grid grid-cols-2 gap-3">
                {(['home_sqft', 'window_count'] as const).map(field => {
                  const label = field === 'home_sqft' ? 'Sqft' : 'Windows';
                  const val = profile[field];
                  return (
                    <div key={field}>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-1">{label}</p>
                      {editField === field ? (
                        <input
                          type="number"
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={() => saveField(field, editValue ? Number(editValue) : null)}
                          onKeyDown={e => e.key === 'Enter' && saveField(field, editValue ? Number(editValue) : null)}
                          autoFocus
                          className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--color-bg-soft)] border border-[var(--color-gold)]/50 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-gold)]"
                        />
                      ) : (
                        <p
                          onClick={() => { setEditField(field); setEditValue(val != null ? String(val) : ''); }}
                          className="text-sm text-[var(--color-text-soft)] cursor-pointer hover:text-[var(--color-gold)] transition-colors py-0.5"
                        >
                          {val != null
                            ? (field === 'home_sqft' ? `${val.toLocaleString()} sq ft` : `${val} windows`)
                            : <span className="text-[var(--color-text-faint)] italic text-xs">tap to add</span>}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Notes */}
            <div className="px-5 py-4 border-b border-[var(--color-border)]">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-2">Notes</p>
              {editField === "notes" ? (
                <textarea
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onBlur={() => saveField("notes", editValue || null)}
                  autoFocus rows={3}
                  className="w-full px-3 py-2 rounded-xl bg-[var(--color-bg-soft)] border border-[var(--color-gold)]/50 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-gold)] resize-none"
                />
              ) : (
                <p
                  onClick={() => { setEditField("notes"); setEditValue(profile.notes || ""); }}
                  className="text-sm text-[var(--color-text-soft)] cursor-pointer hover:text-[var(--color-gold)] whitespace-pre-wrap transition-colors"
                >
                  {profile.notes || <span className="text-[var(--color-text-faint)] italic">Tap to add notes…</span>}
                </p>
              )}
            </div>

            {/* Activity timeline */}
            {timeline.length > 0 && (
              <div className="px-5 py-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] mb-3">Activity</p>
                <div className="space-y-3">
                  {timeline.map((item, idx) => (
                    <div key={idx} className="flex gap-3 text-sm border-l-2 border-[var(--color-border-strong)] pl-3">
                      <span className="text-[10px] text-[var(--color-text-faint)] whitespace-nowrap pt-0.5 tabular-nums shrink-0">
                        {fmtDate(item.created_at, false)}
                      </span>
                      <div className="min-w-0">
                        {item._type === "activity" && (
                          <>
                            <p className="font-semibold text-[var(--color-text)] text-xs">📋 {item.type}</p>
                            <p className="text-[var(--color-text-soft)] text-xs mt-0.5">{item.body}</p>
                          </>
                        )}
                        {item._type === "call" && (
                          <>
                            <p className="font-semibold text-[var(--color-text)] text-xs">
                              📞 Call{item.duration_seconds ? ` · ${Math.floor(item.duration_seconds / 60)}m ${item.duration_seconds % 60}s` : ""}
                            </p>
                            <p className="text-[var(--color-text-soft)] text-xs mt-0.5 font-mono">{item.from_phone}</p>
                            {item.summary && <p className="text-[var(--color-text-faint)] text-xs mt-1 italic">{item.summary}</p>}
                          </>
                        )}
                        {item._type === "message" && (
                          <>
                            <p className="font-semibold text-[var(--color-text)] text-xs">💬 {item.role === "assistant" ? "Hayden" : "Customer"}</p>
                            <p className="text-[var(--color-text-soft)] text-xs mt-0.5">{item.body}</p>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        ) : null}
      </div>
    );
  })();

  return (
    <div className="flex h-[calc(100vh-56px)] sm:h-[calc(100vh-60px)] bg-[var(--color-bg)]">
      {ListPanel}
      {ProfilePanel}
    </div>
  );
}
