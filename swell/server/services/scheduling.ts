/**
 * Scheduling engine — computes available booking slots for Hayden.
 * Takes tenant schedule config, existing appointments, and weather
 * to return an array of bookable slots for the next N days.
 */
import { getScheduleConfig, getAIConfig, countAppointmentsOnDate } from "../db/queries.js";
import { getCachedForecast, type DayForecast } from "./weather.js";

export interface AvailableSlot {
  date: string;        // YYYY-MM-DD
  dayName: string;     // "Tuesday"
  displayDate: string; // "Tuesday, May 6"
  slotsLeft: number;
  weatherOk: boolean;
  rainProbability: number;
  weatherDescription: string;
  tempMaxF: number;
}

const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getAvailableSlots(tenantId: string, daysAhead = 14): Promise<AvailableSlot[]> {
  const config = await getScheduleConfig(tenantId);
  if (!config) return [];

  const aiConfig = await getAIConfig(tenantId);
  const routeCities: string[] = config.service_cities?.length
    ? config.service_cities
    : (Array.isArray(aiConfig?.route_cities_json) ? aiConfig.route_cities_json : []) as string[];

  const primaryCity = routeCities[0] ?? null;
  const forecast: DayForecast[] = primaryCity
    ? await getCachedForecast(primaryCity, config.timezone)
    : [];

  // Get total crew capacity
  const { sql } = await import("../db/index.js");
  const crews = await sql`SELECT max_jobs_per_day FROM swell_crews WHERE tenant_id = ${tenantId} AND active = true`;
  const totalCapacity = crews.length > 0
    ? crews.reduce((sum: number, c: any) => sum + c.max_jobs_per_day, 0)
    : config.max_jobs_per_day;

  const forecastMap = new Map(forecast.map(f => [f.date, f]));
  const slots: AvailableSlot[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 1; i <= daysAhead; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dateStr = toDateString(d);
    const dayOfWeek = d.getDay(); // 0=Sun..6=Sat

    if (!config.work_days.includes(dayOfWeek)) continue;

    const booked = await countAppointmentsOnDate(tenantId, dateStr);
    const slotsLeft = totalCapacity - booked;
    if (slotsLeft <= 0) continue;

    const wx = forecastMap.get(dateStr);
    const displayDate = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

    slots.push({
      date: dateStr,
      dayName: DAY_NAMES[dayOfWeek],
      displayDate,
      slotsLeft,
      weatherOk: wx ? !wx.willRain : true,
      rainProbability: wx?.rainProbability ?? 0,
      weatherDescription: wx?.description ?? "Unknown",
      tempMaxF: wx?.tempMaxF ?? 0,
    });
  }

  return slots;
}

/**
 * Returns a compact text block for injection into Hayden's system prompt.
 * Shows the next 5 available weather-ok slots, or 5 available slots if all are rainy.
 */
export async function getSlotPromptBlock(tenantId: string): Promise<string> {
  const all = await getAvailableSlots(tenantId, 14);
  if (!all.length) return "No schedule configured — do not offer specific dates. Use 'next week' framing.";

  const goodSlots = all.filter(s => s.weatherOk).slice(0, 5);
  const slots = goodSlots.length >= 2 ? goodSlots : all.slice(0, 5);

  const lines = slots.map(s => {
    const wx = s.rainProbability > 0 ? ` (${s.rainProbability}% rain)` : "";
    const cap = s.slotsLeft === 1 ? " — last slot" : ` — ${s.slotsLeft} slots left`;
    return `  - ${s.displayDate}${cap}${wx}`;
  });

  return `Available booking slots (next 14 days, weather-checked):\n${lines.join("\n")}\n\nWhen closing, offer a CHOICE between two specific dates from this list. After the lead picks one, confirm it and fire <<HANDOFF: ready to book – [date]>>. Include the date in the handoff token so the rep knows which slot to confirm.`;
}
