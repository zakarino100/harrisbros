import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

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

interface GeocodedLocation {
  lat: number;
  lon: number;
}

interface RouteStop {
  booking: PendingBooking;
  location?: GeocodedLocation;
  estimatedArrival?: string;
  travelTimeMinutes?: number;
}

interface Props {
  me: any;
  config: ScheduleConfig | null;
  pendingBookings: PendingBooking[];
}

export function RouteBuilder({ me, config, pendingBookings }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  // State
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [startTime, setStartTime] = useState(config?.work_start || "08:00");
  const [route, setRoute] = useState<RouteStop[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [geocodeCache, setGeocodeCache] = useState<Record<number, GeocodedLocation | null>>({});
  const [geocodingStatus, setGeocodeStatus] = useState<Record<number, boolean>>({});
  const [bookingRoute, setBookingRoute] = useState(false);
  const [bookedAppointmentIds, setBookedAppointmentIds] = useState<number[]>([]);
  const [smsSendingStatus, setSmsSendingStatus] = useState<Record<number, boolean>>({});
  const [smsSentStatus, setSmsSentStatus] = useState<Record<number, boolean>>({});

  // Helper: Haversine distance
  function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3959; // miles
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Helper: Format time
  function addMinutesToTime(timeStr: string, minutes: number): string {
    const [h, m] = timeStr.split(":").map(Number);
    const totalMinutes = h * 60 + m + minutes;
    const newH = Math.floor(totalMinutes / 60) % 24;
    const newM = totalMinutes % 60;
    return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
  }

  // Helper: Geocode a single address (Nominatim)
  async function geocodeAddress(booking: PendingBooking): Promise<GeocodedLocation | null> {
    if (geocodeCache[booking.lead_id] !== undefined) {
      return geocodeCache[booking.lead_id];
    }

    const addr = [booking.address, booking.city, booking.state, booking.zip]
      .filter(Boolean)
      .join(", ");
    if (!addr) return null;

    try {
      setGeocodeStatus((prev) => ({ ...prev, [booking.lead_id]: true }));
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`;
      const res = await fetch(url);
      const data = await res.json() as any[];

      if (data && data.length > 0) {
        const location = {
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon),
        };
        setGeocodeCache((prev) => ({ ...prev, [booking.lead_id]: location }));
        return location;
      } else {
        setGeocodeCache((prev) => ({ ...prev, [booking.lead_id]: null }));
        return null;
      }
    } catch (err) {
      console.error("Geocoding failed for", booking.full_name, err);
      setGeocodeCache((prev) => ({ ...prev, [booking.lead_id]: null }));
      return null;
    } finally {
      setGeocodeStatus((prev) => ({ ...prev, [booking.lead_id]: false }));
    }
  }

  // Helper: Calculate route with times
  async function buildRoute(stops: PendingBooking[]): Promise<RouteStop[]> {
    const result: RouteStop[] = [];
    let currentTime = startTime;
    let currentLat: number | null = null;
    let currentLon: number | null = null;

    const jobHours = config?.avg_job_hours || 2;
    const bufferMins = config?.buffer_mins || 30;

    for (const booking of stops) {
      const location = await geocodeAddress(booking);

      let travelTimeMinutes = 0;
      if (location && currentLat !== null && currentLon !== null) {
        const distMiles = haversineDistance(currentLat, currentLon, location.lat, location.lon);
        travelTimeMinutes = Math.round((distMiles / 30) * 60); // 30 mph assumed
      }

      currentTime = addMinutesToTime(currentTime, travelTimeMinutes);
      const estimatedArrival = currentTime;

      result.push({
        booking,
        location,
        estimatedArrival,
        travelTimeMinutes: travelTimeMinutes > 0 ? travelTimeMinutes : undefined,
      });

      if (location) {
        currentLat = location.lat;
        currentLon = location.lon;
      }

      // Add job duration + buffer for next stop
      currentTime = addMinutesToTime(currentTime, Math.round(jobHours * 60) + bufferMins);
    }

    return result;
  }

  // Add to route (with 1100ms delay for rate limiting)
  async function addToRoute(booking: PendingBooking) {
    const newStops = [...route.map((r) => r.booking), booking];
    const builtRoute = await buildRoute(newStops);
    setRoute(builtRoute);
    // Rate limit: 1100ms delay
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }

  // Remove from route
  function removeFromRoute(conversationId: number) {
    const newRoute = route.filter((r) => r.booking.conversation_id !== conversationId);
    setRoute(newRoute);
  }

  // Book this route
  async function bookRoute() {
    setBookingRoute(true);
    try {
      const appointmentIds: number[] = [];
      for (const stop of route) {
        const res = await fetch("/api/schedule/appointments", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lead_id: stop.booking.lead_id,
            conversation_id: stop.booking.conversation_id,
            status: "confirmed",
            scheduled_date: selectedDate,
            scheduled_time: stop.estimatedArrival || null,
            service_summary: stop.booking.handoff_reason ?? null,
            quoted_price_cents: stop.booking.quoted_price_cents ?? null,
            notes: null,
          }),
        });
        const data = await res.json() as any;
        if (data.ok && data.id) {
          appointmentIds.push(data.id);
        }
        // Rate limit between bookings
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      // Store appointment IDs and clear route
      setBookedAppointmentIds(appointmentIds);
      setRoute([]);
      setGeocodeCache({});
      await fetchAppointments();
    } catch (err: any) {
      alert("Failed to book route: " + (err?.message || "Unknown error"));
    } finally {
      setBookingRoute(false);
    }
  }

  // Send SMS to single appointment
  async function sendSchedulingSms(apptId: number) {
    setSmsSendingStatus((prev) => ({ ...prev, [apptId]: true }));
    try {
      await api.sendSchedulingSms(apptId);
      setSmsSentStatus((prev) => ({ ...prev, [apptId]: true }));
    } catch (err: any) {
      alert("Failed to send SMS: " + (err?.message || "Unknown error"));
    } finally {
      setSmsSendingStatus((prev) => ({ ...prev, [apptId]: false }));
    }
  }

  // Send SMS to all booked appointments
  async function sendAllSchedulingSms() {
    for (const apptId of bookedAppointmentIds) {
      await sendSchedulingSms(apptId);
      // Rate limit
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // Fetch appointments for selected date
  async function fetchAppointments() {
    try {
      const res = await fetch("/api/schedule/appointments", {
        credentials: "include",
      });
      if (res.ok) {
        const appts = await res.json();
        setAppointments(appts || []);
      }
    } catch (err) {
      console.error("Failed to fetch appointments", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAppointments();
  }, []);

  // Calculate totals
  const totalJobs = route.length;
  const totalDriveTime = route.reduce((sum, stop) => sum + (stop.travelTimeMinutes || 0), 0);
  const totalWorkTime = totalJobs * (config?.avg_job_hours || 2);
  let estimatedEndTime = startTime;
  if (route.length > 0) {
    estimatedEndTime = route[route.length - 1].estimatedArrival || startTime;
    estimatedEndTime = addMinutesToTime(estimatedEndTime, Math.round((config?.avg_job_hours || 2) * 60));
  }

  // Available jobs (not in route, for selected date)
  const bookedLeadIds = new Set(route.map((r) => r.booking.lead_id));
  const availableJobs = pendingBookings.filter((pb) => !bookedLeadIds.has(pb.lead_id));

  // Appointments on selected date
  const apptsThatDay = appointments.filter((a) => a.scheduled_date === selectedDate);

  // Render map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    import("leaflet").then((L) => {
      const map = L.map(mapRef.current!, { zoomControl: true }).setView([35.5, -95], 9);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = map;
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update map markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    import("leaflet").then((L) => {
      const map = mapInstanceRef.current;

      // Remove all markers
      map.eachLayer((layer: any) => {
        if (layer instanceof L.Marker || layer instanceof L.CircleMarker || layer instanceof L.Polyline) {
          map.removeLayer(layer);
        }
      });

      const bounds: [number, number][] = [];

      // Existing appointments (blue pins)
      apptsThatDay.forEach((appt) => {
        const matchingRoute = route.find((r) => r.booking.lead_id === appt.lead_id);
        if (!matchingRoute) {
          // TODO: We'd need to geocode appointments too, but they're already scheduled
          // For now, skip them or fetch their geocodes
        }
      });

      // Pending jobs not in route (gray pins)
      availableJobs.forEach((job) => {
        if (geocodeCache[job.lead_id]) {
          const loc = geocodeCache[job.lead_id];
          if (loc) {
            bounds.push([loc.lat, loc.lon]);
            const icon = L.divIcon({
              html: `<div style="background:#999;color:#fff;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold;box-shadow:0 2px 6px rgba(0,0,0,0.4)">📍</div>`,
              className: "",
              iconSize: [24, 24],
              iconAnchor: [12, 12],
            });
            const marker = L.marker([loc.lat, loc.lon], { icon })
              .addTo(map)
              .bindPopup(`<div style="font-size:11px"><strong>${job.full_name}</strong><br/>${job.phone}<br/><em>${job.handoff_reason}</em></div>`);

            marker.on("click", () => {
              addToRoute(job);
            });
          }
        }
      });

      // Route stops (gold numbered pins)
      route.forEach((stop, idx) => {
        if (stop.location) {
          bounds.push([stop.location.lat, stop.location.lon]);
          const icon = L.divIcon({
            html: `<div style="background:var(--color-gold);color:#000;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:bold;box-shadow:0 2px 6px rgba(0,0,0,0.4)">${idx + 1}</div>`,
            className: "",
            iconSize: [32, 32],
            iconAnchor: [16, 16],
          });
          const marker = L.marker([stop.location.lat, stop.location.lon], { icon })
            .addTo(map)
            .bindPopup(`<div style="font-size:11px"><strong>${stop.booking.full_name}</strong><br/>${stop.booking.phone}<br/><em>${stop.booking.handoff_reason}</em><br/><strong>Arrive: ${stop.estimatedArrival}</strong></div>`);

          marker.on("click", () => {
            removeFromRoute(stop.booking.conversation_id);
          });
        }
      });

      // Polyline connecting route
      if (route.length > 1) {
        const routeCoords: [number, number][] = route
          .map((r) => (r.location ? [r.location.lat, r.location.lon] : null))
          .filter(Boolean) as [number, number][];

        if (routeCoords.length > 1) {
          L.polyline(routeCoords, {
            color: "var(--color-gold)",
            weight: 3,
            opacity: 0.7,
            dashArray: "5, 5",
          }).addTo(map);
        }
      }

      // Fit bounds
      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
      }
    });
  }, [route, availableJobs, apptsThatDay, geocodeCache]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <div className="flex gap-4 min-h-[calc(100vh-200px)]">
        {/* Left Panel (1/3) */}
        <div className="w-1/3 surface p-4 rounded-lg border border-[var(--color-border)] overflow-y-auto flex flex-col">
          {/* Date Picker */}
          <div className="mb-4">
            <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--color-text-soft)] mb-1">
              Date
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm"
            />
          </div>

          {/* Start Time */}
          <div className="mb-4">
            <label className="block text-xs font-semibold uppercase tracking-widest text-[var(--color-text-soft)] mb-1">
              Start Time
            </label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full px-3 py-2 rounded bg-[var(--color-bg-soft)] text-white border border-[var(--color-border)] focus:outline-none focus:border-[var(--color-gold)] text-sm"
            />
          </div>

          {/* Available Jobs Section */}
          {availableJobs.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--color-gold)] mb-2">
                Available Jobs ({availableJobs.length})
              </h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {availableJobs.map((job) => {
                  const price = job.quoted_price_cents
                    ? `$${(job.quoted_price_cents / 100).toFixed(0)}`
                    : null;
                  const serviceHint = job.handoff_reason
                    ? job.handoff_reason.replace(/^ready to book[\s\-–]+/i, "").replace(/^win:/i, "").slice(0, 40)
                    : null;
                  const isGeocoding = geocodingStatus[job.lead_id];
                  const geocoded = geocodeCache[job.lead_id];
                  const geocodeFailed = geocodeCache[job.lead_id] === null;

                  return (
                    <button
                      key={job.conversation_id}
                      onClick={() => addToRoute(job)}
                      disabled={isGeocoding}
                      className="w-full text-left p-2 rounded bg-[var(--color-bg-soft)] border border-[var(--color-border)] hover:border-[var(--color-gold)]/50 hover:bg-[var(--color-gold)]/5 transition-all text-xs"
                    >
                      <div className="flex items-start justify-between gap-1 mb-1">
                        <p className="font-bold text-white truncate text-xs">{job.full_name}</p>
                        <span className="text-[var(--color-gold)] text-xs font-bold shrink-0">+</span>
                      </div>
                      {job.phone && <p className="text-[var(--color-text-soft)] text-xs">{job.phone}</p>}
                      <p className="text-[var(--color-text-soft)] text-xs">
                        📍 {[job.address, job.city, job.state].filter(Boolean).join(", ")}
                      </p>
                      {serviceHint && <p className="text-[var(--color-text-soft)] text-xs line-clamp-1">🔧 {serviceHint}</p>}
                      {price && <p className="text-[var(--color-gold)] text-xs font-bold mt-1">{price}</p>}
                      {isGeocoding && <p className="text-xs text-yellow-400 mt-1">📍 Locating...</p>}
                      {geocodeFailed && <p className="text-xs text-red-400 mt-1">⚠ Location not found</p>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {availableJobs.length === 0 && (
            <div className="text-center text-xs text-[var(--color-text-soft)] py-4">
              All jobs added to route or no pending jobs.
            </div>
          )}

          {/* Route Section */}
          {route.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-[var(--color-gold)] mb-2">
                Route ({route.length})
              </h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {route.map((stop, idx) => {
                  const price = stop.booking.quoted_price_cents
                    ? `$${(stop.booking.quoted_price_cents / 100).toFixed(0)}`
                    : null;
                  const serviceHint = stop.booking.handoff_reason
                    ? stop.booking.handoff_reason.replace(/^ready to book[\s\-–]+/i, "").replace(/^win:/i, "").slice(0, 40)
                    : null;

                  return (
                    <div key={stop.booking.conversation_id} className="p-2 rounded bg-[var(--color-gold)]/10 border border-[var(--color-gold)]/30">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[var(--color-gold)] font-bold text-sm">#{idx + 1}</span>
                          <p className="font-bold text-white text-xs truncate">{stop.booking.full_name}</p>
                        </div>
                        <button
                          onClick={() => removeFromRoute(stop.booking.conversation_id)}
                          className="text-red-400 hover:text-red-300 font-bold text-xs px-2"
                        >
                          ✕
                        </button>
                      </div>
                      {stop.booking.phone && <p className="text-[var(--color-text-soft)] text-xs">{stop.booking.phone}</p>}
                      {stop.estimatedArrival && (
                        <p className="text-[var(--color-gold)] text-xs font-semibold mt-1">
                          ⏰ Arrive {stop.estimatedArrival}
                        </p>
                      )}
                      {stop.travelTimeMinutes && (
                        <p className="text-[var(--color-text-soft)] text-xs">~{stop.travelTimeMinutes}min drive</p>
                      )}
                      {serviceHint && <p className="text-[var(--color-text-soft)] text-xs line-clamp-1">🔧 {serviceHint}</p>}
                      {price && <p className="text-[var(--color-gold)] text-xs font-bold">{price}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Summary */}
          {route.length > 0 && (
            <div className="p-3 rounded bg-[var(--color-bg-soft)] border border-[var(--color-border)] mb-4 text-xs space-y-1">
              <p className="text-white font-bold">📊 Route Summary</p>
              <p className="text-[var(--color-text-soft)]">
                <span className="text-[var(--color-gold)]">{totalJobs}</span> jobs
              </p>
              <p className="text-[var(--color-text-soft)]">
                <span className="text-[var(--color-gold)]">~{totalDriveTime}</span> min drive
              </p>
              <p className="text-[var(--color-text-soft)]">
                <span className="text-[var(--color-gold)]">~{Math.round(totalWorkTime)}</span> hrs work
              </p>
              <p className="text-[var(--color-text-soft)]">
                End: <span className="text-[var(--color-gold)]">{estimatedEndTime}</span>
              </p>
            </div>
          )}

          {/* Booked Confirmation Section */}
          {bookedAppointmentIds.length > 0 && (
            <div className="p-3 rounded bg-green-500/10 border border-green-500/30 mb-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-green-400 mb-2">✅ Route Confirmed</h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {/* We need to reconstruct booked job info from route state. Since route was cleared, 
                    let's show appointment IDs and offer to send SMS */}
                {bookedAppointmentIds.map((apptId, idx) => {
                  const isSending = smsSendingStatus[apptId];
                  const isSent = smsSentStatus[apptId];
                  return (
                    <div key={apptId} className="p-2 rounded bg-green-500/5 border border-green-500/20 flex items-center justify-between gap-2">
                      <span className="text-xs text-green-300 font-bold">Job #{idx + 1}</span>
                      <button
                        onClick={() => sendSchedulingSms(apptId)}
                        disabled={isSending || isSent}
                        className="px-2 py-1 rounded text-xs font-semibold bg-green-600 text-white hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                      >
                        {isSent ? "✓ Sent" : isSending ? "Sending..." : "📱 Send SMS"}
                      </button>
                    </div>
                  );
                })}
              </div>
              <button
                onClick={sendAllSchedulingSms}
                disabled={bookedAppointmentIds.length === 0 || bookedAppointmentIds.every((id) => smsSentStatus[id])}
                className="w-full mt-2 px-4 py-2 rounded-lg bg-green-600 text-white font-bold uppercase text-xs hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                📱 Send All SMS
              </button>
              <button
                onClick={() => {
                  setBookedAppointmentIds([]);
                  setSmsSentStatus({});
                  setSmsSendingStatus({});
                }}
                className="w-full mt-2 px-4 py-2 rounded-lg bg-[var(--color-border)] text-[var(--color-text-soft)] font-bold uppercase text-xs hover:bg-[var(--color-bg-soft)] transition-colors"
              >
                🔄 New Route
              </button>
            </div>
          )}

          {/* Book Button */}
          {bookedAppointmentIds.length === 0 && (
            <button
              onClick={bookRoute}
              disabled={route.length === 0 || bookingRoute}
              className="w-full px-4 py-3 rounded-lg bg-[var(--color-gold)] text-black font-bold uppercase text-xs hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-auto"
            >
              {bookingRoute ? "Booking Route..." : `✅ Book ${route.length} Job${route.length !== 1 ? "s" : ""}`}
            </button>
          )}
        </div>

        {/* Right Panel (2/3) — Map */}
        <div className="w-2/3 surface rounded-lg border border-[var(--color-border)] overflow-hidden">
          <div ref={mapRef} className="w-full h-full" />
        </div>
      </div>
    </>
  );
}
