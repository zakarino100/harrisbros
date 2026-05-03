/**
 * Seed initial tenants from env vars on first boot.
 *
 * Idempotent: only inserts a tenant if no row with that id exists.
 * Updates from env: dashboard password (re-hashed), phone, FB form/page IDs.
 *
 * Pattern: each tenant config lives in env vars prefixed by tenant id, e.g.:
 *
 *   HARRIS_BROS_NAME=Harris Brothers
 *   HARRIS_BROS_SLUG=harrisbrosads
 *   HARRIS_BROS_PASSWORD=<plain — gets bcrypt-hashed>
 *   HARRIS_BROS_CONTACT_PHONE=+1...
 *   HARRIS_BROS_TWILIO_FROM=+1...
 *   HARRIS_BROS_FB_FORM_IDS=12345,67890
 *   HARRIS_BROS_FB_PAGE_IDS=...
 *   HARRIS_BROS_FB_PAGE_TOKEN=...
 *
 *   MACKWASH_NAME=Mack Wash
 *   MACKWASH_SLUG=mackwash
 *   MACKWASH_PASSWORD=...
 *   etc.
 *
 * Tenant id list is env-driven via SWELL_TENANTS (comma-separated keys).
 * Example: SWELL_TENANTS=HARRIS_BROS,MACKWASH
 */
import bcrypt from "bcryptjs";
import { sql } from "./db/index.js";
import { upsertTenant, getTenantById, getAIConfig, upsertAIConfig } from "./db/queries.js";
import { defaultAIConfigForTenant } from "./seed-ai.js";

interface SeedConfig {
  id: string;             // canonical tenant id (lowercase)
  envPrefix: string;      // env var prefix (uppercase)
}

function parseTenantIds(): SeedConfig[] {
  const raw = process.env.SWELL_TENANTS || "HARRIS_BROS,MACKWASH";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((envPrefix) => ({
      envPrefix,
      id: envPrefix.toLowerCase(),
    }));
}

function envFor(prefix: string, key: string): string | undefined {
  return process.env[`${prefix}_${key}`];
}

function csvList(value: string | undefined): string[] | null {
  if (!value) return null;
  const arr = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? arr : null;
}

