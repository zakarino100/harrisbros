/**
 * Google Calendar integration service
 * - OAuth flow management
 * - Calendar selection
 * - Availability checking
 * - Blocked date management
 */
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import {
  saveCalendarTokens,
  getCalendarTokens,
  getBlockedDates,
  addBlockedDate,
  removeBlockedDate,
  getAvailableDays,
} from "../db/queries.js";

const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

export function generateAuthUrl(tenantId: string, state?: string): string {
  const oauth2Client = new OAuth2Client({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  });

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: GOOGLE_OAUTH_SCOPES,
    state: state || tenantId,
    prompt: "consent",
  });
}

export async function handleCallback(
  code: string,
  tenantId: string
): Promise<{ success: boolean; calendar?: { id: string; name: string }; error?: string }> {
  try {
    const oauth2Client = new OAuth2Client({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
    });

    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.access_token) {
      return { success: false, error: "No access token returned" };
    }

    // Get user's primary calendar
    oauth2Client.setCredentials(tokens);
    const calendarApi = google.calendar("v3") as any;
    (calendarApi as any).context = { auth: oauth2Client };

    const calendarList = await calendarApi.calendarList.list();
    const primaryCal = calendarList.data.items?.find((cal: any) => cal.primary);

    const calendarId = primaryCal?.id || "primary";
    const calendarName = primaryCal?.summary || "Primary Calendar";

    // Store tokens
    await saveCalendarTokens(
      tenantId,
      tokens.access_token,
      tokens.refresh_token || "",
      tokens.expiry_date || Date.now() + 3600000,
      calendarId,
      calendarName
    );

    return {
      success: true,
      calendar: { id: calendarId, name: calendarName },
    };
  } catch (err: any) {
    console.error("[calendar] handleCallback error:", err);
    return { success: false, error: err?.message || "Unknown error" };
  }
}

export async function refreshTokenIfNeeded(tenantId: string): Promise<void> {
  const token = await getCalendarTokens(tenantId);
  if (!token) return;

  if (!token.token_expiry || new Date(token.token_expiry) > new Date()) {
    return; // Token still valid
  }

  try {
    const oauth2Client = new OAuth2Client({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
    });

    oauth2Client.setCredentials({
      refresh_token: token.refresh_token,
    });

    const result = await oauth2Client.refreshAccessToken();
    const tokens = result.credentials;
    if (tokens.access_token) {
      await saveCalendarTokens(
        tenantId,
        tokens.access_token,
        token.refresh_token,
        tokens.expiry_date || Date.now() + 3600000,
        token.calendar_id,
        token.calendar_name
      );
    }
  } catch (err: any) {
    console.error("[calendar] refreshTokenIfNeeded error:", err);
    throw err;
  }
}

export async function listCalendars(tenantId: string): Promise<Array<{ id: string; name: string }>> {
  const token = await getCalendarTokens(tenantId);
  if (!token?.access_token) return [];

  try {
    await refreshTokenIfNeeded(tenantId);
    const updatedToken = await getCalendarTokens(tenantId);
    if (!updatedToken?.access_token) return [];

    const oauth2Client = new OAuth2Client({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
    });

    oauth2Client.setCredentials({
      access_token: updatedToken.access_token,
    });

    const calendarApi = google.calendar("v3") as any;
    (calendarApi as any).context = { auth: oauth2Client };
    const list = await calendarApi.calendarList.list({ auth: oauth2Client });

    return (
      list.data.items?.map((cal: any) => ({
        id: cal.id || "primary",
        name: cal.summary || "Unnamed Calendar",
      })) || []
    );
  } catch (err: any) {
    console.error("[calendar] listCalendars error:", err);
    return [];
  }
}

export async function selectCalendar(
  tenantId: string,
  calendarId: string,
  calendarName: string
): Promise<void> {
  const token = await getCalendarTokens(tenantId);
  if (!token?.access_token) throw new Error("No calendar connection");

  await saveCalendarTokens(
    tenantId,
    token.access_token,
    token.refresh_token,
    new Date(token.token_expiry).getTime(),
    calendarId,
    calendarName
  );
}

export async function getCalendarStatus(
  tenantId: string
): Promise<{ connected: boolean; calendarName?: string; calendarId?: string }> {
  const token = await getCalendarTokens(tenantId);
  if (!token?.access_token) {
    return { connected: false };
  }

  return {
    connected: true,
    calendarName: token.calendar_name || undefined,
    calendarId: token.calendar_id || undefined,
  };
}

export async function createBookingEvent(
  tenantId: string,
  lead: { full_name: string | null; phone: string | null },
  dateIso: string,
  timeIso: string,
  service: string
): Promise<{ eventId: string; htmlLink: string }> {
  const token = await getCalendarTokens(tenantId);
  if (!token?.access_token || !token.calendar_id) {
    throw new Error("Calendar not configured");
  }

  try {
    await refreshTokenIfNeeded(tenantId);
    const updatedToken = await getCalendarTokens(tenantId);
    if (!updatedToken?.access_token) throw new Error("Calendar token expired");

    const oauth2Client = new OAuth2Client({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
    });

    oauth2Client.setCredentials({
      access_token: updatedToken.access_token,
    });

    const calendarApi = google.calendar("v3") as any;

    // Parse ISO date and time to create start/end times
    const startDateTime = new Date(`${dateIso}T${timeIso}`);
    const endDateTime = new Date(startDateTime.getTime() + 60 * 60000); // 1 hour later

    const event = await calendarApi.events.insert({
      auth: oauth2Client,
      calendarId: updatedToken.calendar_id || "primary",
      requestBody: {
        summary: `${service} - ${lead.full_name || "Lead"}`,
        description: `Phone: ${lead.phone || "N/A"}`,
        start: { dateTime: startDateTime.toISOString() },
        end: { dateTime: endDateTime.toISOString() },
      },
    });

    return {
      eventId: event.data.id || "",
      htmlLink: event.data.htmlLink || "",
    };
  } catch (err: any) {
    console.error("[calendar] createBookingEvent error:", err);
    throw err;
  }
}

export async function getBlockedDatesList(tenantId: string): Promise<
  Array<{ date: string; reason: string | null }>
> {
  return getBlockedDates(tenantId);
}

export async function addBlockedDateToCalendar(
  tenantId: string,
  date: string,
  reason?: string
): Promise<void> {
  await addBlockedDate(tenantId, date, reason);
}

export async function removeBlockedDateFromCalendar(tenantId: string, date: string | string[]): Promise<void> {
  const dateStr = Array.isArray(date) ? date[0] : date;
  await removeBlockedDate(tenantId, dateStr);
}

export async function getAvailability(
  tenantId: string,
  daysAhead = 14
): Promise<Array<{ date: string; status: "available" | "blocked" | "busy" }>> {
  return getAvailableDays(tenantId, daysAhead);
}
