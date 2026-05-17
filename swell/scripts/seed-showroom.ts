/**
 * Seed Showroom Auto Styles tenant into Swell database
 * Run: npx ts-node scripts/seed-showroom.ts
 */

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL env var required");
}

const sql = postgres(DATABASE_URL, {
  ssl: { rejectUnauthorized: false },
});

async function seedShowroom() {
  try {
    console.log("[seed] Starting Showroom tenant setup...");

    // 1. Insert Showroom tenant
    const tenantId = "showroom";
    const existingTenant = await sql`
      SELECT id FROM swell_tenants WHERE id = ${tenantId};
    `;

    if (existingTenant.length > 0) {
      console.log("[seed] Showroom tenant already exists, skipping creation");
    } else {
      await sql`
        INSERT INTO swell_tenants (
          id,
          name,
          slug,
          brand_color,
          contact_phone,
          twilio_from,
          password_hash,
          enabled
        ) VALUES (
          ${tenantId},
          'Showroom Auto Styles',
          'showroom',
          '#d4a574',
          '+19844597452',
          '+19844597452',
          crypt('nopressure', gen_salt('bf')),
          true
        );
      `;
      console.log("[seed] ✅ Tenant created");
    }

    // 2. Configure Hayden as AI persona (receptionist mode)
    const aiConfigExists = await sql`
      SELECT tenant_id FROM swell_ai_configs WHERE tenant_id = ${tenantId};
    `;

    if (aiConfigExists.length > 0) {
      console.log("[seed] Showroom AI config already exists, skipping");
    } else {
      await sql`
        INSERT INTO swell_ai_configs (
          tenant_id,
          enabled,
          model_primary,
          model_classifier,
          persona_name,
          business_name,
          services_json,
          pricing_matrix,
          route_cities_json,
          transport_waive,
          review_discount,
          custom_brand_notes
        ) VALUES (
          ${tenantId},
          true,
          'claude-sonnet-4-6',
          'claude-haiku-4-5',
          'Hayden',
          'Showroom Auto Styles',
          '["Auto Detailing", "Paint Protection", "Interior Cleaning"]'::jsonb,
          '{}'::jsonb,
          '["Atlanta", "Marietta", "Douglasville"]'::jsonb,
          0,
          0,
          'Receptionist mode only: confirm vehicle info from form, NO pricing, NO booking confirmations. Hand off to Eduardo/Juan immediately.'
        );
      `;
      console.log("[seed] ✅ AI config created (receptionist mode)");
    }

    console.log("[seed] ✅ Showroom tenant fully configured");
    console.log("[seed] Ready for Discord routing and Facebook webhook setup");

    await sql.end();
  } catch (err) {
    console.error("[seed] Error:", err);
    process.exit(1);
  }
}

seedShowroom();
