import { useEffect, useState } from "react";
import { api, type MePayload } from "./lib/api";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Messages } from "./pages/Messages";
import { Schedule } from "./pages/Schedule";
import { Sales } from "./pages/Sales";
import { Settings } from "./pages/Settings";
import { Stats } from "./pages/Stats";
import { Calls } from "./pages/Calls";
import { Customers } from "./pages/Customers";
import { Admin } from "./pages/Admin";
import { ServiceMap } from "./pages/ServiceMap";
import { Dialer } from "./components/Dialer";

type State =
  | { kind: "boot" }
  | { kind: "error"; message: string }
  | { kind: "ready"; me: MePayload };

export function App() {
  const [state, setState] = useState<State>({ kind: "boot" });
  const [currentPage, setCurrentPage] = useState<"leads" | "stats" | "calls" | "messages" | "schedule" | "sales" | "customers" | "map" | "settings">("leads");
  const [selectedLeadForMessage, setSelectedLeadForMessage] = useState<number | null>(null);
  const [showFloatingDialer, setShowFloatingDialer] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [adminSecret, setAdminSecret] = useState(localStorage.getItem("admin_secret") || "");
  const [showAdminLogin, setShowAdminLogin] = useState(false);

  // Detect if this is admin subdomain
  const isAdminSubdomain = 
    typeof window !== "undefined" && 
    (window.location.hostname.includes("systemadmin") || window.location.hostname.includes("admin."));

  async function refresh() {
    try {
      const me = await api.me();
      setState({ kind: "ready", me });
    } catch (err: any) {
      const msg =
        err?.status === 404
          ? "Tenant not found for this domain."
          : err?.status === 400
            ? "No tenant resolved — open this dashboard from your client subdomain."
            : err?.message || "Failed to load.";
      setState({ kind: "error", message: msg });
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function handleFloatingDialerCall() {
    setShowFloatingDialer(false);
    setCurrentPage("calls");
    setTimeout(() => {
      window.scrollTo(0, 0);
    }, 50);
  }

  // Admin mode
  if (isAdminSubdomain) {
    const [adminPwd, setAdminPwd] = useState("");
    
    if (!adminSecret) {
      return (
        <div className="relative z-10 min-h-screen flex items-center justify-center px-4">
          <div className="surface p-8 max-w-md w-full rounded-lg border border-[var(--color-border)]">
            <h1 className="text-2xl font-bold text-[var(--color-gold)] mb-6 text-center">🔑 Super Admin</h1>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-2">
                  Admin Secret
                </label>
                <input
                  type="password"
                  value={adminPwd}
                  onChange={(e) => setAdminPwd(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      localStorage.setItem("admin_secret", adminPwd);
                      setAdminSecret(adminPwd);
                    }
                  }}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)]"
                  placeholder="Enter SWELL_ADMIN_SECRET"
                />
              </div>
              <button
                onClick={() => {
                  localStorage.setItem("admin_secret", adminPwd);
                  setAdminSecret(adminPwd);
                }}
                className="w-full px-4 py-2 rounded-lg bg-[var(--color-gold)] text-black hover:bg-yellow-400 font-semibold transition-colors"
              >
                Login
              </button>
            </div>
          </div>
        </div>
      );
    }
    
    return (
      <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
        {adminSecret && <Admin me={{ authenticated: true, tenant: { id: "", name: "", slug: "", brandColor: "#fbbf24", accentColor: "#fde68a", logoUrl: null }, role: "admin" }} />
          }
      </div>
    );
  }

  if (state.kind === "boot") {
    return (
      <div className="relative z-10 min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/10 border-t-[var(--color-gold)] rounded-full animate-spin" />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="relative z-10 min-h-screen flex items-center justify-center px-6">
        <div className="surface p-8 max-w-md text-center">
          <h1 className="font-[family-name:var(--font-display)] text-2xl text-[var(--color-gold)] mb-2">Swell</h1>
          <p className="text-sm text-[var(--color-text-soft)]">{state.message}</p>
        </div>
      </div>
    );
  }

  if (!state.me.authenticated) {
    return <Login me={state.me} onAuthed={refresh} />;
  }

  return (
    <div>
      <nav className="fixed top-0 left-0 right-0 z-40 backdrop-blur-md bg-[rgba(10,10,10,0.78)] border-b border-[var(--color-border)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between md:justify-start gap-4">
          {/* Hamburger menu - mobile only */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden text-[var(--color-text)] text-xl"
          >
            ☰
          </button>
          
          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
          <button
            onClick={() => setCurrentPage("leads")}
            className={`px-3 py-2 min-h-[44px] rounded-lg font-semibold uppercase tracking-wide text-xs transition-colors flex items-center ${
              currentPage === "leads"
                ? "bg-[var(--color-gold)] text-black"
                : "text-[var(--color-text-soft)] hover:bg-[var(--color-bg-soft)]"
            }`}
            style={currentPage === "leads" ? { background: state.me.tenant.brandColor } : undefined}
          >
            Leads
          </button>
          <button
            onClick={() => setCurrentPage("stats")}
            className={`px-3 py-2 min-h-[44px] rounded-lg font-semibold uppercase tracking-wide text-xs transition-colors flex items-center ${
              currentPage === "stats"
                ? "bg-[var(--color-gold)] text-black"
                : "text-[var(--color-text-soft)] hover:bg-[var(--color-bg-soft)]"
            }`}
            style={currentPage === "stats" ? { background: state.me.tenant.brandColor } : undefined}
          >
            📊 Stats
          </button>
          <button
            onClick={() => setCurrentPage("calls")}
            className={`px-3 py-2 min-h-[44px] rounded-lg font-semibold uppercase tracking-wide text-xs transition-colors flex items-center ${
              currentPage === "calls"
                ? "bg-[var(--color-gold)] text-black"
                : "text-[var(--color-text-soft)] hover:bg-[var(--color-bg-soft)]"
            }`}
            style={currentPage === "calls" ? { background: state.me.tenant.brandColor } : undefined}
          >
            📞 Calls
          </button>
          <button
            onClick={() => setCurrentPage("messages")}
            className={`px-3 py-2 min-h-[44px] rounded-lg font-semibold uppercase tracking-wide text-xs transition-colors flex items-center ${
              currentPage === "messages"
                ? "bg-[var(--color-gold)] text-black"
                : "text-[var(--color-text-soft)] hover:bg-[var(--color-bg-soft)]"
            }`}
            style={currentPage === "messages" ? { background: state.me.tenant.brandColor } : undefined}
          >
            Messages
          </button>
          <button
            onClick={() => setCurrentPage("sales")}
            className={`px-3 py-2 min-h-[44px] rounded-lg font-semibold uppercase tracking-wide text-xs transition-colors flex items-center ${
              currentPage === "sales"
                ? "bg-[var(--color-gold)] text-black"
                : "text-[var(--color-text-soft)] hover:bg-[var(--color-bg-soft)]"
            }`}
            style={currentPage === "sales" ? { background: state.me.tenant.brandColor } : undefined}
          >
            💰 Sales
          </button>
          <button
            onClick={() => setCurrentPage("customers")}
            className={`px-3 py-2 min-h-[44px] rounded-lg font-semibold uppercase tracking-wide text-xs transition-colors flex items-center ${
              currentPage === "customers"
                ? "bg-[var(--color-gold)] text-black"
                : "text-[var(--color-text-soft)] hover:bg-[var(--color-bg-soft)]"
            }`}
            style={currentPage === "customers" ? { background: state.me.tenant.brandColor } : undefined}
          >
            👥 Customers
          </button>
          <button
            onClick={() => setCurrentPage("map")}
            className={`px-3 py-2 min-h-[44px] rounded-lg font-semibold uppercase tracking-wide text-xs transition-colors flex items-center ${
              currentPage === "map"
                ? "bg-[var(--color-gold)] text-black"
                : "text-[var(--color-text-soft)] hover:bg-[var(--color-bg-soft)]"
            }`}
            style={currentPage === "map" ? { background: state.me.tenant.brandColor } : undefined}
          >
            📍 Map
          </button>
          <button
            onClick={() => setCurrentPage("schedule")}
            className={`px-3 py-2 min-h-[44px] rounded-lg font-semibold uppercase tracking-wide text-xs transition-colors flex items-center ${
              currentPage === "schedule"
                ? "bg-[var(--color-gold)] text-black"
                : "text-[var(--color-text-soft)] hover:bg-[var(--color-bg-soft)]"
            }`}
            style={currentPage === "schedule" ? { background: state.me.tenant.brandColor } : undefined}
          >
            Schedule
          </button>
          <button
            onClick={() => setCurrentPage("settings")}
            className={`px-3 py-2 min-h-[44px] rounded-lg font-semibold uppercase tracking-wide text-xs transition-colors flex items-center ${
              currentPage === "settings"
                ? "bg-[var(--color-gold)] text-black"
                : "text-[var(--color-text-soft)] hover:bg-[var(--color-bg-soft)]"
            }`}
            style={currentPage === "settings" ? { background: state.me.tenant.brandColor } : undefined}
          >
            ⚙️ Settings
          </button>
          </div>
          
          {/* Mobile menu */}
          {mobileMenuOpen && (
            <div className="md:hidden absolute top-full left-0 right-0 bg-[rgba(10,10,10,0.95)] border-b border-[var(--color-border)] flex flex-col">
              {[
                { label: "Leads", page: "leads" as const },
                { label: "📊 Stats", page: "stats" as const },
                { label: "📞 Calls", page: "calls" as const },
                { label: "Messages", page: "messages" as const },
                { label: "💰 Sales", page: "sales" as const },
                { label: "👥 Customers", page: "customers" as const },
                { label: "📍 Map", page: "map" as const },
                { label: "Schedule", page: "schedule" as const },
                { label: "⚙️ Settings", page: "settings" as const },
              ].map(({ label, page }) => (
                <button
                  key={page}
                  onClick={() => {
                    setCurrentPage(page);
                    setMobileMenuOpen(false);
                  }}
                  className={`px-4 py-3 text-sm font-semibold uppercase tracking-wide transition-colors text-left border-b border-[var(--color-border)] min-h-[44px] flex items-center ${
                    currentPage === page
                      ? "bg-[var(--color-gold)] text-black"
                      : "text-[var(--color-text-soft)] hover:bg-[var(--color-bg-soft)]"
                  }`}
                  style={currentPage === page ? { background: state.me.tenant.brandColor } : undefined}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>
      <div className="pt-[56px] sm:pt-[60px]">
        {currentPage === "leads" && (
          <Dashboard 
            me={state.me} 
            onLogout={refresh}
            onStartMessage={(leadId) => {
              setSelectedLeadForMessage(leadId);
              setCurrentPage("messages");
            }}
          />
        )}
        {currentPage === "stats" && <Stats me={state.me} />}
        {currentPage === "calls" && <Calls me={state.me} />}
        {currentPage === "messages" && (
          <Messages 
            me={state.me}
            selectedLeadForMessage={selectedLeadForMessage}
            onClearSelection={() => setSelectedLeadForMessage(null)}
          />
        )}
        {currentPage === "sales" && <Sales me={state.me} />}
        {currentPage === "customers" && <Customers me={state.me} />}
        {currentPage === "map" && <ServiceMap me={state.me} />}
        {currentPage === "schedule" && <Schedule me={state.me} />}
        {currentPage === "settings" && <Settings me={state.me} />}
      </div>

      {/* Floating Dialer Button (only on non-login, non-leads, non-sales, non-customers, non-map pages) */}
      {!showFloatingDialer && currentPage !== "leads" && currentPage !== "sales" && currentPage !== "customers" && currentPage !== "map" && (
        <button
          onClick={() => setShowFloatingDialer(true)}
          className="fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full bg-[var(--color-gold)] hover:bg-[var(--color-gold)]/90 text-black font-bold text-xl shadow-lg transition-all hover:scale-110"
          title="Open dialer"
        >
          📞
        </button>
      )}

      {/* Floating Dialer Modal */}
      {showFloatingDialer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--color-bg)] border border-[var(--color-gold)]/30 rounded-2xl p-6 w-full mx-4 sm:max-w-md sm:rounded-2xl fixed inset-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 flex flex-col">
            <div className="flex items-center justify-between mb-4 sticky top-0">
              <h2 className="text-xl font-bold text-[var(--color-text)]">📞 New Call</h2>
              <button
                onClick={() => setShowFloatingDialer(false)}
                className="text-[var(--color-text-soft)] hover:text-[var(--color-text)] text-xl min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto sm:overflow-visible">
              <Dialer me={state.me} onCallInitiated={handleFloatingDialerCall} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
