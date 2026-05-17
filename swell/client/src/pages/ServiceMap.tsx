import { useEffect, useRef, useState } from "react";
import type { MePayload } from "../lib/api";

interface Props {
  me: MePayload;
  onSelectLead?: (leadId: number) => void;
}

interface MapPin {
  id: number;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lon: number | null;
  lead_score: number;
  repeat_probability: string;
  lifetime_value_cents: number;
  job_count: number;
  last_job_date: string | null;
  lead_count?: number;
  status?: string;
  tags?: string[];
}

type FilterType = "all" | "new_leads" | "contacted" | "serviced";

const FILTER_LABELS: Record<FilterType, string> = {
  all: "All",
  new_leads: "🆕 New Leads",
  contacted: "💬 Contacted",
  serviced: "✅ Serviced",
};

// Pin colors by category
function pinColor(pin: MapPin & { _type: "customer" | "lead" }): string {
  if (pin.job_count > 0) return "#10b981"; // green — serviced
  const s = (pin.status ?? "").toLowerCase();
  if (s === "contacted" || s === "quoted" || s === "active" || s === "handoff") return "#f59e0b"; // amber — contacted
  return "#60a5fa"; // blue — new lead
}

function pinCategory(pin: MapPin & { _type: "customer" | "lead" }): FilterType {
  if (pin.job_count > 0) return "serviced";
  const s = (pin.status ?? "").toLowerCase();
  if (s === "contacted" || s === "quoted" || s === "active" || s === "handoff") return "contacted";
  return "new_leads";
}

