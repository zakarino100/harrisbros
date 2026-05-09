/**
 * PostgreSQL (Supabase) database connection
 * Schema applied on startup — all idempotent.
 */
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL env var is required");
}

export const sql = postgres(databaseUrl, {
  ssl: { rejectUnauthorized: false },
  max: 3,
  idle_timeout: 20,
  max_lifetime: 60 * 10,
  connect_timeout: 15,
});

// ─── Apply schema on startup ────────────────────────────────────────────────────

async function applySchema() {
  try {
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const schemaPath = path.join(__dirname, "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf-8");
    
    // Split by semicolons and execute each statement
    const statements = schema
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    
    for (const stmt of statements) {
      await sql.unsafe(stmt);
    }
    console.log("[db] Schema applied successfully");
  } catch (error) {
    console.error("[db] Schema application failed (non-fatal):", (error as Error).message);
    // Non-fatal — tables may already exist from a previous run
  }
}

// Apply schema on startup
await applySchema();
