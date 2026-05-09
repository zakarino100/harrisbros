import { useEffect, useState } from "react";
import { api, type MePayload } from "../lib/api";

interface AIConfig {
  tenant_id: string;
  enabled: boolean;
  model_primary: "claude-sonnet-4-6" | "claude-haiku-4-5";
  model_classifier: string;
  persona_name: string;
  business_name: string | null;
  services_json: ServiceEntry[];
  pricing_matrix: Record<string, unknown>;
  route_cities_json: string[];
  transport_waive: number;
  review_discount: number;
  business_hours_json: BusinessHours;
  max_msgs_per_lead: number;
  max_tokens_per_msg: number;
  custom_brand_notes: string | null;
  pricing_locked: boolean;
  created_at: string;
  updated_at: string;
}

interface ServiceEntry {
  label: string;
  base_price: number;
  floor_price: number;
  notes?: string;
}

interface BusinessHours {
  timezone: string;
  work_days: number[]; // 0=Mon, 6=Sun
  work_start: string; // "HH:MM"
  work_end: string; // "HH:MM"
}

interface OwnerSettings {
  owner_name: string | null;
  owner_phone: string | null;
  owner_phone_verified: boolean;
  google_review_url: string | null;
  eod_offset_hours: number;
  contact_phone: string;
}

interface UncontactedLead {
  id: number;
  full_name: string | null;
  phone: string;
  email: string | null;
  status: string;
  created_at: string;
  notes: string | null;
  lead_score: number | null;
  repeat_probability: number | null;
}

interface Props {
  me: MePayload;
}

interface SwellUser {
  id: number;
  tenant_id: string;
  name: string;
  email: string;
  role: string;
  enabled: boolean;
  last_login_at: string | null;
  created_at: string;
}

