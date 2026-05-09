import { useEffect, useState } from "react";
import { api, type MePayload } from "../lib/api";

interface Appointment {
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

interface Lead {
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

interface Conversation {
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

interface Props {
  me: MePayload;
}

export function Sales({ me }: Props) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [modalDate, setModalDate] = useState<string>("");
  const [modalTime, setModalTime] = useState<string>("");
  const [modalService, setModalService] = useState<string>("");
  const [modalPrice, setModalPrice] = useState<string>("");
  const [modalNotes, setModalNotes] = useState<string>("");
  const [savingModal, setSavingModal] = useState(false);

  async function fetchData() {
    try {
      setLoading(true);
      const [appts, allLeads, convs] = await Promise.all([
        fetch("/api/schedule/appointments", { credentials: "include" }).then(r => r.json()),
        fetch("/api/leads", { credentials: "include" }).then(r => r.json()),
        fetch("/api/messages", { credentials: "include" }).then(r => r.json()),
      ]);
      setAppointments(appts || []);
      setLeads(allLeads || []);
      setConversations(convs || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load sales data");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 30000);
    return () => clearInterval(timer);
  }, []);

  async function createAppointment() {
    if (!selectedLead || !modalDate) return;
    try {
      setSavingModal(true);
      const response = await fetch("/api/schedule/appointments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: selectedLead.id,
          scheduled_date: modalDate,
          scheduled_time: modalTime || null,
          service_summary: modalService || null,
          quoted_price_cents: modalPrice ? Math.round(parseFloat(modalPrice) * 100) : null,
          notes: modalNotes || null,
          status: "pending",
          duration_hours: 2.0,
        }),
      });
      if (response.ok) {
        await fetchData();
        setShowModal(false);
        setSelectedLead(null);
        setModalDate("");
        setModalTime("");
        setModalService("");
        setModalPrice("");
        setModalNotes("");
      } else {
        setError("Failed to create appointment");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to create appointment");
    } finally {
      setSavingModal(false);
    }
  }

