import { useEffect, useState } from "react";
import type { MePayload } from "../lib/api";

interface Tenant {
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
  leadCount?: number;
  appointmentCount?: number;
  revenue?: number;
}

interface Props {
  me: MePayload;
}

export function Admin({ me }: Props) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formTwilio, setFormTwilio] = useState("");
  const [formFbPage, setFormFbPage] = useState("");
  const [formFbForm, setFormFbForm] = useState("");
  const [formColor, setFormColor] = useState("#fbbf24");
  const [saving, setSaving] = useState(false);

  async function fetchTenants() {
    try {
      setLoading(true);
      const adminSecret = localStorage.getItem("admin_secret") || "";
      const res = await fetch("/admin/api/tenants", {
        credentials: "include",
        headers: { "X-Admin-Secret": adminSecret },
      });
      if (res.ok) {
        setTenants(await res.json());
        setError(null);
      } else {
        setError("Failed to load tenants - invalid admin secret");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load tenants");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTenants();
  }, []);

  async function createTenant() {
    if (!formName || !formSlug || !formPassword) {
      setError("Name, slug, and password required");
      return;
    }

    try {
      setSaving(true);
      const adminSecret = localStorage.getItem("admin_secret") || "";
      const res = await fetch("/admin/api/tenants", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Secret": adminSecret,
        },
        body: JSON.stringify({
          name: formName,
          slug: formSlug,
          password: formPassword,
          twilioFrom: formTwilio || null,
          fbPageId: formFbPage || null,
          fbFormId: formFbForm || null,
          brandColor: formColor,
        }),
      });

      if (res.ok) {
        setFormName("");
        setFormSlug("");
        setFormPassword("");
        setFormTwilio("");
        setFormFbPage("");
        setFormFbForm("");
        setFormColor("#fbbf24");
        setShowForm(false);
        await fetchTenants();
      } else {
        const err = await res.json();
        setError(err.error || "Failed to create tenant");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to create tenant");
    } finally {
      setSaving(false);
    }
  }

  async function updateTenant() {
    if (!selectedTenant) return;

    try {
      setSaving(true);
      const adminSecret = localStorage.getItem("admin_secret") || "";
      const res = await fetch(`/admin/api/tenants/${selectedTenant.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Secret": adminSecret,
        },
        body: JSON.stringify({
          name: formName || selectedTenant.name,
          slug: formSlug || selectedTenant.slug,
          twilioFrom: formTwilio || null,
          fbPageId: formFbPage || null,
          fbFormId: formFbForm || null,
          brandColor: formColor,
        }),
      });

      if (res.ok) {
        setShowConfig(false);
        setSelectedTenant(null);
        await fetchTenants();
      } else {
        const err = await res.json();
        setError(err.error || "Failed to update tenant");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to update tenant");
    } finally {
      setSaving(false);
    }
  }

  function openConfig(tenant: Tenant) {
    setSelectedTenant(tenant);
    setFormName(tenant.name);
    setFormSlug(tenant.slug);
    setFormTwilio(tenant.twilio_from || "");
    setFormFbPage(tenant.fb_page_ids?.[0] || "");
    setFormFbForm(tenant.fb_form_ids?.[0] || "");
    setFormColor(tenant.brand_color);
    setShowConfig(true);
  }

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[rgba(10,10,10,0.78)] border-b border-[var(--color-border)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--color-gold)]">🔑 Super Admin</h1>
          <p className="text-sm text-[var(--color-text-soft)]">Manage all client accounts</p>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {error && (
          <div className="surface p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Add New Client Button */}
        <div className="flex gap-4 flex-wrap">
          <button
            onClick={() => {
              setShowForm(!showForm);
              setFormName("");
              setFormSlug("");
              setFormPassword("");
              setFormTwilio("");
              setFormFbPage("");
              setFormFbForm("");
              setFormColor("#fbbf24");
            }}
            className="px-4 py-2 rounded-lg bg-[var(--color-gold)] text-black hover:bg-yellow-400 font-semibold uppercase text-sm transition-colors"
          >
            {showForm ? "Cancel" : "+ New Client"}
          </button>
        </div>

        {/* Create Form */}
        {showForm && (
          <div className="surface p-6 rounded-lg border border-[var(--color-border)] space-y-4">
            <h2 className="text-xl font-bold text-white">Add New Client</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">
                  Company Name *
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)]"
                  placeholder="e.g. Harris Bros Plumbing"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">
                  Slug * (harrisbros → harrisbros.nopressurelaunch.com)
                </label>
                <input
                  type="text"
                  value={formSlug}
                  onChange={(e) => setFormSlug(e.target.value.toLowerCase())}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)]"
                  placeholder="harrisbros"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">
                  Password *
                </label>
                <input
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)]"
                  placeholder="Strong password"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">
                  Twilio Number
                </label>
                <input
                  type="text"
                  value={formTwilio}
                  onChange={(e) => setFormTwilio(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)]"
                  placeholder="+12345678901"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">
                  FB Page ID
                </label>
                <input
                  type="text"
                  value={formFbPage}
                  onChange={(e) => setFormFbPage(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)]"
                  placeholder="123456789"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">
                  FB Form ID
                </label>
                <input
                  type="text"
                  value={formFbForm}
                  onChange={(e) => setFormFbForm(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)]"
                  placeholder="987654321"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">
                  Brand Color
                </label>
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={formColor}
                    onChange={(e) => setFormColor(e.target.value)}
                    className="w-12 h-10 rounded cursor-pointer"
                  />
                  <input
                    type="text"
                    value={formColor}
                    onChange={(e) => setFormColor(e.target.value)}
                    className="flex-1 px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)]"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={createTenant}
              disabled={saving || !formName || !formSlug || !formPassword}
              className="px-4 py-2 rounded-lg bg-[var(--color-gold)] text-black hover:bg-yellow-400 disabled:opacity-50 font-semibold uppercase text-sm transition-colors"
            >
              {saving ? "Creating..." : "Create Client"}
            </button>
          </div>
        )}

        {/* Clients Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-white/10 border-t-[var(--color-gold)] rounded-full animate-spin" />
          </div>
        ) : tenants.length === 0 ? (
          <div className="surface p-8 text-center rounded-lg">
            <p className="text-[var(--color-text-soft)]">No clients yet. Create your first one above.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {tenants.map((tenant) => (
              <div
                key={tenant.id}
                className="surface p-6 rounded-lg border border-[var(--color-border)] space-y-4"
              >
                <div
                  className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl"
                  style={{ background: tenant.brand_color }}
                >
                  🏢
                </div>

                <div>
                  <h3 className="text-lg font-bold text-white">{tenant.name}</h3>
                  <p className="text-sm text-[var(--color-text-soft)] mt-1">
                    {tenant.slug}.nopressurelaunch.com
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-[var(--color-text-soft)] text-xs">Leads</p>
                    <p className="text-lg font-bold text-white">{tenant.leadCount ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-[var(--color-text-soft)] text-xs">Revenue</p>
                    <p className="text-lg font-bold text-[var(--color-gold)]">
                      ${((tenant.revenue ?? 0) / 1).toFixed(0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--color-text-soft)] text-xs">Appointments</p>
                    <p className="text-lg font-bold text-white">{tenant.appointmentCount ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-[var(--color-text-soft)] text-xs">Status</p>
                    <p className={`font-bold ${tenant.enabled ? "text-green-400" : "text-red-400"}`}>
                      {tenant.enabled ? "Active" : "Inactive"}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <a
                    href={`https://${tenant.slug}.nopressurelaunch.com`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-gold)] text-black hover:bg-yellow-400 text-xs font-semibold text-center transition-colors"
                  >
                    Open CRM
                  </a>
                  <button
                    onClick={() => openConfig(tenant)}
                    className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-border)] text-[var(--color-text-soft)] hover:bg-[var(--color-gold)] hover:text-black text-xs font-semibold transition-colors"
                  >
                    Configure
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Config Drawer */}
        {showConfig && selectedTenant && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="surface border border-[var(--color-gold)]/30 rounded-2xl p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-white">Configure Client</h2>
                <button
                  onClick={() => setShowConfig(false)}
                  className="text-[var(--color-text-soft)] hover:text-white text-xl"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">
                    Company Name
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">
                    Slug
                  </label>
                  <input
                    type="text"
                    value={formSlug}
                    onChange={(e) => setFormSlug(e.target.value.toLowerCase())}
                    className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">
                    Twilio Number
                  </label>
                  <input
                    type="text"
                    value={formTwilio}
                    onChange={(e) => setFormTwilio(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">
                    FB Page ID
                  </label>
                  <input
                    type="text"
                    value={formFbPage}
                    onChange={(e) => setFormFbPage(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">
                    FB Form ID
                  </label>
                  <input
                    type="text"
                    value={formFbForm}
                    onChange={(e) => setFormFbForm(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">
                    Brand Color
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={formColor}
                      onChange={(e) => setFormColor(e.target.value)}
                      className="w-12 h-10 rounded cursor-pointer"
                    />
                    <input
                      type="text"
                      value={formColor}
                      onChange={(e) => setFormColor(e.target.value)}
                      className="flex-1 px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)]"
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={updateTenant}
                    disabled={saving}
                    className="flex-1 px-4 py-2 rounded-lg bg-[var(--color-gold)] text-black hover:bg-yellow-400 disabled:opacity-50 font-semibold uppercase text-sm transition-colors"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                  <button
                    onClick={() => setShowConfig(false)}
                    className="flex-1 px-4 py-2 rounded-lg bg-[var(--color-border)] text-[var(--color-text-soft)] hover:text-white transition-colors font-semibold uppercase text-sm"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
