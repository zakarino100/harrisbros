/**
 * Geocoder — uses Google Maps Geocoding API when key is available,
 * falls back to Nominatim (OpenStreetMap, free) if not configured.
 */

export interface GeoResult {
  lat: number;
  lon: number;
  displayName: string;
}

async function geocodeGoogle(query: string): Promise<GeoResult | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${key}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json() as any;
    if (data.status !== "OK" || !data.results?.length) return null;
    const loc = data.results[0].geometry.location;
    return { lat: loc.lat, lon: loc.lng, displayName: data.results[0].formatted_address };
  } catch { return null; }
}

async function geocodeNominatim(query: string): Promise<GeoResult | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { "User-Agent": "SwellCRM/1.0 (contact@nopressurelaunch.com)" } });
    if (!res.ok) return null;
    const data = await res.json() as any[];
    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), displayName: data[0].display_name };
  } catch { return null; }
}

export async function geocodeAddress(
  address: string | null,
  city?: string | null,
  state?: string | null,
  zip?: string | null,
): Promise<GeoResult | null> {
  const full = [address, city, state, zip].filter(Boolean).join(", ");
  if (!full.trim()) return null;

  // Try Google first (most accurate)
  const google = await geocodeGoogle(full);
  if (google) return google;

  // Fallback: Nominatim with progressively less specific queries
  const nominatim = await geocodeNominatim(full);
  if (nominatim) return nominatim;

  // Last resort: city + state
  const cityState = [city, state, zip].filter(Boolean).join(", ");
  if (cityState) return geocodeNominatim(cityState);

  return null;
}