  async function markComplete(appointmentId: number) {
    try {
      await fetch(`/api/schedule/appointments/${appointmentId}/complete`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      await fetchData();
    } catch (err: any) {
      setError(err?.message || "Failed to mark complete");
    }
  }

  async function requestReview(appointmentId: number) {
    try {
      await fetch(`/api/schedule/appointments/${appointmentId}/review`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      await fetchData();
    } catch (err: any) {
      setError(err?.message || "Failed to request review");
    }
  }

  // Filter appointments by status
  const bookedAppts = appointments.filter(a => ["pending", "confirmed"].includes(a.status));
  const completedAppts = appointments.filter(a => a.status === "completed");
  
  // Filter leads needing follow-up (status = handoff, no appointment)
  const handoffConvs = conversations.filter(c => c.status === "handoff");
  const handoffLeads = leads.filter(l => 
    handoffConvs.some(c => c.lead_id === l.id) && 
    !appointments.some(a => a.lead_id === l.id)
  );

  // Calculate stats
  const totalSales = bookedAppts.length + completedAppts.length;
  const revenue = completedAppts.reduce((sum, a) => sum + (a.quoted_price_cents || 0), 0) / 100;
  const avgTicket = completedAppts.length > 0 ? revenue / completedAppts.length : 0;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const thisMonthCount = appointments.filter(a => a.scheduled_date.startsWith(thisMonth)).length;

  // Get lead names
  const leadMap = new Map(leads.map(l => [l.id, l]));

  const getLeadName = (leadId: number) => {
    const lead = leadMap.get(leadId);
    return lead?.full_name || `Lead #${leadId}`;
  };

  const getLeadPhone = (leadId: number) => {
    const lead = leadMap.get(leadId);
    return lead?.phone || "";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-white/10 border-t-[var(--color-gold)] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-8 pb-20">
      {/* Page header */}
      <div>
        <h1 className="text-3xl font-bold text-[var(--color-text)]">💰 Sales Pipeline</h1>
        <p className="text-sm text-[var(--color-text-soft)] mt-1">Track booked, completed, and follow-up appointments</p>
      </div>

      {error && (
        <div className="surface p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPITile label="Total Sales" value={totalSales} />
        <KPITile label="Revenue" value={`$${revenue.toFixed(2)}`} />
        <KPITile label="Avg Ticket" value={`$${avgTicket.toFixed(2)}`} />
        <KPITile label="This Month" value={thisMonthCount} />
      </div>

      {/* Pipeline Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Column 1: Booked */}
        <div className="surface p-6 rounded-lg border border-[var(--color-border)]">
          <h2 className="text-xl font-bold text-[var(--color-gold)] mb-4">📅 Booked ({bookedAppts.length})</h2>
          <div className="space-y-3">
            {bookedAppts.map(appt => (
              <div key={appt.id} className="p-3 rounded bg-[var(--color-bg-soft)] border border-[var(--color-border)]">
                <div className="font-medium text-white mb-1">{getLeadName(appt.lead_id)}</div>
                {getLeadPhone(appt.lead_id) && (
                  <div className="text-xs text-[var(--color-text-soft)] mb-1">{getLeadPhone(appt.lead_id)}</div>
                )}
                {appt.service_summary && (
                  <div className="text-xs text-[var(--color-text-soft)] mb-1">{appt.service_summary}</div>
                )}
                <div className="text-xs text-[var(--color-gold)] font-semibold mb-2">
                  {appt.scheduled_date} {appt.scheduled_time ? `@ ${appt.scheduled_time}` : ""}
                </div>
                {appt.quoted_price_cents && (
                  <div className="text-sm text-white mb-2">${(appt.quoted_price_cents / 100).toFixed(2)}</div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setSelectedLead(leadMap.get(appt.lead_id) || null);
                      setModalDate(appt.scheduled_date);
                      setModalTime(appt.scheduled_time || "");
                      setModalService(appt.service_summary || "");
                      setModalPrice((appt.quoted_price_cents || 0) / 100 + "");
                      setModalNotes(appt.notes || "");
                      setShowModal(true);
                    }}
                    className="flex-1 min-h-[44px] text-xs px-2 py-2 rounded bg-[var(--color-gold)] text-black hover:bg-yellow-400 font-semibold transition-colors flex items-center justify-center"
                  >
                    📅 Reschedule
                  </button>
                  <button
                    onClick={() => markComplete(appt.id)}
                    className="flex-1 min-h-[44px] text-xs px-2 py-2 rounded bg-green-600 text-white hover:bg-green-700 font-semibold transition-colors flex items-center justify-center"
                  >
                    ✅ Complete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Column 2: Completed */}
        <div className="surface p-6 rounded-lg border border-[var(--color-border)]">
          <h2 className="text-xl font-bold text-[var(--color-gold)] mb-4">✅ Completed ({completedAppts.length})</h2>
          <div className="space-y-3">
            {completedAppts.map(appt => (
              <div key={appt.id} className="p-3 rounded bg-[var(--color-bg-soft)] border border-[var(--color-border)]">
                <div className="font-medium text-white mb-1">{getLeadName(appt.lead_id)}</div>
                {appt.service_summary && (
                  <div className="text-xs text-[var(--color-text-soft)] mb-1">{appt.service_summary}</div>
                )}
                <div className="text-xs text-[var(--color-text-soft)] mb-2">
                  {appt.scheduled_date}
                </div>
                {appt.quoted_price_cents && (
                  <div className="text-sm text-white mb-2">${(appt.quoted_price_cents / 100).toFixed(2)}</div>
                )}
                <button
                  onClick={() => requestReview(appt.id)}
                  className="w-full min-h-[44px] text-xs px-2 py-2 rounded bg-[var(--color-gold)] text-black hover:bg-yellow-400 font-semibold transition-colors flex items-center justify-center"
                >
                  ⭐ Request Review
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Column 3: Needs Follow-up */}
        <div className="surface p-6 rounded-lg border border-[var(--color-border)]">
          <h2 className="text-xl font-bold text-[var(--color-gold)] mb-4">⏳ Needs Follow-up ({handoffLeads.length})</h2>
          <div className="space-y-3">
            {handoffLeads.map(lead => {
              const conv = handoffConvs.find(c => c.lead_id === lead.id);
              return (
                <div key={lead.id} className="p-3 rounded bg-[var(--color-bg-soft)] border border-[var(--color-border)]">
                  <div className="font-medium text-white mb-1">{lead.full_name || `Lead #${lead.id}`}</div>
                  {lead.phone && (
                    <div className="text-xs text-[var(--color-text-soft)] mb-1">{lead.phone}</div>
                  )}
                  {conv?.handoff_reason && (
                    <div className="text-xs text-[var(--color-text-soft)] mb-2">{conv.handoff_reason}</div>
                  )}
                  <button
                    onClick={() => {
                      setSelectedLead(lead);
                      setModalDate("");
                      setModalTime("");
                      setModalService("");
                      setModalPrice("");
                      setModalNotes("");
                      setShowModal(true);
                    }}
                    className="w-full min-h-[44px] text-xs px-2 py-2 rounded bg-[var(--color-gold)] text-black hover:bg-yellow-400 font-semibold transition-colors flex items-center justify-center"
                  >
                    📅 Book
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Appointment Modal */}
      {showModal && selectedLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="surface border border-[var(--color-gold)]/30 rounded-2xl p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">📅 Book Appointment</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-[var(--color-text-soft)] hover:text-white text-xl"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">Lead</label>
                <div className="text-white">{selectedLead.full_name || `Lead #${selectedLead.id}`}</div>
                {selectedLead.phone && <div className="text-xs text-[var(--color-text-soft)]">{selectedLead.phone}</div>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">Date</label>
                <input
                  type="date"
                  value={modalDate}
                  onChange={(e) => setModalDate(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">Time</label>
                <input
                  type="time"
                  value={modalTime}
                  onChange={(e) => setModalTime(e.target.value)}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm"
                  placeholder="Optional"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">Service</label>
                <input
                  type="text"
                  value={modalService}
                  onChange={(e) => setModalService(e.target.value)}
                  placeholder="Service description"
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">Quoted Price ($)</label>
                <input
                  type="number"
                  step="0.01"
                  value={modalPrice}
                  onChange={(e) => setModalPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">Notes</label>
                <textarea
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                  placeholder="Internal notes"
                  rows={3}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={createAppointment}
                  disabled={savingModal || !modalDate}
                  className="flex-1 px-4 py-2 rounded-lg bg-[var(--color-gold)] text-black hover:bg-yellow-400 disabled:opacity-50 uppercase text-xs font-semibold transition-colors"
                >
                  {savingModal ? "Saving..." : "Save Appointment"}
                </button>
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 px-4 py-2 rounded-lg bg-[var(--color-border)] text-[var(--color-text-soft)] hover:text-white transition-colors uppercase text-xs font-semibold"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KPITile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="surface p-4 rounded-lg border border-[var(--color-border)]">
      <p className="text-xs font-semibold text-[var(--color-text-soft)] uppercase mb-1">{label}</p>
      <p className="text-2xl font-bold text-[var(--color-gold)]">{value}</p>
    </div>
  );
}
