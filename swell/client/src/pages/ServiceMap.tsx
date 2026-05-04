import { useEffect, useRef, useState } from "react";
import type { MePayload } from "../lib/api";

interface Props {
  me: MePayload;
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

export function ServiceMap({ me }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const [pins, setPins] = useState<{ customers: MapPin[]; leads: MapPin[] }>({
    customers: [],
    leads: [],
  });
  const [filter, setFilter] = useState<"all" | "hot" | "completed" | "leads">(
    "all"
  );
  const [geocoding, setGeocoding] = useState(false);
  const [stats, setStats] = useState({ total: 0, geocoded: 0 });
  const [addressSearch, setAddressSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [mapLayer, setMapLayer] = useState<"street" | "satellite">("street");
  const tileLayerRef = useRef<any>(null);
  const [locating, setLocating] = useState(false);

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
          // Add a temporary search marker
          const searchIcon = L.divIcon({
            html: `<div style="background:#fbbf24;color:#000;padding:4px 8px;border-radius:6px;font-size:11px;font-weight:bold;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.4)">📍 ${label.split(',').slice(0,2).join(',')}</div>`,
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
    // Poll until done (rough: wait 10s then refresh)
    setTimeout(() => {
      fetchPins();
      setGeocoding(false);
    }, 12000);
  }

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Dynamically import Leaflet
    import("leaflet").then((L) => {
      // Fix Leaflet default marker icon
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      // Start at a neutral US view; will auto-fit once pins load
      const map = L.map(mapRef.current!, { zoomControl: false }).setView(
        [37.5, -96.0],
        4
      );
      // Move zoom control to bottom-right so it doesn't conflict with mobile header
      L.control.zoom({ position: "bottomright" }).addTo(map);

      tileLayerRef.current = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
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
  }, [mapRef.current]);

  // Update markers whenever pins or filter changes
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    import("leaflet").then((L) => {
      const map = mapInstanceRef.current;

      // Remove all existing markers
      map.eachLayer((layer: any) => {
        if (layer instanceof L.Marker || layer instanceof L.CircleMarker) {
          map.removeLayer(layer);
        }
      });

      const allPins: Array<MapPin & { _type: "customer" | "lead" }> = [
        ...pins.customers.map((p) => ({ ...p, _type: "customer" as const })),
        ...pins.leads.map((p) => ({ ...p, _type: "lead" as const })),
      ];

      const filtered = allPins.filter((p) => {
        if (!p.lat || !p.lon) return false;
        if (filter === "hot") return p.repeat_probability === "hot";
        if (filter === "completed")
          return p.job_count > 0 || p.status === "completed";
        if (filter === "leads") return p._type === "lead";
        return true;
      });

      const bounds: [number, number][] = [];

      filtered.forEach((pin) => {
        const lat = pin.lat!;
        const lon = pin.lon!;
        bounds.push([lat, lon]);

        // Color by temperature
        const color =
          pin.repeat_probability === "hot"
            ? "#fbbf24"
            : pin.job_count > 0
              ? "#10b981"
              : pin._type === "lead"
                ? "#60a5fa"
                : "#a855f7";

        const marker = L.circleMarker([lat, lon], {
          radius: pin.job_count > 0 ? 10 : 7,
          fillColor: color,
          color: "#000",
          weight: 1,
          opacity: 0.8,
          fillOpacity: 0.85,
        }).addTo(map);

        const name = pin.full_name || pin.phone || "Unknown";
        const value = pin.lifetime_value_cents
          ? `$${Math.round(pin.lifetime_value_cents / 100)}`
          : "";
        const jobs = pin.job_count
          ? `${pin.job_count} job${pin.job_count !== 1 ? "s" : ""}`
          : "No jobs yet";

        const GKEY = "AIzaSyC3oEBPF6bAkBtW3kCZFh_1uvPYcIFh73w";
        const svUrl = `https://maps.googleapis.com/maps/api/streetview?size=280x140&location=${lat},${lon}&fov=90&key=${GKEY}`;
        const svCheck = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lon}&key=${GKEY}`;
        const zillowQuery = encodeURIComponent(`${pin.address ?? ""} ${pin.city ?? ""} ${pin.state ?? ""}`.trim());
        const zillowUrl = `https://www.zillow.com/homes/${zillowQuery}_rb/`;
        const sqft = (pin as any).sqft || "";
        const yearBuilt = (pin as any).year_built || "";

        marker.bindPopup(`
          <div style="min-width:240px;font-family:system-ui;max-width:280px">
            <img src="${svUrl}" style="width:100%;height:140px;object-fit:cover;border-radius:6px 6px 0 0;margin-bottom:8px;display:block" onerror="this.style.display='none'" />
            <div style="font-weight:bold;font-size:14px;margin-bottom:4px">${name}</div>
            ${pin.phone ? `<div style="color:#666;font-size:12px">📞 ${pin.phone}</div>` : ""}
            ${pin.address ? `<div style="color:#666;font-size:12px">📍 ${pin.address}${pin.city ? `, ${pin.city}` : ""}</div>` : ""}
            ${sqft ? `<div style="color:#888;font-size:11px;margin-top:2px">🏠 ${sqft} sqft</div>` : ""}
            ${yearBuilt ? `<div style="color:#888;font-size:11px">Built ${yearBuilt}</div>` : ""}
            <div style="margin-top:6px;font-size:12px">
              ${jobs}${value ? ` · ${value} LTV` : ""}
            </div>
            <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
              ${pin.phone ? `<a href="tel:${pin.phone}" style="background:#fbbf24;color:#000;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:bold;text-decoration:none">📞 Call</a>` : ""}
              ${pin.phone ? `<a href="sms:${pin.phone}" style="background:#1f2937;color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;text-decoration:none">💬 Text</a>` : ""}
              ${pin.address ? `<a href="${zillowUrl}" target="_blank" style="background:#006aff;color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;text-decoration:none">🏠 Zillow</a>` : ""}
              <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}" target="_blank" style="background:#34a853;color:#fff;padding:3px 8px;border-radius:4px;font-size:11px;text-decoration:none">👁 Street View</a>
            </div>
          </div>
        `, { maxWidth: 300 });
      });

      // Fit bounds if we have pins
      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 11);
      }
    });
  }, [pins, filter]);

  const geocodedCount = stats.geocoded;
  const totalCount = stats.total;

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-3 py-2 sm:px-4 sm:py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 flex-shrink-0 overflow-x-auto">
        <div className="flex items-center gap-2 sm:gap-3 whitespace-nowrap">
          <h1 className="text-white font-bold text-base sm:text-lg">📍 Map</h1>
          <span className="text-xs text-gray-400 hidden sm:inline">
            {geocodedCount}/{totalCount} locations mapped
          </span>
        </div>

        {/* My Location button */}
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
            className={`px-2 sm:px-3 py-1.5 min-h-[36px] transition-colors flex items-center justify-center ${mapLayer === "street" ? "bg-yellow-400 text-black" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>
            🗺 <span className="hidden sm:inline ml-1">Map</span>
          </button>
          <button onClick={() => toggleLayer("satellite")}
            className={`px-2 sm:px-3 py-1.5 min-h-[36px] transition-colors flex items-center justify-center ${mapLayer === "satellite" ? "bg-yellow-400 text-black" : "bg-gray-800 text-gray-300 hover:bg-gray-700"}`}>
            🛰 <span className="hidden sm:inline ml-1">Sat</span>
          </button>
        </div>

        {/* Address search bar */}
        <form onSubmit={(e) => { e.preventDefault(); searchAddress(); }} className="flex items-center gap-1 flex-1 sm:max-w-sm w-full min-h-[36px]">
          <input
            type="text"
            value={addressSearch}
            onChange={(e) => setAddressSearch(e.target.value)}
            placeholder="Address..."
            className="flex-1 px-2 sm:px-3 py-1.5 rounded-l bg-gray-800 border border-gray-700 text-white text-xs sm:text-sm placeholder-gray-500 focus:outline-none focus:border-yellow-400"
          />
          <button type="submit" disabled={searching}
            className="px-3 py-1.5 rounded-r bg-yellow-400 text-black text-sm font-bold hover:bg-yellow-300 disabled:opacity-50 min-h-[36px] flex items-center">
            {searching ? "..." : "🔍"}
          </button>
        </form>

        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          {/* Filter */}
          {(["all", "hot", "completed", "leads"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 sm:px-3 py-1.5 min-h-[36px] rounded text-xs font-semibold transition-colors flex items-center justify-center ${
                filter === f
                  ? "bg-yellow-400 text-black"
                  : "bg-gray-800 text-gray-300 hover:bg-gray-700"
              }`}
            >
              {f === "all"
                ? "All"
                : f === "hot"
                  ? "🔥 Hot"
                  : f === "completed"
                    ? "✅ Completed"
                    : "New Leads"}
            </button>
          ))}

          {/* Geocode button */}
          {totalCount > geocodedCount && (
            <button
              onClick={triggerGeocode}
              disabled={geocoding}
              className="px-2 sm:px-3 py-1.5 min-h-[36px] rounded text-xs font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 flex items-center justify-center"
            >
              {geocoding
                ? "Geocoding..."
                : `📍 Map ${totalCount - geocodedCount} missing`}
            </button>
          )}
        </div>

        {/* Legend */}
        <div className="hidden md:flex items-center gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#fbbf24",
                display: "inline-block",
              }}
            />
            Hot
          </span>
          <span className="flex items-center gap-1">
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#10b981",
                display: "inline-block",
              }}
            />
            Completed
          </span>
          <span className="flex items-center gap-1">
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#60a5fa",
                display: "inline-block",
              }}
            />
            New Lead
          </span>
          <span className="flex items-center gap-1">
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#a855f7",
                display: "inline-block",
              }}
            />
            Warm
          </span>
        </div>
      </div>

      {/* Map */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      />
      <div ref={mapRef} className="flex-1 w-full" style={{ minHeight: 0 }} />
    </div>
  );
}
