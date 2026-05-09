import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dbPath = process.env.DATABASE_PATH || "./data/harris-bros-leads.db";
const absolutePath = path.resolve(process.cwd(), dbPath);
fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

export const db = new Database(absolutePath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    meta_lead_id TEXT NOT NULL UNIQUE,
    meta_page_id TEXT,
    meta_form_id TEXT,
    meta_campaign_id TEXT,
    meta_adset_id TEXT,
    meta_ad_id TEXT,
    full_name TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,
    raw_payload TEXT NOT NULL,
    sms_alert_sent INTEGER NOT NULL DEFAULT 0,
    sms_alert_sent_at TEXT
  );
`);
