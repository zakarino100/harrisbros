import { useEffect, useState, useRef } from "react";
import { api, type MePayload } from "../lib/api";

interface ScheduleConfig {
  tenant_id: string;
  timezone: string;
  work_days: number[];
  work_start: string;
  work_end: string;
  max_jobs_per_day: number;
  avg_job_hours: number;
  buffer_mins: number;
  travel_time_mins: number;
  lunch_start: string | null;
  lunch_end: string | null;
  first_job_start: string | null;
  last_job_start: string | null;
  service_cities: string[];
  updated_at: string;
}

interface AvailableSlot {
  date: string;
  dayName: string;
  displayDate: string;
  slotsLeft: number;
  weatherOk: boolean;
  rainProbability: number;
  weatherDescription: string;
  tempMaxF: number;
}

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

interface DayForecast {
  date: string;
  rainProbability: number;
  weatherCode: number;
  tempMaxF: number;
  description: string;
  willRain: boolean;
}

interface PendingBooking {
  conversation_id: number;
  lead_id: number;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  handoff_reason: string | null;
  quoted_price_cents: number | null;
  conversation_created_at: string;
}

interface Props {
  me: MePayload;
}

export function Schedule({ me }: Props) {
  const [config, setConfig] = useState<ScheduleConfig | null>(null);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [forecast, setForecast] = useState<DayForecast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [editConfig, setEditConfig] = useState<Partial<ScheduleConfig> | null>(null);
  const [saving, setSaving] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [viewMode, setViewMode] = useState<"week" | "month">("week");
  const [monthOffset, setMonthOffset] = useState(0);

  async function fetchData() {
    try {
      setLoading(true);
      const [cfg, slts, appts, fcst, pending] = await Promise.all([
        fetch("/api/schedule/config", { credentials: "include" }).then((r) =>
          r.ok ? r.json() : null
        ),
        fetch("/api/schedule/slots?days=14", { credentials: "include" }).then((r) => r.json()),
        fetch("/api/schedule/appointments", { credentials: "include" }).then((r) => r.json()),
        fetch("/api/schedule/weather", { credentials: "include" }).then((r) => r.json()),
        fetch("/api/schedule/pending", { credentials: "include" }).then((r) => r.ok ? r.json() : []),
      ]);
      setConfig(cfg);
      setSlots(slts || []);
      setAppointments(appts || []);
      setForecast(fcst || []);
      setPendingBookings(pending || []);
      setEditConfig(cfg ? { ...cfg } : null);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load schedule");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function scheduleBooking() {
    if (!selectedPending || !bookingModal) return;
    setSchedulingAppt(true);
    try {
      await fetch("/api/schedule/appointments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: selectedPending.lead_id,
          conversation_id: selectedPending.conversation_id,
          status: "confirmed",
          scheduled_date: bookingModal.date,
          scheduled_time: bookingTime || null,
          service_summary: selectedPending.handoff_reason ?? null,
          quoted_price_cents: selectedPending.quoted_price_cents ?? null,
          notes: bookingNotes || null,
        }),
      });
      setBookingModal(null);
      setSelectedPending(null);
      setBookingTime("");
      setBookingNotes("");
      await fetchData();
    } catch (err: any) {
      alert("Failed to schedule: " + (err?.message || "Unknown error"));
    } finally {
      setSchedulingAppt(false);
    }
  }

  function handleDayClickForBooking(date: string, displayDate: string) {
    if (!selectedPending) return;
    setBookingModal({ date, displayDate });
    setBookingTime("");
    setBookingNotes("");
  }

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 60000); // refresh every minute
    return () => clearInterval(timer);
  }, []);

  async function saveConfig() {
    if (!editConfig) return;
    try {
      setSaving(true);
      await fetch("/api/schedule/config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editConfig),
      });
      setConfig(editConfig as ScheduleConfig);
      setShowConfig(false);
      await fetchData();
    } catch (err: any) {
      setError(err?.message || "Failed to save config");
    } finally {
      setSaving(false);
    }
  }

  function toggleWorkDay(day: number) {
    if (!editConfig) return;
    const workDays = [...(editConfig.work_days || [])];
    if (workDays.includes(day)) {
      workDays.splice(workDays.indexOf(day), 1);
    } else {
      workDays.push(day);
      workDays.sort();
    }
    setEditConfig({ ...editConfig, work_days: workDays });
  }

  function getWeatherEmoji(rainProbability: number): string {
    if (rainProbability < 20) return "☀️";
    if (rainProbability < 40) return "🌤";
    if (rainProbability < 60) return "🌧";
    return "⛈";
  }

  function getStatusColor(status: string): string {
    if (status === "confirmed") return "bg-green-500/20 text-green-300";
    if (status === "completed") return "bg-gray-500/20 text-gray-300";
    if (status === "pending") return "bg-yellow-500/20 text-yellow-300";
    if (status === "no_show") return "bg-red-500/20 text-red-300";
    return "bg-gray-500/20 text-gray-300";
  }

  // Returns all 7 days of the current week, enriched with slot/weather data if available
  function getWeekDays(): Array<{
    date: string; dayName: string; displayDate: string;
    isWorkDay: boolean; slotsLeft: number; isFull: boolean;
    rainProbability: number; weatherDescription: string; tempMaxF: number; weatherOk: boolean;
    isPast: boolean;
  }> {
    const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Start of week based on offset (Sunday = day 0)
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + weekOffset * 7);

    const slotMap = new Map(slots.map(s => [s.date, s]));
    const forecastMap = new Map(forecast.map(f => [f.date, f]));
    const workDays = config?.work_days ?? [1,2,3,4,5,6];
    const maxJobs = config?.max_jobs_per_day ?? 3;

    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      const dow = d.getDay();
      const slot = slotMap.get(dateStr);
      const wx = forecastMap.get(dateStr);
      const dayAppts = appointments.filter(a => a.scheduled_date === dateStr);
      const bookedCount = dayAppts.length;
      const isWorkDay = workDays.includes(dow);
      const slotsLeft = slot?.slotsLeft ?? Math.max(0, maxJobs - bookedCount);

      const isPast = d < today;
      return {
        date: dateStr,
        dayName: DAY_NAMES[dow],
        displayDate: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        isWorkDay,
        slotsLeft,
        isFull: isWorkDay && slotsLeft <= 0,
        rainProbability: wx?.rainProbability ?? slot?.rainProbability ?? 0,
        weatherDescription: wx?.description ?? slot?.weatherDescription ?? "",
        tempMaxF: wx?.tempMaxF ?? slot?.tempMaxF ?? 0,
        weatherOk: slot?.weatherOk ?? (wx ? !wx.willRain : true),
        isPast,
      };
    });
  }

  function getAppointmentsForDate(date: string): Appointment[] {
    return appointments.filter((a) => a.scheduled_date === date);
  }

  function getMonthDays(): Array<{
    date: string | null; dayOfMonth: number | null; isCurrentMonth: boolean;
    isPast: boolean; isWorkDay: boolean; slotsLeft: number; isFull: boolean;
    rainProbability: number; tempMaxF: number; appointments: Appointment[];
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetMonth = new Date(today);
    targetMonth.setMonth(today.getMonth() + monthOffset);
    const year = targetMonth.getFullYear();
    const month = targetMonth.getMonth();
    
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const daysInMonth = lastDayOfMonth.getDate();
    const firstDayOfWeek = firstDayOfMonth.getDay();
    
    const slotMap = new Map(slots.map(s => [s.date, s]));
    const forecastMap = new Map(forecast.map(f => [f.date, f]));
    const workDays = config?.work_days ?? [1,2,3,4,5,6];
    const maxJobs = config?.max_jobs_per_day ?? 3;
    
    const days = [];
    // Fill in previous month's days
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      days.push({
        date: null,
        dayOfMonth: null,
        isCurrentMonth: false,
        isPast: false,
        isWorkDay: false,
        slotsLeft: 0,
        isFull: false,
        rainProbability: 0,
        tempMaxF: 0,
        appointments: [],
      });
    }
    
    // Fill in current month's days
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      const dateStr = dateObj.toISOString().slice(0, 10);
      const dow = dateObj.getDay();
      const slot = slotMap.get(dateStr);
      const wx = forecastMap.get(dateStr);
      const dayAppts = appointments.filter(a => a.scheduled_date === dateStr);
      const bookedCount = dayAppts.length;
      const isWorkDay = workDays.includes(dow);
      const slotsLeft = slot?.slotsLeft ?? Math.max(0, maxJobs - bookedCount);
      const isPast = dateObj < today;
      
      days.push({
        date: dateStr,
        dayOfMonth: d,
        isCurrentMonth: true,
        isPast,
        isWorkDay,
        slotsLeft,
        isFull: isWorkDay && slotsLeft <= 0,
        rainProbability: wx?.rainProbability ?? slot?.rainProbability ?? 0,
        tempMaxF: wx?.tempMaxF ?? slot?.tempMaxF ?? 0,
        appointments: dayAppts,
      });
    }
    
    // Fill in next month's days
    const remainingDays = 42 - days.length; // 6 rows * 7 days
    for (let d = 1; d <= remainingDays; d++) {
      days.push({
        date: null,
        dayOfMonth: null,
        isCurrentMonth: false,
        isPast: false,
        isWorkDay: false,
        slotsLeft: 0,
        isFull: false,
        rainProbability: 0,
        tempMaxF: 0,
        appointments: [],
      });
    }
    
    return days;
  }

  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [pendingBookings, setPendingBookings] = useState<PendingBooking[]>([]);
  const [selectedPending, setSelectedPending] = useState<PendingBooking | null>(null);
  const [bookingModal, setBookingModal] = useState<{ date: string; displayDate: string } | null>(null);
  const [bookingTime, setBookingTime] = useState("");
  const [bookingNotes, setBookingNotes] = useState("");
  const [schedulingAppt, setSchedulingAppt] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-white/10 border-t-[var(--color-gold)] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Config Panel */}
      <div className="mb-6">
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="px-4 py-2 rounded-lg bg-[var(--color-border)] text-[var(--color-text-soft)] hover:bg-[var(--color-gold)] hover:text-black transition-colors uppercase text-xs font-semibold"
        >
          {showConfig ? "Hide" : "Show"} Config
        </button>
      </div>

      {showConfig && editConfig && (
        <div className="surface p-6 mb-6 rounded-lg border border-[var(--color-border)]">
          <h3 className="text-lg font-semibold text-white mb-1">Schedule Configuration</h3>
          <p className="text-xs text-[var(--color-text-soft)] mb-5">Controls when jobs can be booked and how Hayden offers scheduling slots.</p>

          {/* Work Days — all 7 */}
          <div className="mb-5">
            <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase tracking-wide mb-2">Work Days</label>
            <div className="flex gap-2 flex-wrap">
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((day, i) => (
                <button key={i} onClick={() => toggleWorkDay(i)}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    editConfig.work_days?.includes(i)
                      ? "bg-[var(--color-gold)] text-black"
                      : "bg-[var(--color-bg-soft)] text-[var(--color-text-soft)] border border-[var(--color-border)]"}`}>
                  {day}
                </button>
              ))}
            </div>
          </div>

          {/* Service Hours */}
          <div className="mb-5">
            <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase tracking-wide mb-2">Service Hours</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-[var(--color-text-soft)] mb-1">Day starts</label>
                <input type="time" value={editConfig.work_start || "08:00"}
                  onChange={(e) => setEditConfig({ ...editConfig, work_start: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-text-soft)] mb-1">Day ends</label>
                <input type="time" value={editConfig.work_end || "18:00"}
                  onChange={(e) => setEditConfig({ ...editConfig, work_end: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-text-soft)] mb-1">First job start</label>
                <input type="time" value={editConfig.first_job_start || editConfig.work_start || "08:00"}
                  onChange={(e) => setEditConfig({ ...editConfig, first_job_start: e.target.value })}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-text-soft)] mb-1">Last job start</label>
                <input type="time" value={editConfig.last_job_start || ""} placeholder="auto"
                  onChange={(e) => setEditConfig({ ...editConfig, last_job_start: e.target.value || null })}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm" />
              </div>
            </div>
            <p className="text-xs text-[var(--color-text-soft)] mt-1">"Last job start" auto-calculates (day end − avg job time) if left blank.</p>
          </div>

          {/* Lunch Break */}
          <div className="mb-5">
            <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase tracking-wide mb-2">Lunch Break <span className="normal-case font-normal">(optional)</span></label>
            <div className="grid grid-cols-2 gap-3 max-w-xs">
              <div>
                <label className="block text-xs text-[var(--color-text-soft)] mb-1">Start</label>
                <input type="time" value={editConfig.lunch_start || ""} placeholder="None"
                  onChange={(e) => setEditConfig({ ...editConfig, lunch_start: e.target.value || null })}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-text-soft)] mb-1">End</label>
                <input type="time" value={editConfig.lunch_end || ""} placeholder="None"
                  onChange={(e) => setEditConfig({ ...editConfig, lunch_end: e.target.value || null })}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm" />
              </div>
            </div>
            <p className="text-xs text-[var(--color-text-soft)] mt-1">No jobs will be scheduled during this window.</p>
          </div>

          {/* Jobs & Timing */}
          <div className="mb-5">
            <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase tracking-wide mb-2">Jobs & Timing</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-[var(--color-text-soft)] mb-1">Max jobs/day</label>
                <input type="number" min="1" max="20" value={editConfig.max_jobs_per_day || 3}
                  onChange={(e) => setEditConfig({ ...editConfig, max_jobs_per_day: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-text-soft)] mb-1">Avg job (hrs)</label>
                <input type="number" min="0.5" step="0.5" max="12" value={editConfig.avg_job_hours || 2.0}
                  onChange={(e) => setEditConfig({ ...editConfig, avg_job_hours: parseFloat(e.target.value) })}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-text-soft)] mb-1">Buffer between jobs (min)</label>
                <input type="number" min="0" step="5" max="120" value={editConfig.buffer_mins || 30}
                  onChange={(e) => setEditConfig({ ...editConfig, buffer_mins: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm" />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-text-soft)] mb-1">Travel time (min)</label>
                <input type="number" min="0" step="5" max="120" value={editConfig.travel_time_mins || 20}
                  onChange={(e) => setEditConfig({ ...editConfig, travel_time_mins: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm" />
              </div>
            </div>
            <p className="text-xs text-[var(--color-text-soft)] mt-1">Buffer = prep/admin time between jobs. Travel = avg drive time between jobs.</p>
          </div>

          {/* Timezone & Cities */}
          <div className="mb-5">
            <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase tracking-wide mb-2">Timezone</label>
            <select value={editConfig.timezone || "America/New_York"}
              onChange={(e) => setEditConfig({ ...editConfig, timezone: e.target.value })}
              className="w-full max-w-xs px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm">
              <option value="America/New_York">Eastern (ET)</option>
              <option value="America/Chicago">Central (CT)</option>
              <option value="America/Denver">Mountain (MT)</option>
              <option value="America/Los_Angeles">Pacific (PT)</option>
              <option value="America/Phoenix">Arizona (no DST)</option>
              <option value="America/Anchorage">Alaska (AKT)</option>
              <option value="Pacific/Honolulu">Hawaii (HT)</option>
            </select>
          </div>

          <div className="mb-5">
            <label className="block text-xs font-semibold text-[var(--color-text-soft)] uppercase tracking-wide mb-2">Service Cities <span className="normal-case font-normal">(for weather forecasting)</span></label>
            <input type="text" value={(editConfig.service_cities || []).join(", ")}
              onChange={(e) => setEditConfig({ ...editConfig, service_cities: e.target.value.split(",").map(c => c.trim()).filter(Boolean) })}
              placeholder="e.g. Tulsa, Broken Arrow, Joplin"
              className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm" />
          </div>

          <div className="flex gap-2">
            <button onClick={saveConfig} disabled={saving}
              className="px-4 py-2 rounded-lg bg-[var(--color-gold)] text-black hover:bg-yellow-400 disabled:opacity-50 uppercase text-xs font-semibold transition-colors">
              {saving ? "Saving..." : "Save Config"}
            </button>
            <button onClick={() => setShowConfig(false)}
              className="px-4 py-2 rounded-lg bg-[var(--color-border)] text-[var(--color-text-soft)] hover:text-white transition-colors uppercase text-xs font-semibold">
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="surface p-4 mb-6 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* ── Pending Bookings Queue ──────────────────────────────── */}
      {pendingBookings.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold uppercase tracking-widest text-[var(--color-gold)]">Awaiting Schedule</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[var(--color-gold)] text-black">{pendingBookings.length}</span>
            </div>
            {selectedPending && (
              <button
                onClick={() => setSelectedPending(null)}
                className="text-xs text-[var(--color-text-soft)] hover:text-white transition-colors px-2 py-1 rounded border border-[var(--color-border)]"
              >
                ✕ Cancel selection
              </button>
            )}
          </div>
          {selectedPending && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-amber-900/20 border border-amber-700/40 text-xs text-amber-300 font-semibold">
              📅 Pick a day on the calendar below to schedule <span className="text-white">{selectedPending.full_name ?? "this lead"}</span>
            </div>
          )}
          <div className="flex gap-3 overflow-x-auto pb-2">
            {pendingBookings.map((pb) => {
              const isSelected = selectedPending?.conversation_id === pb.conversation_id;
              const price = pb.quoted_price_cents ? `$${(pb.quoted_price_cents / 100).toFixed(0)}` : null;
              const serviceHint = pb.handoff_reason
                ? pb.handoff_reason.replace(/^ready to book[\s\-–]+/i, "").replace(/^win:/i, "").slice(0, 60)
                : null;
              return (
                <button
                  key={pb.conversation_id}
                  onClick={() => setSelectedPending(isSelected ? null : pb)}
                  className={`shrink-0 w-52 text-left p-3 rounded-xl border-2 transition-all ${
                    isSelected
                      ? "border-[var(--color-gold)] bg-[var(--color-gold)]/10 shadow-lg shadow-[var(--color-gold)]/20"
                      : "border-[var(--color-border)] bg-[var(--color-bg-soft)] hover:border-[var(--color-gold)]/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-1 mb-1">
                    <p className="font-bold text-sm text-white truncate">{pb.full_name ?? "Unknown"}</p>
                    {isSelected && <span className="text-[var(--color-gold)] text-xs font-bold shrink-0">✔ Selected</span>}
                  </div>
                  {pb.phone && <p className="text-xs text-[var(--color-text-soft)] mb-1">{pb.phone}</p>}
                  {pb.city && <p className="text-xs text-[var(--color-text-soft)] mb-1">📍 {[pb.city, pb.state].filter(Boolean).join(", ")}</p>}
                  {serviceHint && (
                    <p className="text-xs text-[var(--color-text-soft)] mb-1 line-clamp-2">🔧 {serviceHint}</p>
                  )}
                  {price && (
                    <p className="text-xs font-bold text-[var(--color-gold)] mt-1">{price}</p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Navigation & View Mode Toggle */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-2 w-full sm:w-auto justify-between">
          <button
            onClick={() => viewMode === "week" ? setWeekOffset(weekOffset - 1) : setMonthOffset(monthOffset - 1)}
            className="px-3 py-2 min-h-[44px] rounded-lg bg-[var(--color-border)] text-[var(--color-text-soft)] hover:bg-[var(--color-gold)] hover:text-black transition-colors flex items-center"
          >
            ← Previous
          </button>
          <h2 className="text-lg sm:text-xl font-semibold text-white min-w-[140px] sm:min-w-[180px] text-center">
            {viewMode === "week" ?
              new Date(new Date().setDate(new Date().getDate() + weekOffset * 7)).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              }) + " – Week"
              : new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1).toLocaleDateString("en-US", {
                month: "long",
                year: "numeric",
              })
            }
          </h2>
          <button
            onClick={() => viewMode === "week" ? setWeekOffset(weekOffset + 1) : setMonthOffset(monthOffset + 1)}
            className="px-3 py-2 min-h-[44px] rounded-lg bg-[var(--color-border)] text-[var(--color-text-soft)] hover:bg-[var(--color-gold)] hover:text-black transition-colors flex items-center"
          >
            Next →
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setViewMode("week"); setWeekOffset(0); }}
            className={`px-4 py-2 min-h-[44px] rounded-lg font-semibold uppercase text-xs transition-colors flex items-center ${
              viewMode === "week"
                ? "bg-[var(--color-gold)] text-black"
                : "bg-[var(--color-border)] text-[var(--color-text-soft)] hover:bg-[var(--color-gold)] hover:text-black"
            }`}
          >
            Week
          </button>
          <button
            onClick={() => { setViewMode("month"); setMonthOffset(0); }}
            className={`px-4 py-2 min-h-[44px] rounded-lg font-semibold uppercase text-xs transition-colors flex items-center ${
              viewMode === "month"
                ? "bg-[var(--color-gold)] text-black"
                : "bg-[var(--color-border)] text-[var(--color-text-soft)] hover:bg-[var(--color-gold)] hover:text-black"
            }`}
          >
            Month
          </button>
        </div>
      </div>

      {/* Day Cards Grid — Week or Month View */}
      {viewMode === "week" ? (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {getWeekDays().map((day) => {
            const dayAppts = getAppointmentsForDate(day.date);
            const maxJobs = config?.max_jobs_per_day ?? 3;
            const totalCapacity = maxJobs;
            const bookedCount = dayAppts.length;
            return (
              <div
                key={day.date}
                onClick={() => !day.isPast && day.isWorkDay && !day.isFull && selectedPending && handleDayClickForBooking(day.date, `${day.dayName} ${day.displayDate}`)}
                className={`surface p-3 rounded-lg border transition-all ${
                  selectedPending && !day.isPast && day.isWorkDay && !day.isFull
                    ? "border-[var(--color-gold)] cursor-pointer hover:bg-[var(--color-gold)]/15 hover:shadow-md hover:shadow-[var(--color-gold)]/20"
                    : !day.isWorkDay
                    ? "border-[var(--color-border)] opacity-40"
                    : day.isFull
                    ? "border-red-800/40 opacity-70"
                    : "border-[var(--color-gold)]/30 bg-[var(--color-gold)]/5"
                }`}
              >
                {selectedPending && !day.isPast && day.isWorkDay && !day.isFull && (
                  <div className="text-center text-xs font-bold text-[var(--color-gold)] mb-1">➕ Place here</div>
                )}
                {/* Header */}
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="text-sm font-semibold text-white">{day.dayName}</h3>
                    <p className="text-xs text-[var(--color-text-soft)]">{day.displayDate}</p>
                  </div>
                  {day.isPast && <div className="text-xs px-1.5 py-0.5 rounded bg-gray-500/20 text-gray-300">Past</div>}
                  {!day.isPast && <div className="text-lg">{day.isWorkDay ? getWeatherEmoji(day.rainProbability) : "🚫"}</div>}
                </div>

                {/* Weather & Capacity */}
                {day.isWorkDay && !day.isPast && (
                <div className="mb-2 space-y-1">
                  {day.tempMaxF > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-[var(--color-text-soft)]">{day.tempMaxF}°F</span>
                      {day.rainProbability > 0 && (
                        <span className="text-xs text-[var(--color-text-soft)]">{day.rainProbability}%🌧</span>
                      )}
                    </div>
                  )}

                  {/* Capacity Bar */}
                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs text-[var(--color-text-soft)]">
                        {bookedCount}/{totalCapacity} jobs
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-[var(--color-bg-soft)] rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          bookedCount >= totalCapacity ? "bg-red-500" : "bg-[var(--color-gold)]"
                        }`}
                        style={{ width: `${Math.min(100, (bookedCount / totalCapacity) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
                )}

                {/* Appointments List */}
                {dayAppts.length > 0 && (
                  <div className="space-y-2 border-t border-[var(--color-border)] pt-3">
                    {dayAppts.map((appt) => (
                      <div key={appt.id} className="text-xs">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="font-medium text-white truncate">Lead #{appt.lead_id}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-semibold ${getStatusColor(appt.status)}`}
                          >
                            {appt.status}
                          </span>
                        </div>
                        {appt.scheduled_time && (
                          <p className="text-[var(--color-text-soft)]">{appt.scheduled_time}</p>
                        )}
                        {appt.service_summary && (
                          <p className="text-[var(--color-text-soft)] line-clamp-1">{appt.service_summary}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Available / Status Indicator */}
                {day.isWorkDay && !day.isFull && day.slotsLeft > 0 && (
                  <div className="mt-2 text-xs text-[var(--color-gold)] font-semibold">
                    {day.slotsLeft} slot{day.slotsLeft !== 1 ? "s" : ""} open
                  </div>
                )}
                {day.isWorkDay && day.isFull && (
                  <div className="mt-2 text-xs text-red-400 font-semibold">Full</div>
                )}
                {!day.isWorkDay && (
                  <div className="mt-2 text-xs text-[var(--color-text-soft)]">Day off</div>
                )}
              </div>
            );
          })}
      </div>
      ) : (
      // Month view
      <div>
        {/* Month calendar grid */}
        <div className="surface p-2 sm:p-4 rounded-lg border border-[var(--color-border)] overflow-x-auto">
          {/* Days of week header */}
          <div className="grid grid-cols-7 gap-0.5 sm:gap-1 mb-1 sm:mb-2 min-w-[320px] sm:min-w-0">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="text-center text-xs font-semibold text-[var(--color-text-soft)] py-2">
                {day}
              </div>
            ))}
          </div>
          {/* Days grid */}
          <div className="grid grid-cols-7 gap-0.5 sm:gap-1 min-w-[320px] sm:min-w-0">
            {getMonthDays().map((day, idx) => (
              <div
                key={idx}
                className={`min-h-[60px] sm:min-h-[80px] p-1 sm:p-2 rounded text-xs sm:text-sm border transition-colors ${
                  !day.isCurrentMonth
                    ? "bg-[var(--color-bg-soft)] opacity-30"
                    : day.isPast
                    ? "bg-[var(--color-bg-soft)] border-[var(--color-border)]"
                    : "bg-[var(--color-bg-soft)] border-[var(--color-gold)]/30 hover:bg-[var(--color-gold)]/5"
                } ${expandedDay === day.date ? "ring-2 ring-[var(--color-gold)]" : ""}`}
                onClick={() => day.isCurrentMonth && day.date && setExpandedDay(expandedDay === day.date ? null : day.date)}
                role={day.isCurrentMonth && day.date ? "button" : undefined}
                tabIndex={day.isCurrentMonth && day.date ? 0 : undefined}
              >
                {day.isCurrentMonth && (
                  <>
                    <div className="flex items-start justify-between mb-1">
                      <span className="text-xs font-semibold text-white">{day.dayOfMonth}</span>
                      {!day.isPast && day.isWorkDay && <span className="text-sm">{getWeatherEmoji(day.rainProbability)}</span>}
                      {day.isPast && <span className="text-xs px-1 py-0.5 rounded bg-gray-500/20 text-gray-300">Past</span>}
                    </div>
                    {!day.isPast && day.tempMaxF > 0 && (
                      <div className="text-xs text-[var(--color-text-soft)] mb-1">{day.tempMaxF}°F</div>
                    )}
                    {day.isWorkDay && (
                      <div className="text-xs text-[var(--color-gold)] font-semibold mb-1">
                        {day.appointments.length}/{config?.max_jobs_per_day ?? 3}
                      </div>
                    )}
                    {day.appointments.length > 0 && (
                      <div className="flex flex-wrap gap-0.5">
                        {day.appointments.slice(0, 3).map((apt, i) => (
                          <div key={i} className="w-2 h-2 rounded-full bg-[var(--color-gold)]"/>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
        
        {/* Expanded day view */}
        {expandedDay && (
          <div className="surface p-4 rounded-lg border border-[var(--color-border)] mt-4">
            <h3 className="text-lg font-semibold text-white mb-4">
              {new Date(expandedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </h3>
            {appointments.filter(a => a.scheduled_date === expandedDay).length > 0 ? (
              <div className="space-y-2">
                {appointments.filter(a => a.scheduled_date === expandedDay).map(appt => (
                  <div key={appt.id} className="p-3 rounded bg-[var(--color-bg-soft)] border border-[var(--color-border)]">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="font-medium text-white">Lead #{appt.lead_id}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${getStatusColor(appt.status)}`}>
                        {appt.status}
                      </span>
                    </div>
                    {appt.scheduled_time && <p className="text-xs text-[var(--color-text-soft)]">{appt.scheduled_time}</p>}
                    {appt.service_summary && <p className="text-xs text-[var(--color-text-soft)]">{appt.service_summary}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[var(--color-text-soft)] text-sm">No appointments scheduled</p>
            )}
          </div>
        )}
      </div>
      )}

      {/* ── Booking Confirmation Modal ───────────────────────── */}
      {bookingModal && selectedPending && (
        <>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={() => setBookingModal(null)} />
          <div
            className="fixed inset-x-4 sm:inset-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-md top-1/2 -translate-y-1/2 z-50 bg-[var(--color-bg-soft)] border border-[var(--color-border)] rounded-2xl shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-lg text-white mb-1">Confirm Booking</h3>
            <p className="text-sm text-[var(--color-text-soft)] mb-4">
              Schedule <span className="text-white font-semibold">{selectedPending.full_name ?? "this lead"}</span> on{" "}
              <span className="text-[var(--color-gold)] font-semibold">{bookingModal.displayDate}</span>
            </p>

            <div className="space-y-3 mb-5">
              {/* Lead info summary */}
              <div className="px-3 py-2 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)] text-xs space-y-0.5">
                {selectedPending.phone && <p className="text-[var(--color-text-soft)]">📞 {selectedPending.phone}</p>}
                {selectedPending.city && <p className="text-[var(--color-text-soft)]">📍 {[selectedPending.address, selectedPending.city, selectedPending.state].filter(Boolean).join(", ")}</p>}
                {selectedPending.handoff_reason && (
                  <p className="text-[var(--color-text-soft)]">🔧 {selectedPending.handoff_reason.replace(/^ready to book[\s\-–]+/i, "").replace(/^win:/i, "")}</p>
                )}
                {selectedPending.quoted_price_cents && (
                  <p className="text-[var(--color-gold)] font-bold">💵 ${(selectedPending.quoted_price_cents / 100).toFixed(0)}</p>
                )}
              </div>

              {/* Time picker */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-1">Start Time <span className="normal-case font-normal text-[var(--color-text-faint)]">(optional)</span></label>
                <input
                  type="time"
                  value={bookingTime}
                  onChange={(e) => setBookingTime(e.target.value)}
                  className="input w-full"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-1">Notes <span className="normal-case font-normal text-[var(--color-text-faint)]">(optional)</span></label>
                <input
                  type="text"
                  placeholder="Access code, gate, special instructions…"
                  value={bookingNotes}
                  onChange={(e) => setBookingNotes(e.target.value)}
                  className="input w-full"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setBookingModal(null)}
                className="flex-1 px-4 py-2 rounded-lg font-semibold uppercase tracking-wide text-xs text-[var(--color-text-soft)] border border-[var(--color-border)] hover:bg-[var(--color-bg)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={scheduleBooking}
                disabled={schedulingAppt}
                className="flex-1 px-4 py-2 rounded-lg font-bold uppercase tracking-wide text-xs text-black disabled:opacity-50 transition-opacity"
                style={{ background: "var(--color-gold)" }}
              >
                {schedulingAppt ? "Scheduling…" : "✅ Confirm"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
