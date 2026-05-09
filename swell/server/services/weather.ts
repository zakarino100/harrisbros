/**
 * Weather service using Open-Meteo (free, no API key required).
 * Fetches a 14-day forecast for a given city.
 */

export interface DayForecast {
  date: string;          // YYYY-MM-DD
  rainProbability: number; // 0-100
  weatherCode: number;   // WMO code
  tempMaxF: number;
  description: string;
  willRain: boolean;     // rainProbability >= 50
}

// WMO weather interpretation codes → short description
function wmoDescription(code: number): string {
  if (code === 0) return "Clear sky";
  if (code <= 3) return "Partly cloudy";
  if (code <= 9) return "Foggy";
  if (code <= 19) return "Drizzle";
  if (code <= 29) return "Thunderstorm";
  if (code <= 39) return "Blowing snow";
  if (code <= 49) return "Fog";
  if (code <= 59) return "Drizzle";
  if (code <= 69) return "Rain";
  if (code <= 79) return "Snow";
  if (code <= 84) return "Rain showers";
  if (code <= 94) return "Snow showers";
  return "Thunderstorm";
}

async function geocodeCity(city: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
    );
    const data = await res.json() as any;
    const r = data?.results?.[0];
    if (!r) return null;
    return { lat: r.latitude, lon: r.longitude };
  } catch {
    return null;
  }
}

export async function getForecast(city: string, timezone = "America/New_York"): Promise<DayForecast[]> {
  const coords = await geocodeCity(city);
  if (!coords) {
    console.warn(`[weather] Could not geocode city: ${city}`);
    return [];
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}` +
      `&daily=precipitation_probability_max,weathercode,temperature_2m_max` +
      `&temperature_unit=fahrenheit&timezone=${encodeURIComponent(timezone)}&forecast_days=14`;

    const res = await fetch(url);
    const data = await res.json() as any;
    const daily = data?.daily;
    if (!daily?.time?.length) return [];

    return daily.time.map((date: string, i: number) => {
      const rain = daily.precipitation_probability_max[i] ?? 0;
      const code = daily.weathercode[i] ?? 0;
      const temp = daily.temperature_2m_max[i] ?? 0;
      return {
        date,
        rainProbability: rain,
        weatherCode: code,
        tempMaxF: Math.round(temp),
        description: wmoDescription(code),
        willRain: rain >= 50,
      };
    });
  } catch (e) {
    console.error("[weather] Forecast fetch failed:", e);
    return [];
  }
}

// Cache forecasts for 2 hours per city
const forecastCache = new Map<string, { data: DayForecast[]; fetchedAt: number }>();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

export async function getCachedForecast(city: string, timezone = "America/New_York"): Promise<DayForecast[]> {
  const key = `${city}::${timezone}`;
  const cached = forecastCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;
  const data = await getForecast(city, timezone);
  forecastCache.set(key, { data, fetchedAt: Date.now() });
  return data;
}