export function ServiceMap({ me, onSelectLead }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);
  const [pins, setPins] = useState<{ customers: MapPin[]; leads: MapPin[] }>({
    customers: [],
    leads: [],
  });
  const [filter, setFilter] = useState<FilterType>("all");
  const [geocoding, setGeocoding] = useState(false);
  const [stats, setStats] = useState({ total: 0, geocoded: 0 });
  const [addressSearch, setAddressSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [mapLayer, setMapLayer] = useState<"street" | "satellite">("street");
  const tileLayerRef = useRef<any>(null);
  const [locating, setLocating] = useState(false);
  const markersRef = useRef<any[]>([]);

  // Load pins on mount
  useEffect(() => {
    fetchPins();
  }, []);

  async function fetchPins() {
    const res = await fetch("/api/map/pins", { credentials: "include" });
    if (!res.ok) return;
    const data = await res.json();
    setPins(data);
    const all = [...(data.customers || []), ...(data.leads || [])];
    setStats({
      total: all.length,
      geocoded: all.filter((p: MapPin) => p.lat && p.lon).length,
    });
  }

  function toggleLayer(layer: "street" | "satellite") {
    setMapLayer(layer);
    if (!mapInstanceRef.current) return;
    import("leaflet").then((L) => {
      if (tileLayerRef.current) mapInstanceRef.current.removeLayer(tileLayerRef.current);
      const url = layer === "satellite"
        ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
      const attr = layer === "satellite"
        ? "Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA"
        : "&copy; OpenStreetMap contributors";
      tileLayerRef.current = L.tileLayer(url, { attribution: attr, maxZoom: 19 }).addTo(mapInstanceRef.current);
    });
  }

  async function searchAddress() {
    if (!addressSearch.trim() || !mapInstanceRef.current) return;
    setSearching(true);
    try {
      const key = "AIzaSyC3oEBPF6bAkBtW3kCZFh_1uvPYcIFh73w";
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressSearch)}&key=${key}`;
      const res = await fetch(url);
      const data = await res.json() as any;
      if (data.status === "OK" && data.results?.length) {
        const loc = data.results[0].geometry.location;
        const label = data.results[0].formatted_address;
        import("leaflet").then((L) => {
          const map = mapInstanceRef.current;
          map.setView([loc.lat, loc.lng], 14);
          const searchIcon = L.divIcon({
            html: `<div style="background:#fbbf24;color:#000;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:bold;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.4)">📍 ${label.split(",").slice(0, 2).join(",")}</div>`,
            className: "",
            iconAnchor: [0, 0],
          });
          const marker = L.marker([loc.lat, loc.lng], { icon: searchIcon }).addTo(map);
          setTimeout(() => map.removeLayer(marker), 8000);
        });
      } else {
        alert("Address not found. Try a more specific address.");
      }
    } catch { alert("Search failed."); }
    finally { setSearching(false); }
  }

  function goToMyLocation() {
    if (!mapInstanceRef.current || !navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        mapInstanceRef.current.setView([latitude, longitude], 13);
        import("leaflet").then((L) => {
          const pulseIcon = L.divIcon({
            html: `<div style="width:16px;height:16px;background:#fbbf24;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 4px rgba(251,191,36,0.3)"></div>`,
            className: "",
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          });
          const m = L.marker([latitude, longitude], { icon: pulseIcon }).addTo(mapInstanceRef.current);
          setTimeout(() => mapInstanceRef.current?.removeLayer(m), 8000);
        });
        setLocating(false);
      },
      () => { setLocating(false); alert("Location access denied."); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function triggerGeocode() {
    setGeocoding(true);
    await fetch("/api/map/geocode", { method: "POST", credentials: "include" });
    setTimeout(() => {
      fetchPins();
      setGeocoding(false);
    }, 12000);
  }

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    import("leaflet").then((L) => {
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(mapRef.current!, { zoomControl: false }).setView([33.75, -84.39], 10); // default: Atlanta (Mack's area)
      L.control.zoom({ position: "bottomright" }).addTo(map);

      tileLayerRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = map;
      setMapReady(true); // signal that map is ready
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [mapRef.current]);

  // Render markers — runs when map is ready OR pins/filter change
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;

    import("leaflet").then((L) => {
      const map = mapInstanceRef.current;

      // Clear existing markers
      markersRef.current.forEach((m) => map.removeLayer(m));
      markersRef.current = [];

      const allPins: Array<MapPin & { _type: "customer" | "lead" }> = [
        ...pins.customers.map((p) => ({ ...p, _type: "customer" as const })),
        ...pins.leads.map((p) => ({ ...p, _type: "lead" as const })),
      ];

      // Only show pins that have coordinates
      const geocoded = allPins.filter((p) => p.lat && p.lon);

      // Apply filter
      const filtered = geocoded.filter((p) => {
        if (filter === "all") return true;
        return pinCategory(p) === filter;
      });

      if (filtered.length === 0) return;

      const bounds: [number, number][] = [];

      filtered.forEach((pin) => {
        const lat = pin.lat!;
        const lon = pin.lon!;
        bounds.push([lat, lon]);

        const color = pinColor(pin);
        const radius = pin.job_count > 0 ? 10 : 7;

        const marker = L.circleMarker([lat, lon], {
          radius,
          fillColor: color,
          color: "#fff",
          weight: 1.5,
          opacity: 1,
          fillOpacity: 0.9,
        }).addTo(map);

        markersRef.current.push(marker);

        const name = pin.full_name || pin.phone || "Unknown";
        const value = pin.lifetime_value_cents ? `$${Math.round(pin.lifetime_value_cents / 100)}` : "";
        const jobs = pin.job_count ? `${pin.job_count} job${pin.job_count !== 1 ? "s" : ""}` : "No jobs yet";
        const statusLabel = pin.job_count > 0 ? "Serviced" :
          ["contacted", "quoted", "active", "handoff"].includes((pin.status ?? "").toLowerCase()) ? "Contacted" : "New Lead";
        const GKEY = "AIzaSyC3oEBPF6bAkBtW3kCZFh_1uvPYcIFh73w";
        const svUrl = `https://maps.googleapis.com/maps/api/streetview?size=280x140&location=${lat},${lon}&fov=90&key=${GKEY}`;
        const zillowQuery = encodeURIComponent(`${pin.address ?? ""} ${pin.city ?? ""} ${pin.state ?? ""}`.trim());
        const zillowUrl = `https://www.zillow.com/homes/${zillowQuery}_rb/`;
        const sqft = (pin as any).sqft || "";
        const yearBuilt = (pin as any).year_built || "";

        const viewLeadBtn = onSelectLead
          ? `<button onclick="window.__swellSelectLead(${pin.id})" style="background:#fbbf24;color:#000;padding:4px 10px;border-radius:4px;font-size:11px;font-weight:bold;border:none;cursor:pointer;width:100%;margin-top:6px">View Lead →</button>`
          : "";

        marker.bindPopup(`
          <div style="min-width:240px;font-family:system-ui;max-width:280px">
            <img src="${svUrl}" style="width:100%;height:130px;object-fit:cover;border-radius:6px 6px 0 0;margin-bottom:8px;display:block" onerror="this.style.display='none'" />
            <div style="font-weight:bold;font-size:14px;margin-bottom:2px">${name}</div>
            <div style="display:inline-block;padding:2px 7px;border-radius:99px;font-size:10px;font-weight:bold;background:${color};color:${pin.job_count > 0 ? "#fff" : "#000"};margin-bottom:6px">${statusLabel}</div>
            ${pin.phone ? `<div style="color:#555;font-size:12px">📞 ${pin.phone}</div>` : ""}
            ${pin.address ? `<div style="color:#555;font-size:12px">📍 ${pin.address}${pin.city ? `, ${pin.city}` : ""}</div>` : ""}
            ${sqft ? `<div style="color:#888;font-size:11px;margin-top:2px">🏠 ${sqft} sqft</div>` : ""}
            ${yearBuilt ? `<div style="color:#888;font-size:11px">Built ${yearBuilt}</div>` : ""}
            <div style="margin-top:6px;font-size:12px;color:#444">${jobs}${value ? ` · ${value} LTV` : ""}</div>
            <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
              ${pin.phone ? `<a href="tel:${pin.phone}" style="background:#1f2937;color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:bold;text-decoration:none">📞 Call</a>` : ""}
              ${pin.phone ? `<a href="sms:${pin.phone}" style="background:#374151;color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;text-decoration:none">💬 Text</a>` : ""}
              ${pin.address ? `<a href="${zillowUrl}" target="_blank" style="background:#006aff;color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;text-decoration:none">🏠 Zillow</a>` : ""}
              <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}" target="_blank" style="background:#34a853;color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;text-decoration:none">👁 Street View</a>
            </div>
            ${viewLeadBtn}
          </div>
        `, { maxWidth: 300 });
      });

      // Auto-fit to all pins
      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 13 });
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 13);
      }
    });
  }, [mapReady, pins, filter]);

  // Wire up global callback for "View Lead" button inside Leaflet popup
  useEffect(() => {
    if (!onSelectLead) return;
    (window as any).__swellSelectLead = (leadId: number) => {
      onSelectLead(leadId);
    };
    return () => { delete (window as any).__swellSelectLead; };
  }, [onSelectLead]);

  const geocodedCount = stats.geocoded;
  const totalCount = stats.total;

  return (
    <div className="h-screen flex flex-col">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />

      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-3 py-2 sm:px-4 sm:py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 flex-shrink-0 overflow-x-auto">
        <div className="flex items-center gap-2 sm:gap-3 whitespace-nowrap">
          <h1 className="text-white font-bold text-base sm:text-lg">📍 Map</h1>
          <span className="text-xs text-gray-400">
            {geocodedCount}/{totalCount} mapped
          </span>
        </div>

        {/* My Location */}
        <button
          onClick={goToMyLocation}
          disabled={locating}
          title="Go to my location"
          className="flex items-center justify-center w-9 h-9 rounded border border-gray-700 bg-gray-800 text-white hover:bg-gray-700 disabled:opacity-50 flex-shrink-0 transition-colors"
        >
          {locating ? "…" : "📍"}
        </button>

        {/* Map layer toggle */}
        <div className="flex rounded overflow-hidden border border-gray-700 text-xs font-semibold flex-shrink-0">
          <button onClick={() => toggleLayer("street")}
            className={`px-2 sm:px-3 py-1.5 min-h-[36px] transition-colors flex items-center ${mapLayer === "street" ? "bg-yellow-400 text-black" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>
            🗺 <span className="hidden sm:inline ml-1">Map</span>
          </button>
          <button onClick={() => toggleLayer("satellite")}
            className={`px-2 sm:px-3 py-1.5 min-h-[36px] transition-colors flex items-center ${mapLayer === "satellite" ? "bg-yellow-400 text-black" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>
            🛰 <span className="hidden sm:inline ml-1">Sat</span>
          </button>
        </div>

        {/* Address search */}
        <form onSubmit={(e) => { e.preventDefault(); searchAddress(); }} className="flex items-center gap-1 flex-1 sm:max-w-sm w-full">
          <input
            type="text"
            value={addressSearch}
            onChange={(e) => setAddressSearch(e.target.value)}
            placeholder="Search address..."
            className="flex-1 px-2 sm:px-3 py-1.5 rounded-l bg-gray-800 border border-gray-700 text-white text-xs sm:text-sm placeholder-gray-500 focus:outline-none focus:border-yellow-400"
          />
          <button type="submit" disabled={searching}
            className="px-3 py-1.5 rounded-r bg-yellow-400 text-black text-sm font-bold hover:bg-yellow-300 disabled:opacity-50 min-h-[36px] flex items-center">
            {searching ? "..." : "🔍"}
          </button>
        </form>

        {/* Filters */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {(["all", "new_leads", "contacted", "serviced"] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 sm:px-3 py-1.5 min-h-[36px] rounded text-xs font-semibold transition-colors ${
                filter === f ? "bg-yellow-400 text-black" : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              {FILTER_LABELS[f]}
            </button>
          ))}

          {/* Geocode missing */}
          {totalCount > geocodedCount && (
            <button
              onClick={triggerGeocode}
              disabled={geocoding}
              className="px-2 sm:px-3 py-1.5 min-h-[36px] rounded text-xs font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {geocoding ? "Geocoding..." : `📍 Map ${totalCount - geocodedCount} missing`}
            </button>
          )}
        </div>

        {/* Legend */}
        <div className="hidden lg:flex items-center gap-3 text-xs text-gray-400 flex-shrink-0">
          <span className="flex items-center gap-1">
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#60a5fa", display: "inline-block" }} />
            New
          </span>
          <span className="flex items-center gap-1">
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />
            Contacted
          </span>
          <span className="flex items-center gap-1">
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
            Serviced
          </span>
        </div>
      </div>

      {/* Map */}
      <div ref={mapRef} className="flex-1 w-full" style={{ minHeight: 0 }} />
    </div>
  );
}