export function Settings({ me }: Props) {
  // Tabs: "hayden", "pricing", "hours", "owner", "users"
  const [activeTab, setActiveTab] = useState<"hayden" | "pricing" | "hours" | "owner" | "users">("hayden");
  const isAdmin = me.role === "admin";

  // AI Config
  const [aiConfig, setAIConfig] = useState<AIConfig | null>(null);
  const [editAI, setEditAI] = useState<Partial<AIConfig>>({});
  const [newService, setNewService] = useState<ServiceEntry>({
    label: "",
    base_price: 0,
    floor_price: 0,
    notes: "",
  });
  const [newCity, setNewCity] = useState("");

  // Owner Settings
  const [ownerSettings, setOwnerSettings] = useState<OwnerSettings | null>(null);

  // Users Management (admin only)
  const [users, setUsers] = useState<SwellUser[]>([]);
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "", role: "rep" });
  const [editingUser, setEditingUser] = useState<SwellUser | null>(null);
  const [editUserForm, setEditUserForm] = useState<Partial<SwellUser>>({}); 
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [resetUserEmail, setResetUserEmail] = useState("");
  const [resetPassword, setResetPassword] = useState("");

  // Phone verification flow
  const [verifyPhoneMode, setVerifyPhoneMode] = useState(false);
  const [pendingPhone, setPendingPhone] = useState("");
  const [verifyCode, setVerifyCode] = useState("");

  // Batch kickoff modal
  const [showKickoffModal, setShowKickoffModal] = useState(false);
  const [uncontactedLeads, setUncontactedLeads] = useState<UncontactedLead[]>([]);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(new Set());
  const [kickoffLoading, setKickoffLoading] = useState(false);
  const [kickoffResult, setKickoffResult] = useState<{ sent: number; failed: number } | null>(null);
  const [pendingAIToggle, setPendingAIToggle] = useState(false);

  // UI State
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  async function handleAIToggle() {
    const isTogglingOn = !editAI.enabled;
    
    if (!isTogglingOn) {
      // Toggling OFF — just save immediately
      setEditAI({ ...editAI, enabled: false });
      setSaving(true);
      try {
        const resp = await fetch("/api/settings/ai", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...editAI, enabled: false }),
        });
        if (!resp.ok) throw new Error("Failed to disable AI");
        setAIConfig({ ...editAI, enabled: false } as AIConfig);
        setSuccess("Hayden is off ✓");
        setTimeout(() => setSuccess(null), 3000);
      } catch (err: any) {
        setError(err?.message || "Failed to save");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Toggling ON — check for uncontacted leads
    try {
      setKickoffLoading(true);
      const res = await fetch("/api/leads/uncontacted", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch uncontacted leads");
      const leads = (await res.json()) as UncontactedLead[];
      
      if (leads.length === 0) {
        // No uncontacted leads — enable immediately
        setEditAI({ ...editAI, enabled: true });
        setSaving(true);
        try {
          const resp = await fetch("/api/settings/ai", {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...editAI, enabled: true }),
          });
          if (!resp.ok) throw new Error("Failed to enable AI");
          setAIConfig({ ...editAI, enabled: true } as AIConfig);
          setSuccess("Hayden is on ✅");
          setTimeout(() => setSuccess(null), 3000);
        } catch (err: any) {
          setError(err?.message || "Failed to save");
        } finally {
          setSaving(false);
        }
      } else {
        // Show modal
        setUncontactedLeads(leads);
        setSelectedLeadIds(new Set(leads.map((l) => l.id)));
        setShowKickoffModal(true);
        setPendingAIToggle(true);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to fetch uncontacted leads");
    } finally {
      setKickoffLoading(false);
    }
  }

  async function handleBulkKickoff() {
    try {
      setKickoffLoading(true);
      const leadIds = Array.from(selectedLeadIds);
      const res = await fetch("/api/leads/bulk-kickoff", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds }),
      });
      if (!res.ok) throw new Error("Failed to kickoff conversations");
      const result = (await res.json()) as { ok: boolean; sent: number; failed: number };
      setKickoffResult({ sent: result.sent, failed: result.failed });
      
      // Now save AI as enabled
      setSaving(true);
      try {
        const resp = await fetch("/api/settings/ai", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...editAI, enabled: true }),
        });
        if (!resp.ok) throw new Error("Failed to enable AI");
        setAIConfig({ ...editAI, enabled: true } as AIConfig);
        setSuccess(
          result.failed > 0
            ? `✅ Sent to ${result.sent} leads, ${result.failed} failed`
            : `✅ Sent to ${result.sent} leads`
        );
        setTimeout(() => setSuccess(null), 4000);
        setShowKickoffModal(false);
        setSelectedLeadIds(new Set());
        setKickoffResult(null);
        setPendingAIToggle(false);
      } catch (err: any) {
        setError(err?.message || "Failed to save");
      } finally {
        setSaving(false);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to kickoff conversations");
    } finally {
      setKickoffLoading(false);
    }
  }

  function handleSkipKickoff() {
    // Save AI enabled without sending messages
    setShowKickoffModal(false);
    setSelectedLeadIds(new Set());
    setKickoffResult(null);
    setPendingAIToggle(false);
    setEditAI({ ...editAI, enabled: true });
    
    setSaving(true);
    fetch("/api/settings/ai", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...editAI, enabled: true }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to enable AI");
        return r.json();
      })
      .then(() => {
        setAIConfig({ ...editAI, enabled: true } as AIConfig);
        setSuccess("Hayden is on ✅");
        setTimeout(() => setSuccess(null), 3000);
      })
      .catch((err: any) => {
        setError(err?.message || "Failed to save");
      })
      .finally(() => {
        setSaving(false);
      });
  }

  function toggleSelectAll() {
    if (selectedLeadIds.size === uncontactedLeads.length) {
      setSelectedLeadIds(new Set());
    } else {
      setSelectedLeadIds(new Set(uncontactedLeads.map((l) => l.id)));
    }
  }

  function toggleLeadSelection(leadId: number) {
    const newSelected = new Set(selectedLeadIds);
    if (newSelected.has(leadId)) {
      newSelected.delete(leadId);
    } else {
      newSelected.add(leadId);
    }
    setSelectedLeadIds(newSelected);
  }

  async function loadSettings() {
    try {
      setLoading(true);
      const requests: any = {
        ai: fetch("/api/settings/ai", { credentials: "include" }).then((r) =>
          r.ok ? r.json() : null
        ),
        owner: fetch("/api/settings", { credentials: "include" }).then((r) =>
          r.ok ? r.json() : null
        ),
      };
      
      // Load users if admin
      if (isAdmin) {
        requests.users = fetch("/api/users", { credentials: "include" }).then((r) =>
          r.ok ? r.json() : []
        );
      }
      
      const results = await Promise.all([
        requests.ai,
        requests.owner,
        requests.users,
      ]);
      
      const [ai, owner, usersData] = results;
      
      // Normalize services_json to ensure proper field names
      if (ai && Array.isArray(ai.services_json)) {
        ai.services_json = ai.services_json.map((s: any) => ({
          label: s.label || "",
          base_price: s.base_price !== undefined ? s.base_price : (s.basePrice || 0),
          floor_price: s.floor_price !== undefined ? s.floor_price : (s.floor || s.floorPrice || 0),
          notes: s.notes || "",
        }));
      }
      
      setAIConfig(ai);
      setEditAI(ai ?? {});
      setOwnerSettings(owner);
      if (usersData && isAdmin) {
        setUsers(usersData);
      }
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load settings");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function saveAIConfig() {
    try {
      setSaving(true);
      const resp = await fetch("/api/settings/ai", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editAI),
      });
      if (!resp.ok) throw new Error("Failed to save AI config");
      setAIConfig(editAI as AIConfig);
      setSuccess("AI settings saved");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function saveOwnerSettings() {
    if (!ownerSettings) return;
    try {
      setSaving(true);
      const resp = await fetch("/api/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner_name: ownerSettings.owner_name,
          google_review_url: ownerSettings.google_review_url,
          eod_offset_hours: ownerSettings.eod_offset_hours,
        }),
      });
      if (!resp.ok) throw new Error("Failed to save owner settings");
      setSuccess("Owner settings saved");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function requestPhoneVerification() {
    if (!pendingPhone) return;
    try {
      setSaving(true);
      const resp = await fetch("/api/settings/phone-verify/request", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: pendingPhone }),
      });
      if (!resp.ok) throw new Error("Failed to request verification");
      setSuccess("Verification code sent");
    } catch (err: any) {
      setError(err?.message || "Failed to send code");
    } finally {
      setSaving(false);
    }
  }

  async function confirmPhoneVerification() {
    if (!verifyCode) return;
    try {
      setSaving(true);
      const resp = await fetch("/api/settings/phone-verify/confirm", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: verifyCode }),
      });
      if (!resp.ok) throw new Error("Invalid or expired code");
      setVerifyPhoneMode(false);
      setPendingPhone("");
      setVerifyCode("");
      await loadSettings();
      setSuccess("Phone verified");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.message || "Failed to verify");
    } finally {
      setSaving(false);
    }
  }

  // ─── User Management (Admin Only) ──────────────────────────────────────────

  async function handleCreateUser() {
    if (!newUser.name || !newUser.email || !newUser.password) {
      setError("Name, email, and password required");
      return;
    }
    try {
      setSaving(true);
      const resp = await fetch("/api/users", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error || "Failed to create user");
      }
      setNewUser({ name: "", email: "", password: "", role: "rep" });
      setShowAddUserForm(false);
      await loadSettings();
      setSuccess("User created successfully");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.message || "Failed to create user");
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateUser() {
    if (!editingUser) return;
    try {
      setSaving(true);
      const resp = await fetch(`/api/users/${editingUser.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editUserForm),
      });
      if (!resp.ok) throw new Error("Failed to update user");
      setEditingUser(null);
      setEditUserForm({});
      await loadSettings();
      setSuccess("User updated successfully");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.message || "Failed to update user");
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword() {
    const user = users.find((u) => u.email === resetUserEmail);
    if (!user || !resetPassword) {
      setError("User and password required");
      return;
    }
    try {
      setSaving(true);
      const resp = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword }),
      });
      if (!resp.ok) throw new Error("Failed to reset password");
      setShowPasswordReset(false);
      setResetUserEmail("");
      setResetPassword("");
      setSuccess("Password reset successfully");
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err?.message || "Failed to reset password");
    } finally {
      setSaving(false);
    }
  }

  function handleAddService() {
    if (!newService.label || newService.base_price === undefined) return;
    const current = editAI.services_json || [];
    setEditAI({
      ...editAI,
      services_json: [...current, newService],
    });
    setNewService({ label: "", base_price: 0, floor_price: 0, notes: "" });
  }

  function handleDeleteService(idx: number) {
    const current = editAI.services_json || [];
    setEditAI({
      ...editAI,
      services_json: current.filter((_, i) => i !== idx),
    });
  }

  function handleAddCity() {
    if (!newCity.trim()) return;
    const current = editAI.route_cities_json || [];
    if (!current.includes(newCity.trim())) {
      setEditAI({
        ...editAI,
        route_cities_json: [...current, newCity.trim()],
      });
    }
    setNewCity("");
  }

  function handleDeleteCity(city: string) {
    const current = editAI.route_cities_json || [];
    setEditAI({
      ...editAI,
      route_cities_json: current.filter((c) => c !== city),
    });
  }

  function toggleWorkDay(day: number) {
    const current = editAI.business_hours_json || {
      timezone: "America/New_York",
      work_days: [],
      work_start: "09:00",
      work_end: "17:00",
    };
    const workDays = [...(current.work_days || [])];
    if (workDays.includes(day)) {
      workDays.splice(workDays.indexOf(day), 1);
    } else {
      workDays.push(day);
      workDays.sort();
    }
    setEditAI({
      ...editAI,
      business_hours_json: { ...current, work_days: workDays },
    });
  }

  const brand = me.tenant.brandColor;
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const timezones = [
    { value: "America/New_York", label: "America/New_York (Eastern)" },
    { value: "America/Chicago", label: "America/Chicago (Central)" },
    { value: "America/Denver", label: "America/Denver (Mountain)" },
    { value: "America/Los_Angeles", label: "America/Los_Angeles (Pacific)" },
    { value: "America/Phoenix", label: "America/Phoenix (Arizona)" },
    { value: "America/Anchorage", label: "America/Anchorage (Alaska)" },
    { value: "Pacific/Honolulu", label: "Pacific/Honolulu (Hawaii)" },
  ];

  if (loading) {
    return (
      <div className="relative z-10 min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/10 border-t-[var(--color-gold)] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative z-10 min-h-screen pb-24">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[rgba(10,10,10,0.78)] border-b border-[var(--color-border)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3">
          <h1 className="text-2xl font-bold text-white mb-4">Settings</h1>

          {/* Tabs */}
          <div className="flex gap-2 border-b border-[var(--color-border)]">
            {(
              isAdmin
                ? [
                    { key: "hayden" as const, label: "🤖 Hayden AI" },
                    { key: "pricing" as const, label: "💰 Pricing & Services" },
                    { key: "hours" as const, label: "⏰ Hours & Limits" },
                    { key: "owner" as const, label: "👤 Owner & Notifications" },
                    { key: "users" as const, label: "👥 Users & Access" },
                  ]
                : [
                    { key: "hayden" as const, label: "🤖 Hayden AI" },
                    { key: "pricing" as const, label: "💰 Pricing & Services" },
                    { key: "hours" as const, label: "⏰ Hours & Limits" },
                    { key: "owner" as const, label: "👤 Owner & Notifications" },
                  ]
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
                  activeTab === key
                    ? "border-[var(--color-gold)] text-[var(--color-gold)]"
                    : "border-transparent text-[var(--color-text-soft)] hover:text-white"
                }`}
                style={activeTab === key ? { borderBottomColor: brand } : undefined}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Error/Success messages */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-6 p-4 bg-green-500/20 border border-green-500/50 rounded-lg text-green-200 text-sm">
            {success}
          </div>
        )}

        {/* TAB: Hayden AI */}
        {activeTab === "hayden" && (
          <div className="space-y-8">
            {/* AI Toggle */}
            <div className="surface p-6 rounded-xl">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-white mb-1">Hayden AI</h2>
                  <p className="text-sm text-[var(--color-text-soft)]">
                    Automatically respond to new leads via SMS
                  </p>
                </div>
                <button
                  onClick={handleAIToggle}
                  disabled={kickoffLoading || saving}
                  className={`relative w-14 h-8 rounded-full transition-colors ${
                    editAI.enabled ? "bg-[var(--color-gold)]" : "bg-gray-700"
                  } ${kickoffLoading || saving ? "opacity-50 cursor-not-allowed" : ""}`}
                  style={editAI.enabled ? { backgroundColor: brand } : undefined}
                >
                  <div
                    className={`absolute top-1 left-1 w-6 h-6 bg-black rounded-full transition-transform ${
                      editAI.enabled ? "translate-x-6" : ""
                    }`}
                  />
                </button>
              </div>

              {!editAI.enabled && (
                <div className="mt-4 p-3 bg-yellow-500/20 border border-yellow-500/50 rounded-lg text-yellow-200 text-sm flex items-center gap-2">
                  <span>⚠️</span>
                  <span>Hayden is disabled — new leads will not receive automatic SMS responses.</span>
                </div>
              )}
            </div>

            {/* Model — locked to Auto */}
            <div className="surface p-6 rounded-xl">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-bold text-white">Model</h3>
                <span className="text-xs text-[var(--color-text-soft)] bg-[var(--color-bg-soft)] border border-[var(--color-border)] px-2 py-0.5 rounded">Locked</span>
              </div>
              <div className="flex items-center gap-3 p-4 rounded-lg border-2 bg-[var(--color-gold)]/5" style={{ borderColor: brand }}>
                <div className="text-2xl">🤖</div>
                <div>
                  <div className="font-bold text-white">Auto</div>
                  <div className="text-sm text-[var(--color-text-soft)]">
                    Sonnet for conversations &amp; closing — Haiku for classification &amp; analysis. Automatically selects the best model for each task.
                  </div>
                </div>
              </div>
            </div>

            {/* Persona */}
            <div className="surface p-6 rounded-xl">
              <h3 className="text-lg font-bold text-white mb-4">Persona</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-white mb-2">Persona Name</label>
                  <input
                    type="text"
                    value={editAI.persona_name || ""}
                    onChange={(e) =>
                      setEditAI({ ...editAI, persona_name: e.target.value })
                    }
                    className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-[var(--color-gold)]"
                    placeholder="Hayden"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-white mb-2">
                    Business Name Override (optional)
                  </label>
                  <input
                    type="text"
                    value={editAI.business_name || ""}
                    onChange={(e) =>
                      setEditAI({ ...editAI, business_name: e.target.value || null })
                    }
                    className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-[var(--color-gold)]"
                    placeholder="Leave blank to use your business name"
                  />
                </div>
              </div>
            </div>

            {/* Custom Brand Notes */}
            <div className="surface p-6 rounded-xl">
              <h3 className="text-lg font-bold text-white mb-4">Custom Instructions</h3>
              <textarea
                value={editAI.custom_brand_notes || ""}
                onChange={(e) =>
                  setEditAI({ ...editAI, custom_brand_notes: e.target.value || null })
                }
                className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-[var(--color-gold)]"
                placeholder="e.g. Always mention our 5-star rating. Never quote jobs over 5,000 sqft without manager approval."
                rows={5}
                style={{ minHeight: "200px" }}
              />
            </div>

            {/* Save Button */}
            <button
              onClick={saveAIConfig}
              disabled={saving}
              className="w-full px-6 py-3 bg-[var(--color-gold)] text-black font-bold rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: brand }}
            >
              {saving ? "Saving..." : "Save AI Settings"}
            </button>
          </div>
        )}

        {/* TAB: Pricing & Services */}
        {activeTab === "pricing" && (
          <div className="space-y-8">

            {/* Pricing explainer */}
            <div className="surface p-4 rounded-xl border border-[var(--color-gold)]/20">
              <p className="text-xs text-[var(--color-text-soft)]">
                <span className="text-[var(--color-gold)] font-bold">How pricing works:</span> Hayden quotes
                the <strong>Base Price</strong> by default. The <strong>Floor Price</strong> is the minimum
                she can drop to using save-the-sale discounts (review pledge + transport waive). She will
                never go below floor. Notes are visible to Hayden during conversations for context.
              </p>
            </div>

            {/* Services List */}
            <div className="surface p-6 rounded-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white">Services</h3>
                <span className="text-xs text-[var(--color-text-faint)]">{(editAI.services_json || []).length} configured</span>
              </div>

              {(editAI.services_json || []).length > 0 && (
                <div className="space-y-4 mb-6">
                  {(editAI.services_json || []).map((service, idx) => {
                    const headroom = service.base_price - service.floor_price;
                    const reviewD = editAI.review_discount || 0;
                    const transportD = editAI.transport_waive || 0;
                    const totalDiscount = reviewD + transportD;
                    const safeFloor = service.base_price - totalDiscount;
                    return (
                    <div
                      key={idx}
                      className="p-4 bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-xl"
                    >
                      {/* Row 1: Name + prices + delete */}
                      <div className="flex items-start gap-3 mb-3">
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] block mb-1">Service Name</label>
                            <input
                              type="text"
                              value={service.label}
                              onChange={(e) => {
                                const updated = [...(editAI.services_json || [])];
                                updated[idx] = { ...updated[idx], label: e.target.value };
                                setEditAI({ ...editAI, services_json: updated });
                              }}
                              className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] text-white px-2.5 py-1.5 rounded-lg text-sm focus:outline-none focus:border-[var(--color-gold)]"
                              placeholder="e.g., House Wash"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] block mb-1">Base Price (quoted)</label>
                            <div className="relative">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)] text-sm">$</span>
                              <input
                                type="number"
                                value={service.base_price}
                                onChange={(e) => {
                                  const updated = [...(editAI.services_json || [])];
                                  updated[idx] = { ...updated[idx], base_price: Number(e.target.value) };
                                  setEditAI({ ...editAI, services_json: updated });
                                }}
                                className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] text-white pl-6 pr-2.5 py-1.5 rounded-lg text-sm focus:outline-none focus:border-[var(--color-gold)]"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] block mb-1">Floor Price (min)</label>
                            <div className="relative">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)] text-sm">$</span>
                              <input
                                type="number"
                                value={service.floor_price}
                                onChange={(e) => {
                                  const updated = [...(editAI.services_json || [])];
                                  updated[idx] = { ...updated[idx], floor_price: Number(e.target.value) };
                                  setEditAI({ ...editAI, services_json: updated });
                                }}
                                className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] text-white pl-6 pr-2.5 py-1.5 rounded-lg text-sm focus:outline-none focus:border-[var(--color-gold)]"
                              />
                            </div>
                          </div>
                        </div>
                        <button onClick={() => handleDeleteService(idx)} className="mt-5 text-red-400 hover:text-red-300 text-lg shrink-0">✕</button>
                      </div>

                      {/* Row 2: Notes for Hayden */}
                      <div className="mb-3">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-faint)] block mb-1">Notes for Hayden (upsells, inclusions, talking points)</label>
                        <input
                          type="text"
                          value={service.notes || ""}
                          onChange={(e) => {
                            const updated = [...(editAI.services_json || [])];
                            updated[idx] = { ...updated[idx], notes: e.target.value };
                            setEditAI({ ...editAI, services_json: updated });
                          }}
                          className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] text-white px-2.5 py-1.5 rounded-lg text-sm focus:outline-none focus:border-[var(--color-gold)] placeholder:text-[var(--color-text-faint)]"
                          placeholder="e.g., includes gutters, mention softwash process, upsell driveway cleaning"
                        />
                      </div>

                      {/* Row 3: Discount headroom preview */}
                      <div className="flex flex-wrap gap-3 text-[10px]">
                        <span className="text-[var(--color-text-faint)]">
                          Discount headroom: <span className={headroom >= totalDiscount ? "text-emerald-400 font-bold" : "text-red-400 font-bold"}>${headroom}</span>
                          {headroom < totalDiscount && <span className="text-red-400 ml-1">(⚠ below total discount ${totalDiscount} — raise base or floor)</span>}
                        </span>
                        {service.floor_price > 0 && (
                          <span className="text-[var(--color-text-faint)]">
                            Min Hayden will go: <span className="text-[var(--color-gold)] font-bold">${service.floor_price}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  )})}
                </div>
              )}

              {/* Add Service Form */}
              <div className="p-4 bg-[var(--color-bg-soft)] border border-[var(--color-gold)]/20 rounded-xl">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-gold)] mb-3">+ New Service</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                  <input type="text" value={newService.label}
                    onChange={e => setNewService({ ...newService, label: e.target.value })}
                    placeholder="Service name (e.g. House Wash)"
                    className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-[var(--color-gold)] placeholder:text-[var(--color-text-faint)]"
                  />
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)] text-sm">$</span>
                    <input type="number" value={newService.base_price}
                      onChange={e => setNewService({ ...newService, base_price: Number(e.target.value) })}
                      placeholder="Base price"
                      className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] text-white pl-6 pr-3 py-2 rounded-lg text-sm focus:outline-none focus:border-[var(--color-gold)]"
                    />
                  </div>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-faint)] text-sm">$</span>
                    <input type="number" value={newService.floor_price}
                      onChange={e => setNewService({ ...newService, floor_price: Number(e.target.value) })}
                      placeholder="Floor price (min)"
                      className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] text-white pl-6 pr-3 py-2 rounded-lg text-sm focus:outline-none focus:border-[var(--color-gold)]"
                    />
                  </div>
                </div>
                <input type="text" value={newService.notes || ""}
                  onChange={e => setNewService({ ...newService, notes: e.target.value })}
                  placeholder="Notes for Hayden (upsells, inclusions, talking points) — optional"
                  className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] text-white px-3 py-2 rounded-lg text-sm focus:outline-none focus:border-[var(--color-gold)] placeholder:text-[var(--color-text-faint)] mb-3"
                />
                <button onClick={handleAddService} className="btn-gold w-full text-sm">
                  + Add Service
                </button>
              </div>
            </div>

            {/* Save-the-Sale Discounts */}
            <div className="surface p-6 rounded-xl">
              <h3 className="text-lg font-bold text-white mb-4">Save-the-Sale Discounts</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
                <div>
                  <label className="block text-sm font-semibold text-white mb-2">
                    Review Pledge Discount ($)
                  </label>
                  <input
                    type="number"
                    value={editAI.review_discount || 0}
                    onChange={(e) =>
                      setEditAI({
                        ...editAI,
                        review_discount: Number(e.target.value),
                      })
                    }
                    className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-[var(--color-gold)]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-white mb-2">
                    Transport Fee Waive ($)
                  </label>
                  <input
                    type="number"
                    value={editAI.transport_waive || 0}
                    onChange={(e) =>
                      setEditAI({
                        ...editAI,
                        transport_waive: Number(e.target.value),
                      })
                    }
                    className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-[var(--color-gold)]"
                  />
                </div>
              </div>
              <p className="text-xs text-[var(--color-text-soft)]">
                These are baked into your base prices. Hayden uses them as closing levers only.
              </p>
            </div>

            {/* Route Cities */}
            <div className="surface p-6 rounded-xl">
              <h3 className="text-lg font-bold text-white mb-4">Service Cities</h3>
              <div className="flex flex-wrap gap-2 mb-4">
                {(editAI.route_cities_json || []).map((city) => (
                  <div
                    key={city}
                    className="inline-flex items-center gap-2 px-3 py-1 bg-[var(--color-gold)]/20 text-[var(--color-gold)] rounded-full text-sm"
                    style={{
                      backgroundColor: `${brand}33`,
                      color: brand,
                    }}
                  >
                    {city}
                    <button
                      onClick={() => handleDeleteCity(city)}
                      className="text-lg leading-none hover:opacity-70"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCity}
                  onChange={(e) => setNewCity(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddCity()}
                  placeholder="e.g., Denver, Boulder, Arvada"
                  className="flex-1 bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-[var(--color-gold)]"
                />
                <button
                  onClick={handleAddCity}
                  className="px-4 py-2 bg-[var(--color-gold)]/20 text-[var(--color-gold)] font-semibold rounded hover:bg-[var(--color-gold)]/30 transition-colors"
                  style={{ color: brand, backgroundColor: `${brand}33` }}
                >
                  Add
                </button>
              </div>
            </div>

            {/* Save Button */}
            <button
              onClick={saveAIConfig}
              disabled={saving}
              className="w-full px-6 py-3 bg-[var(--color-gold)] text-black font-bold rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: brand }}
            >
              {saving ? "Saving..." : "Save Pricing & Services"}
            </button>
          </div>
        )}

        {/* TAB: Hours & Limits */}
        {activeTab === "hours" && (
          <div className="space-y-8">
            {/* Business Hours */}
            <div className="surface p-6 rounded-xl">
              <h3 className="text-lg font-bold text-white mb-4">Business Hours</h3>

              {/* Work Days */}
              <div className="mb-6">
                <label className="block text-sm font-semibold text-white mb-3">
                  Work Days
                </label>
                <div className="flex flex-wrap gap-2">
                  {dayNames.map((day, idx) => (
                    <button
                      key={idx}
                      onClick={() => toggleWorkDay(idx)}
                      className={`w-10 h-10 rounded-lg font-semibold transition-colors ${
                        (editAI.business_hours_json?.work_days || []).includes(idx)
                          ? "bg-[var(--color-gold)] text-black"
                          : "bg-[var(--color-bg-soft)] border border-[var(--color-border)] text-white hover:bg-[var(--color-border)]"
                      }`}
                      style={
                        (editAI.business_hours_json?.work_days || []).includes(idx)
                          ? { backgroundColor: brand }
                          : undefined
                      }
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time Pickers */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-semibold text-white mb-2">
                    Opening Time
                  </label>
                  <input
                    type="time"
                    value={editAI.business_hours_json?.work_start || "09:00"}
                    onChange={(e) => {
                      const current = editAI.business_hours_json || {
                        timezone: "America/New_York",
                        work_days: [],
                        work_start: "09:00",
                        work_end: "17:00",
                      };
                      setEditAI({
                        ...editAI,
                        business_hours_json: {
                          ...current,
                          work_start: e.target.value,
                        },
                      });
                    }}
                    className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[var(--color-gold)]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-white mb-2">
                    Closing Time
                  </label>
                  <input
                    type="time"
                    value={editAI.business_hours_json?.work_end || "17:00"}
                    onChange={(e) => {
                      const current = editAI.business_hours_json || {
                        timezone: "America/New_York",
                        work_days: [],
                        work_start: "09:00",
                        work_end: "17:00",
                      };
                      setEditAI({
                        ...editAI,
                        business_hours_json: {
                          ...current,
                          work_end: e.target.value,
                        },
                      });
                    }}
                    className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[var(--color-gold)]"
                  />
                </div>
              </div>

              {/* Timezone */}
              <div>
                <label className="block text-sm font-semibold text-white mb-2">
                  Timezone
                </label>
                <select
                  value={editAI.business_hours_json?.timezone || "America/New_York"}
                  onChange={(e) => {
                    const current = editAI.business_hours_json || {
                      timezone: "America/New_York",
                      work_days: [],
                      work_start: "09:00",
                      work_end: "17:00",
                    };
                    setEditAI({
                      ...editAI,
                      business_hours_json: {
                        ...current,
                        timezone: e.target.value,
                      },
                    });
                  }}
                  className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[var(--color-gold)]"
                >
                  {timezones.map(({ value, label }) => (
                    <option key={value} value={value} className="bg-gray-900">
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Conversation Limits */}
            <div className="surface p-6 rounded-xl">
              <h3 className="text-lg font-bold text-white mb-4">Conversation Limits</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-white mb-2">
                    Max Messages per Lead
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={editAI.max_msgs_per_lead || 30}
                    onChange={(e) =>
                      setEditAI({
                        ...editAI,
                        max_msgs_per_lead: Number(e.target.value),
                      })
                    }
                    className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[var(--color-gold)]"
                  />
                  <p className="text-xs text-[var(--color-text-soft)] mt-1">
                    Hayden stops texting and hands off after this many messages
                  </p>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <button
              onClick={saveAIConfig}
              disabled={saving}
              className="w-full px-6 py-3 bg-[var(--color-gold)] text-black font-bold rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
              style={{ backgroundColor: brand }}
            >
              {saving ? "Saving..." : "Save Hours & Limits"}
            </button>
          </div>
        )}

        {/* TAB: Owner & Notifications */}
        {activeTab === "owner" && ownerSettings && (
          <div className="space-y-8">
            {/* Owner Info */}
            <div className="surface p-6 rounded-xl">
              <h3 className="text-lg font-bold text-white mb-4">Owner Information</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-white mb-2">
                    Owner Name
                  </label>
                  <input
                    type="text"
                    value={ownerSettings.owner_name || ""}
                    onChange={(e) =>
                      setOwnerSettings({
                        ...ownerSettings,
                        owner_name: e.target.value || null,
                      })
                    }
                    onBlur={saveOwnerSettings}
                    className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-[var(--color-gold)]"
                    placeholder="Your name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-white mb-2">
                    Owner Phone
                  </label>
                  {!verifyPhoneMode ? (
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <input
                          type="tel"
                          value={ownerSettings.owner_phone || ""}
                          disabled
                          className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white opacity-60"
                          placeholder="Not set"
                        />
                        {ownerSettings.owner_phone_verified && (
                          <p className="text-xs text-green-400 mt-1">✓ Verified</p>
                        )}
                      </div>
                      <button
                        onClick={() => setVerifyPhoneMode(true)}
                        className="px-4 py-2 bg-[var(--color-gold)]/20 text-[var(--color-gold)] font-semibold rounded hover:bg-[var(--color-gold)]/30 transition-colors"
                        style={{
                          color: brand,
                          backgroundColor: `${brand}33`,
                        }}
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <input
                        type="tel"
                        value={pendingPhone}
                        onChange={(e) => setPendingPhone(e.target.value)}
                        placeholder="Enter new phone number"
                        className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-[var(--color-gold)]"
                      />
                      {!verifyCode && (
                        <button
                          onClick={requestPhoneVerification}
                          disabled={!pendingPhone || saving}
                          className="w-full px-4 py-2 bg-[var(--color-gold)] text-black font-semibold rounded hover:opacity-90 disabled:opacity-50"
                          style={{ backgroundColor: brand }}
                        >
                          {saving ? "Sending..." : "Send Verification Code"}
                        </button>
                      )}
                      {verifyCode || true && (
                        <>
                          <input
                            type="text"
                            value={verifyCode}
                            onChange={(e) => setVerifyCode(e.target.value)}
                            placeholder="Verification code"
                            className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-[var(--color-gold)]"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={confirmPhoneVerification}
                              disabled={!verifyCode || saving}
                              className="flex-1 px-4 py-2 bg-[var(--color-gold)] text-black font-semibold rounded hover:opacity-90 disabled:opacity-50"
                              style={{ backgroundColor: brand }}
                            >
                              {saving ? "Verifying..." : "Verify"}
                            </button>
                            <button
                              onClick={() => {
                                setVerifyPhoneMode(false);
                                setPendingPhone("");
                                setVerifyCode("");
                              }}
                              className="flex-1 px-4 py-2 bg-[var(--color-border)] text-white font-semibold rounded hover:bg-[var(--color-border)]/80"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Notifications */}
            <div className="surface p-6 rounded-xl">
              <h3 className="text-lg font-bold text-white mb-4">Notifications</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-white mb-2">
                    Google Review URL
                  </label>
                  <input
                    type="url"
                    value={ownerSettings.google_review_url || ""}
                    onChange={(e) =>
                      setOwnerSettings({
                        ...ownerSettings,
                        google_review_url: e.target.value || null,
                      })
                    }
                    onBlur={saveOwnerSettings}
                    className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-[var(--color-gold)]"
                    placeholder="https://google.com/..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-white mb-2">
                    EOD Check (hours after work ends)
                  </label>
                  <input
                    type="number"
                    step={0.5}
                    value={ownerSettings.eod_offset_hours || 1}
                    onChange={(e) =>
                      setOwnerSettings({
                        ...ownerSettings,
                        eod_offset_hours: Number(e.target.value),
                      })
                    }
                    onBlur={saveOwnerSettings}
                    className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-[var(--color-gold)]"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: Users & Access */}
        {activeTab === "users" && isAdmin && (
          <div className="space-y-8">
            {/* Current User Info */}
            <div className="surface p-6 rounded-xl">
              <h3 className="text-lg font-bold text-white mb-4">Current Session</h3>
              <div className="p-4 bg-[var(--color-gold)]/10 border border-[var(--color-gold)]/30 rounded-lg">
                <p className="text-white font-semibold">
                  Signed in as <span className="text-[var(--color-gold)]">{me.role === "admin" ? "Admin" : me.role}</span>
                </p>
              </div>
            </div>

            {/* Add User Form */}
            {!showAddUserForm ? (
              <button
                onClick={() => setShowAddUserForm(true)}
                className="px-6 py-3 bg-[var(--color-gold)] text-black font-semibold rounded-lg hover:opacity-90"
                style={{ backgroundColor: brand }}
              >
                + Add User
              </button>
            ) : (
              <div className="surface p-6 rounded-xl">
                <h3 className="text-lg font-bold text-white mb-4">Create New User</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-white mb-2">Name</label>
                    <input
                      type="text"
                      value={newUser.name}
                      onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                      className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white"
                      placeholder="Full name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-white mb-2">Email</label>
                    <input
                      type="email"
                      value={newUser.email}
                      onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                      className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white"
                      placeholder="user@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-white mb-2">Password</label>
                    <input
                      type="password"
                      value={newUser.password}
                      onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                      className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white"
                      placeholder="••••••••"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-white mb-2">Role</label>
                    <select
                      value={newUser.role}
                      onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                      className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white"
                    >
                      <option value="admin">Admin — Full access</option>
                      <option value="rep">Rep — Leads & messages</option>
                      <option value="viewer">Viewer — Read-only</option>
                    </select>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={handleCreateUser}
                      disabled={saving}
                      className="flex-1 px-4 py-2 bg-[var(--color-gold)] text-black font-semibold rounded-lg hover:opacity-90 disabled:opacity-50"
                      style={{ backgroundColor: brand }}
                    >
                      {saving ? "Creating..." : "Create User"}
                    </button>
                    <button
                      onClick={() => {
                        setShowAddUserForm(false);
                        setNewUser({ name: "", email: "", password: "", role: "rep" });
                      }}
                      className="flex-1 px-4 py-2 bg-[var(--color-border)] text-white font-semibold rounded-lg hover:bg-[var(--color-border)]/80"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Users List */}
            <div className="surface p-6 rounded-xl">
              <h3 className="text-lg font-bold text-white mb-4">Team Members ({users.length})</h3>
              <div className="space-y-3">
                {users.map((user) => {
                  const lastLoginDate = user.last_login_at
                    ? new Date(user.last_login_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                    : "Never";
                  const roleColor = user.role === "admin" ? "text-yellow-400" : user.role === "rep" ? "text-blue-400" : "text-gray-400";
                  const roleBgColor = user.role === "admin" ? "bg-yellow-500/20" : user.role === "rep" ? "bg-blue-500/20" : "bg-gray-500/20";
                  
                  return (
                    <div
                      key={user.id}
                      className="flex items-center justify-between p-4 bg-[var(--color-bg-soft)] rounded-lg border border-[var(--color-border)]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <div>
                            <p className="font-semibold text-white">{user.name}</p>
                            <p className="text-xs text-[var(--color-text-soft)]">{user.email}</p>
                          </div>
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${roleColor} ${roleBgColor}`}>
                            {user.role.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--color-text-soft)] mt-2">Last login: {lastLoginDate}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setEditingUser(user);
                            setEditUserForm({ name: user.name, role: user.role, enabled: user.enabled });
                          }}
                          className="px-3 py-2 text-xs bg-[var(--color-gold)]/20 text-[var(--color-gold)] rounded hover:bg-[var(--color-gold)]/30"
                          style={{ color: brand, backgroundColor: `${brand}33` }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            setResetUserEmail(user.email);
                            setShowPasswordReset(true);
                          }}
                          className="px-3 py-2 text-xs bg-gray-600/50 text-gray-300 rounded hover:bg-gray-600"
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Role Permission Matrix */}
            <div className="surface p-6 rounded-xl">
              <h3 className="text-lg font-bold text-white mb-4">Role Permissions</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)]">
                      <th className="text-left py-2 px-3 font-semibold text-white">Feature</th>
                      <th className="text-center py-2 px-3 font-semibold text-[var(--color-gold)]">Admin</th>
                      <th className="text-center py-2 px-3 font-semibold text-blue-400">Rep</th>
                      <th className="text-center py-2 px-3 font-semibold text-gray-400">Viewer</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-[var(--color-border)]">
                      <td className="py-2 px-3 text-white">Leads & Messages</td>
                      <td className="text-center">✅</td>
                      <td className="text-center">✅</td>
                      <td className="text-center">👁 Read</td>
                    </tr>
                    <tr className="border-b border-[var(--color-border)]">
                      <td className="py-2 px-3 text-white">Calls & Schedule</td>
                      <td className="text-center">✅</td>
                      <td className="text-center">✅</td>
                      <td className="text-center">👁 Read</td>
                    </tr>
                    <tr className="border-b border-[var(--color-border)]">
                      <td className="py-2 px-3 text-white">Stats & Analytics</td>
                      <td className="text-center">✅</td>
                      <td className="text-center">✅</td>
                      <td className="text-center">✅</td>
                    </tr>
                    <tr className="border-b border-[var(--color-border)]">
                      <td className="py-2 px-3 text-white">Settings & AI</td>
                      <td className="text-center">✅</td>
                      <td className="text-center">❌</td>
                      <td className="text-center">❌</td>
                    </tr>
                    <tr>
                      <td className="py-2 px-3 text-white">Manage Users</td>
                      <td className="text-center">✅</td>
                      <td className="text-center">❌</td>
                      <td className="text-center">❌</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setEditingUser(null)} />
          <div className="relative z-10 bg-[var(--color-bg-hard)] border border-[var(--color-border)] rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6">
            <h2 className="text-xl font-bold text-white mb-4">Edit User</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-white mb-2">Name</label>
                <input
                  type="text"
                  value={editUserForm.name || ""}
                  onChange={(e) => setEditUserForm({ ...editUserForm, name: e.target.value })}
                  className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-white mb-2">Role</label>
                <select
                  value={editUserForm.role || "rep"}
                  onChange={(e) => setEditUserForm({ ...editUserForm, role: e.target.value })}
                  className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white"
                >
                  <option value="admin">Admin</option>
                  <option value="rep">Rep</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editUserForm.enabled !== false}
                  onChange={(e) => setEditUserForm({ ...editUserForm, enabled: e.target.checked })}
                  className="w-4 h-4 cursor-pointer accent-[var(--color-gold)]"
                  style={{ accentColor: brand }}
                />
                <label className="text-sm text-white">Enabled</label>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleUpdateUser}
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-[var(--color-gold)] text-black font-semibold rounded-lg hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: brand }}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => {
                    setEditingUser(null);
                    setEditUserForm({});
                  }}
                  className="flex-1 px-4 py-2 bg-[var(--color-border)] text-white font-semibold rounded-lg hover:bg-[var(--color-border)]/80"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showPasswordReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowPasswordReset(false)} />
          <div className="relative z-10 bg-[var(--color-bg-hard)] border border-[var(--color-border)] rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6">
            <h2 className="text-xl font-bold text-white mb-4">Reset Password</h2>
            <p className="text-sm text-[var(--color-text-soft)] mb-4">User: {resetUserEmail}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-white mb-2">New Password</label>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  className="w-full bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-white"
                  placeholder="••••••••"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleResetPassword}
                  disabled={saving || !resetPassword}
                  className="flex-1 px-4 py-2 bg-[var(--color-gold)] text-black font-semibold rounded-lg hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: brand }}
                >
                  {saving ? "Resetting..." : "Reset"}
                </button>
                <button
                  onClick={() => {
                    setShowPasswordReset(false);
                    setResetUserEmail("");
                    setResetPassword("");
                  }}
                  className="flex-1 px-4 py-2 bg-[var(--color-border)] text-white font-semibold rounded-lg hover:bg-[var(--color-border)]/80"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch Kickoff Modal */}
      {showKickoffModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => !kickoffLoading && handleSkipKickoff()}
          />
          {/* Modal */}
          <div className="relative z-10 bg-[var(--color-bg-hard)] border border-[var(--color-border)] rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-6 border-b border-[var(--color-border)]">
              <h2 className="text-2xl font-bold text-white mb-2">🤖 Hayden is turning on — send opening messages?</h2>
              <p className="text-sm text-[var(--color-text-soft)]">
                These leads haven't been contacted yet. Select which ones you want Hayden to text right now.
              </p>
            </div>

            {/* Select All / Deselect All */}
            <div className="px-6 py-3 bg-[var(--color-bg-soft)] border-b border-[var(--color-border)] flex items-center gap-3">
              <input
                type="checkbox"
                checked={selectedLeadIds.size === uncontactedLeads.length && uncontactedLeads.length > 0}
                onChange={toggleSelectAll}
                className="w-4 h-4 cursor-pointer accent-[var(--color-gold)]"
                style={{ accentColor: brand }}
              />
              <label className="text-sm font-semibold text-white cursor-pointer">
                {selectedLeadIds.size === uncontactedLeads.length
                  ? `Deselect All (${uncontactedLeads.length})`
                  : `Select All (${uncontactedLeads.length})`}
              </label>
            </div>

            {/* Lead List */}
            <div className="overflow-y-auto flex-1 px-6 py-4">
              <div className="space-y-3">
                {uncontactedLeads.map((lead) => {
                  const leadDate = new Date(lead.created_at);
                  const monthDay = leadDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  const isSelected = selectedLeadIds.has(lead.id);

                  return (
                    <div
                      key={lead.id}
                      className={`p-3 rounded-lg border transition-colors ${
                        isSelected
                          ? "bg-[var(--color-gold)]/10 border-[var(--color-gold)]"
                          : "bg-[var(--color-bg-soft)] border-[var(--color-border)] hover:border-[var(--color-border)]/70"
                      } cursor-pointer flex items-start gap-3`}
                      onClick={() => toggleLeadSelection(lead.id)}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleLeadSelection(lead.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-4 h-4 mt-1 cursor-pointer accent-[var(--color-gold)]"
                        style={{ accentColor: brand }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-white">{lead.full_name || "(No name)"}</span>
                          <span className="text-xs text-[var(--color-text-soft)]">{monthDay}</span>
                        </div>
                        <div className="text-sm text-[var(--color-text-soft)] mb-1">{lead.phone}</div>
                        {lead.notes && (
                          <div className="text-xs text-[var(--color-text-soft)] truncate italic">{lead.notes}</div>
                        )}
                        {lead.lead_score !== null && (
                          <div className="mt-1">
                            <span className="inline-block px-2 py-1 bg-[var(--color-gold)]/20 text-[var(--color-gold)] rounded text-xs font-semibold">
                              Score: {lead.lead_score}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-[var(--color-border)] bg-[var(--color-bg-soft)] flex gap-3">
              <button
                onClick={handleSkipKickoff}
                disabled={kickoffLoading || saving}
                className="flex-1 px-4 py-3 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-semibold rounded-lg transition"
              >
                Skip — just enable AI
              </button>
              <button
                onClick={handleBulkKickoff}
                disabled={kickoffLoading || saving || selectedLeadIds.size === 0}
                className="flex-1 px-4 py-3 bg-[var(--color-gold)] hover:opacity-90 disabled:opacity-50 text-black font-semibold rounded-lg transition"
                style={{ backgroundColor: brand }}
              >
                {kickoffLoading ? "Sending..." : `Send to ${selectedLeadIds.size} Selected`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
