const GRAPH_BASE = "https://graph.facebook.com/v25.0";

export function parseFieldData(fieldData: Array<{ name: string; values?: string[] }>) {
  const raw: Record<string, string> = {};
  for (const field of fieldData || []) {
    raw[field.name] = field.values?.[0] ?? "";
  }

  return {
    fullName: raw.full_name || raw.name || [raw.first_name, raw.last_name].filter(Boolean).join(" ") || null,
    phone: raw.phone_number || raw.phone || null,
    email: raw.email || null,
    address: raw.street_address || raw.address || null,
    city: raw.city || null,
    state: raw.state || null,
    zip: raw.zip_code || raw.postal_code || raw.zip || null,
  };
}

export async function fetchGraphLead(leadgenId: string) {
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error("FACEBOOK_PAGE_ACCESS_TOKEN is not configured");

  const fields = [
    "id",
    "created_time",
    "field_data",
    "form_id",
    "ad_id",
    "adset_id",
    "campaign_id"
  ].join(",");

  const url = `${GRAPH_BASE}/${leadgenId}?fields=${fields}&access_token=${token}`;
  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Graph API ${response.status}: ${text}`);
  }

  return response.json();
}