export async function runSeed() {
  const configs = parseTenantIds();

  for (const cfg of configs) {
    const { id, envPrefix } = cfg;
    const name = envFor(envPrefix, "NAME");
    const slug = envFor(envPrefix, "SLUG");
    const password = envFor(envPrefix, "PASSWORD");

    const existing = await getTenantById(id);

    // First-boot seed requires NAME, SLUG, PASSWORD. Subsequent boots
    // can update fields without re-supplying password.
    if (!existing) {
      if (!name || !slug || !password) {
        console.warn(
          `[seed] Tenant '${id}' missing required env vars (${envPrefix}_NAME / _SLUG / _PASSWORD) — skipping`
        );
        continue;
      }
      const password_hash = await bcrypt.hash(password, 10);
      await upsertTenant({
        id,
        name,
        slug,
        password_hash,
        brand_color: envFor(envPrefix, "BRAND_COLOR") || "#fbbf24",
        accent_color: envFor(envPrefix, "ACCENT_COLOR") || "#fde68a",
        logo_url: envFor(envPrefix, "LOGO_URL") || null,
        contact_phone: envFor(envPrefix, "CONTACT_PHONE") || null,
        twilio_from: envFor(envPrefix, "TWILIO_FROM") || null,
        fb_form_ids: csvList(envFor(envPrefix, "FB_FORM_IDS")),
        fb_page_ids: csvList(envFor(envPrefix, "FB_PAGE_IDS")),
        fb_page_token: envFor(envPrefix, "FB_PAGE_TOKEN") || null,
        enabled: true,
      });
      console.log(`[seed] Created tenant '${id}' (${name} @ ${slug})`);
      continue;
    }

    // Existing tenant — refresh non-secret fields from env (idempotent).
    const password_hash = password
      ? await bcrypt.hash(password, 10)
      : existing.password_hash;

    await upsertTenant({
      id: existing.id,
      name: name || existing.name,
      slug: slug || existing.slug,
      password_hash,
      brand_color: envFor(envPrefix, "BRAND_COLOR") || existing.brand_color,
      accent_color: envFor(envPrefix, "ACCENT_COLOR") || existing.accent_color,
      logo_url: envFor(envPrefix, "LOGO_URL") ?? existing.logo_url,
      contact_phone: envFor(envPrefix, "CONTACT_PHONE") ?? existing.contact_phone,
      twilio_from: envFor(envPrefix, "TWILIO_FROM") ?? existing.twilio_from,
      fb_form_ids: csvList(envFor(envPrefix, "FB_FORM_IDS")) ?? existing.fb_form_ids,
      fb_page_ids: csvList(envFor(envPrefix, "FB_PAGE_IDS")) ?? existing.fb_page_ids,
      fb_page_token: envFor(envPrefix, "FB_PAGE_TOKEN") ?? existing.fb_page_token,
      enabled: existing.enabled,
    });
    console.log(`[seed] Refreshed tenant '${id}'`);
  }

  // Seed AI configs.
  // Strategy:
  //   1. If no config exists → insert the full starter (services, pricing, routes, etc.)
  //   2. If a config exists BUT services_json is empty → it was seeded blank on a previous
  //      boot before the starter data was ready. Backfill it with the starter now so the
  //      AI can quote without operator intervention.
  //   3. If a config exists AND has services → leave it alone (operator may have customised).
  for (const cfg of configs) {
    const tenantRow = await getTenantById(cfg.id);
    if (!tenantRow) continue;

    const existing = await getAIConfig(cfg.id);
    const starter = defaultAIConfigForTenant(cfg.id);

    // Case 3: config is fine — skip.
    const hasServices = existing && Array.isArray((existing as any).services_json) && (existing as any).services_json.length > 0;
    if (hasServices) {
      // Still refresh business_hours, route_cities, and brand notes from seed if the tenant
      // has a known starter — they aren't operator-facing editable fields yet.
      continue;
    }

    if (starter) {
      // Case 1 or 2: insert or backfill with the full starter.
      await upsertAIConfig({
        tenant_id: cfg.id,
        enabled: existing?.enabled ?? (starter.enabled === 1),
        model_primary: starter.model_primary,
        model_classifier: starter.model_classifier,
        persona_name: starter.persona_name,
        business_name: starter.business_name,
        services_json: JSON.parse(starter.services_json),
        pricing_matrix: JSON.parse(starter.pricing_matrix),
        route_cities_json: JSON.parse(starter.route_cities_json),
        transport_waive: starter.transport_waive,
        review_discount: starter.review_discount,
        business_hours_json: JSON.parse(starter.business_hours_json),
        max_msgs_per_lead: starter.max_msgs_per_lead,
        max_tokens_per_msg: starter.max_tokens_per_msg,
        custom_brand_notes: starter.custom_brand_notes,
        pricing_locked: starter.pricing_locked === 1,
      });
      console.log(`[seed] ${existing ? "Backfilled" : "Seeded"} AI config for '${cfg.id}' (${JSON.parse(starter.services_json).length} services)`);
    } else {
      // Unknown tenant id with no default — seed a safe blank config.
      // pricing_locked=false means Hayden will hand off any quote request to a human.
      if (!existing) {
        await upsertAIConfig({
          tenant_id: cfg.id,
          enabled: true,
          persona_name: "Hayden",
          services_json: [],
          pricing_matrix: {},
          route_cities_json: [],
          pricing_locked: false,
        });
        console.log(`[seed] Seeded blank AI config for '${cfg.id}' (no starter defined — pricing not configured)`);
      }
    }
  }

  // Sanity log
  const rows = await sql<{ id: string; name: string; slug: string; enabled: boolean }[]>`
    SELECT id, name, slug, enabled FROM swell_tenants
  `;
  console.log(`[seed] Active tenants:`, rows);
}
