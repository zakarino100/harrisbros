import { useEffect, useMemo, useState } from "react";
import { api, type LeadDetail, type LeadSummary, type KpiPayload, type MePayload } from "../lib/api";
import { LeadDrawer } from "../components/LeadDrawer";

interface Props {
  me: MePayload;
  onLogout: () => void;
  onStartMessage?: (leadId: number) => void;
}

export function Dashboard({ me, onLogout, onStartMessage }: Props) {
  const [leads, setLeads] = useState<LeadSummary[] | null>(null);
  const [kpis, setKpis] = useState<KpiPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const [activeId, setActiveId] = useState<number | null>(null);
  const [activeLead, setActiveLead] = useState<LeadDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  async function refresh() {
    try {
      const [ll, kk] = await Promise.all([api.listLeads(), api.kpis()]);
      setLeads(ll);
      setKpis(kk);
    } catch (err: any) {
      setError(err?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000); // light auto-refresh every 30s
    return () => clearInterval(t);
  }, []);

  async function openLead(id: number) {
    setActiveId(id);
    setActiveLead(null);
    setDrawerLoading(true);
    try {
      const lead = await api.getLead(id);
      setActiveLead(lead);
    } catch (err) {
      console.error(err);
    } finally {
      setDrawerLoading(false);
    }
  }

  function closeLead() {
    setActiveId(null);
    setActiveLead(null);
  }

  async function logout() {
    try {
      await api.logout();
    } finally {
      onLogout();
    }
  }

  async function patchLead(patch: { status?: string; notes?: string; full_name?: string; phone?: string; email?: string; address?: string; city?: string; state?: string; zip?: string }) {
    if (!activeLead) return;
    try {
      const updated = await api.updateLead(activeLead.id, patch);
      // Merge all returned fields back into local state
      const merged = { ...activeLead, ...updated };
      setActiveLead(merged);
      setLeads((prev) =>
        prev?.map((l) => (l.id === updated.id ? { ...l, ...updated } : l)) ?? prev
      );
      // Re-pull KPIs (cheap)
      api.kpis().then(setKpis).catch(() => {});
      // And re-pull lead activity (status_change row was just inserted)
      api.getLead(activeLead.id).then(setActiveLead).catch(() => {});
    } catch (err) {
      console.error(err);
    }
  }

  async function initiateCall(leadId: number, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const res = await fetch("/api/calls/outbound", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Failed to initiate call: ${err.error}`);
        return;
      }
      alert("Call initiated!");
    } catch (err) {
      console.error(err);
      alert("Failed to initiate call");
    }
  }

  const filtered = useMemo(() => {
    if (!leads) return null;
    let out = leads;
    if (statusFilter !== "all") out = out.filter((l) => l.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((l) =>
        [l.fullName, l.phone, l.email, l.city, l.state, l.zip]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q))
      );
    }
    return out;
  }, [leads, statusFilter, search]);

  const brand = me.tenant.brandColor;

  return (
    <div className="relative z-10 min-h-screen pb-24">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[rgba(10,10,10,0.78)] border-b border-[var(--color-border)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-black font-bold text-base"
              style={{ background: brand, boxShadow: `0 8px 24px -10px ${brand}80` }}
            >
              🌊
            </div>
            <div className="min-w-0">
              <h1 className="font-[family-name:var(--font-display)] font-bold text-base sm:text-lg truncate">
                {me.tenant.name}
              </h1>
              <p className="text-[10px] sm:text-[11px] text-[var(--color-text-muted)] uppercase tracking-widest">
                Lead Command · <span style={{ color: brand }}>Swell</span>
              </p>
            </div>
          </div>
          <button onClick={logout} className="btn-ghost text-xs sm:text-sm shrink-0">
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-5 sm:pt-7 space-y-5 sm:space-y-7">
        {/* KPI tiles */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Kpi label="Total Leads" value={kpis?.totalLeads ?? 0} loading={loading} />
          <Kpi label="Last 24h" value={kpis?.leads24h ?? 0} accent loading={loading} />
          <Kpi label="Last 7 days" value={kpis?.leads7d ?? 0} loading={loading} />
          <Kpi label="Sold" value={kpis?.leadsSold ?? 0} loading={loading} positive />
        </section>

        {/* Filters */}
        <section className="surface p-3 sm:p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
          <input
            className="input flex-1"
            placeholder="Search name, phone, email, city…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex gap-2 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
            {(["all", "new", "contacted", "quoted", "sold", "lost"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide border transition-colors ${
                  statusFilter === s
                    ? "bg-[var(--color-gold)] text-black border-[var(--color-gold)]"
                    : "bg-transparent text-[var(--color-text-soft)] border-[var(--color-border-strong)] hover:bg-[var(--color-bg-soft)]"
                }`}
                style={statusFilter === s ? { background: brand, borderColor: brand } : undefined}
              >
                {s}
                {s !== "all" && kpis && (
                  <span className="opacity-70 ml-1.5">
                    {countFor(s, kpis)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>

        {/* Lead list */}
        <section>
          <div className="flex items-baseline justify-between mb-2 px-1">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
              Leads · newest first
            </h2>
            {filtered && (
              <span className="text-xs text-[var(--color-text-faint)]">
                {filtered.length} shown
              </span>
            )}
          </div>

          {error && (
            <div className="surface p-4 text-sm text-red-400">{error}</div>
          )}

          {!error && loading && !leads && (
            <div className="surface p-8 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-white/10 border-t-[var(--color-gold)] rounded-full animate-spin" />
            </div>
          )}

          {!error && filtered && filtered.length === 0 && (
            <div className="surface p-10 text-center">
              <p className="text-sm text-[var(--color-text-muted)]">
                No leads yet — they'll show up here as Facebook delivers them.
              </p>
            </div>
          )}

          {!error && filtered && filtered.length > 0 && (
            <ul className="space-y-2">
              {filtered.map((l) => (
                <li key={l.id}>
                  <button
                    onClick={() => openLead(l.id)}
                    className="tap surface w-full text-left p-3 sm:p-4 hover:border-[var(--color-border-strong)] transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold truncate text-sm sm:text-base">
                            {l.fullName || "Unknown"}
                          </p>
                          <span className={`pill pill-${l.status}`}>{l.status}</span>
                        </div>
                        <p className="text-xs sm:text-sm text-[var(--color-text-muted)] mt-1 truncate">
                          {[l.phone, l.email].filter(Boolean).join(" · ") || "—"}
                        </p>
                        {(l.city || l.state) && (
                          <p className="text-xs text-[var(--color-text-faint)] mt-0.5 truncate">
                            {[l.city, l.state].filter(Boolean).join(", ")}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                        <p className="text-[11px] text-[var(--color-text-faint)] tabular-nums">
                          {formatRelativeTime(l.createdAt)}
                        </p>
                        {l.phone && (
                          <div className="flex gap-1.5 sm:gap-1">
                            <button
                              onClick={(e) => initiateCall(l.id, e)}
                              className="min-h-[44px] min-w-[44px] text-xs sm:text-[12px] px-2 sm:px-2 py-2 sm:py-1 rounded-lg bg-[var(--color-gold)]/10 hover:bg-[var(--color-gold)]/20 text-[var(--color-gold)] font-semibold transition-colors flex items-center justify-center"
                            >
                              📞 <span className="hidden sm:inline ml-1">Call</span>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onStartMessage?.(l.id);
                              }}
                              className="min-h-[44px] min-w-[44px] text-xs sm:text-[12px] px-2 sm:px-2 py-2 sm:py-1 rounded-lg bg-[var(--color-gold)]/10 hover:bg-[var(--color-gold)]/20 text-[var(--color-gold)] font-semibold transition-colors flex items-center justify-center"
                            >
                              💬 <span className="hidden sm:inline ml-1">Text</span>
                            </button>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          {l.leadScore !== null && (
                            <span
                              className="px-2 py-0.5 rounded-full text-[10px] font-bold text-black"
                              style={{
                                backgroundColor: (() => {
                                  if (l.leadScore >= 75) return brand;
                                  if (l.leadScore >= 45) return "#9ca3af";
                                  return "#6b7280";
                                })(),
                              }}
                            >
                              {l.leadScore}
                            </span>
                          )}
                          {l.repeatProbability && (
                            <span
                              className={`inline-block text-xs font-semibold ${
                                l.repeatProbability === "hot"
                                  ? "text-red-400"
                                  : l.repeatProbability === "warm"
                                  ? "text-blue-400"
                                  : "text-gray-500"
                              }`}
                            >
                              {l.repeatProbability === "hot"
                                ? "🔥 Hot"
                                : l.repeatProbability === "warm"
                                ? "✅ Warm"
                                : "🧊 Cold"}
                            </span>
                          )}
                        </div>
                        {l.smsAlertSent && (
                          <span className="inline-block text-[10px] font-semibold uppercase tracking-wide text-[var(--color-gold)]/80">
                            sms sent
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <LeadDrawer
        open={activeId !== null}
        lead={activeLead}
        loading={drawerLoading}
        brandColor={brand}
        onClose={closeLead}
        onPatch={patchLead}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  accent,
  positive,
  loading,
}: {
  label: string;
  value: number;
  accent?: boolean;
  positive?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="surface p-3 sm:p-4">
      <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
        {label}
      </p>
      <p
        className={`mt-1 font-[family-name:var(--font-display)] text-2xl sm:text-3xl font-bold tabular-nums ${
          accent ? "text-[var(--color-gold)]" : positive ? "text-emerald-400" : "text-white"
        }`}
      >
        {loading ? <span className="inline-block w-10 h-6 bg-white/5 rounded animate-pulse" /> : value}
      </p>
    </div>
  );
}

function countFor(status: string, kpis: KpiPayload): number {
  switch (status) {
    case "new":
      return kpis.leadsNew;
    case "contacted":
      return kpis.leadsContacted;
    case "quoted":
      return kpis.leadsQuoted;
    case "sold":
      return kpis.leadsSold;
    case "lost":
      return kpis.leadsLost;
    default:
      return 0;
  }
}

function formatRelativeTime(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : iso.replace(" ", "T") + "Z");
  const now = Date.now();
  const diff = now - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
