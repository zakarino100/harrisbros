/**
 * Facebook Graph API client.
 * Token comes from the tenant's stored fb_page_token (per-client),
 * with a fallback to FACEBOOK_PAGE_ACCESS_TOKEN env var (legacy / shared).
 */
const GRAPH_BASE = "https://graph.facebook.com/v25.0";

export function parseFieldData(fieldData: Array<{ name: string; values?: string[] }>) {
  const raw: Record<string, string> = {};
  for (const field of fieldData || []) {
    raw[field.name] = field.values?.[0] ?? "";
  }
  return {
    fullName:
      raw.full_name ||
      raw.name ||
      [raw.first_name, raw.last_name].filter(Boolean).join(" ") ||
      null,
    phone: raw.phone_number || raw.phone || null,
    email: raw.email || null,
    address: raw.street_address || raw.address || null,
    city: raw.city || raw.town || null,
    state: raw.state || raw.region || raw.province || null,
    zip: raw.zip_code || raw.postal_code || raw.zip || null,
    timeline:
      raw["when are you looking to get this done?"] ||
      raw["when_are_you_looking_to_get_this_done?"] ||
      raw.timeline || null,
    squareFootage:
      raw["approximate_home_size?"] ||
      raw["approximate_home_size"] ||
      raw["what's the approximate square footage of your home?"] ||
      raw["what's_the_approximate_square_footage_of_your_home?"] ||
      raw.square_footage || null,
    homeowner:
      raw["do you own your home?"] ||
      raw["do_you_own_your_home?"] || null,
  };
}

export async function fetchGraphLead(leadgenId: string, tenantToken?: string | null) {
  const token = tenantToken || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error("Facebook page access token is not configured");

  const fields = [
    "id",
    "created_time",
    "field_data",
    "form_id",
    "ad_id",
    "adset_id",
    "campaign_id",
    "page_id",
  ].join(",");

  const url = `${GRAPH_BASE}/${leadgenId}?fields=${fields}&access_token=${token}`;
  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Graph API ${response.status}: ${text}`);
  }
  return response.json();
}
