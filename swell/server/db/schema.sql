-- Swell PostgreSQL Schema (Supabase)
-- All table names prefixed with 'swell_'

-- ─── Tenants ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS swell_tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  brand_color TEXT NOT NULL DEFAULT '#fbbf24',
  accent_color TEXT NOT NULL DEFAULT '#fde68a',
  logo_url TEXT,
  contact_phone TEXT,
  twilio_from TEXT,
  fb_form_ids TEXT[] DEFAULT '{}',
  fb_page_ids TEXT[] DEFAULT '{}',
  fb_page_token TEXT,
  password_hash TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_swell_tenants_slug ON swell_tenants(slug);
CREATE INDEX IF NOT EXISTS idx_swell_tenants_enabled ON swell_tenants(enabled);

-- ─── Leads ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS swell_leads (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES swell_tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  meta_lead_id TEXT UNIQUE NOT NULL,
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
  raw_payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT,
  sms_alert_sent BOOLEAN NOT NULL DEFAULT FALSE,
  sms_alert_sent_at TIMESTAMPTZ,
  discord_thread_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_swell_leads_tenant_created ON swell_leads(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swell_leads_tenant_status ON swell_leads(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_swell_leads_meta_id ON swell_leads(meta_lead_id);

-- ─── Lead Activity ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS swell_lead_activity (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES swell_leads(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL,
  direction TEXT,
  body TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_swell_activity_lead_created ON swell_lead_activity(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_swell_activity_tenant_created ON swell_lead_activity(tenant_id, created_at DESC);

-- ─── AI Configs ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS swell_ai_configs (
  tenant_id TEXT PRIMARY KEY REFERENCES swell_tenants(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  model_primary TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  model_classifier TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
  persona_name TEXT NOT NULL DEFAULT 'Hayden',
  business_name TEXT,
  services_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  pricing_matrix JSONB NOT NULL DEFAULT '{}'::JSONB,
  route_cities_json JSONB NOT NULL DEFAULT '[]'::JSONB,
  transport_waive INTEGER NOT NULL DEFAULT 50,
  review_discount INTEGER NOT NULL DEFAULT 20,
  business_hours_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  max_msgs_per_lead INTEGER NOT NULL DEFAULT 30,
  max_tokens_per_msg INTEGER NOT NULL DEFAULT 700,
  custom_brand_notes TEXT,
  pricing_locked BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Conversations ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS swell_conversations (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  lead_id BIGINT UNIQUE NOT NULL REFERENCES swell_leads(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  handoff_reason TEXT,
  last_message_at TIMESTAMPTZ,
  last_role TEXT,
  total_messages INTEGER NOT NULL DEFAULT 0,
  total_tokens_in INTEGER NOT NULL DEFAULT 0,
  total_tokens_out INTEGER NOT NULL DEFAULT 0,
  total_cost_cents INTEGER NOT NULL DEFAULT 0,
  quoted_price_cents INTEGER,
  discount_applied BOOLEAN NOT NULL DEFAULT FALSE,
  discord_thread_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_swell_conversations_tenant_status ON swell_conversations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_swell_conversations_lead_id ON swell_conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_swell_conversations_last_msg ON swell_conversations(last_message_at DESC NULLS LAST);

-- ─── Conversation Messages ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS swell_conversation_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES swell_conversations(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  twilio_sid TEXT,
  model_used TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost_cents INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_swell_convmsg_conv_created ON swell_conversation_messages(conversation_id, created_at);

-- ─── Nurture Jobs ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS swell_nurture_jobs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  lead_id BIGINT NOT NULL REFERENCES swell_leads(id) ON DELETE CASCADE,
  conversation_id BIGINT REFERENCES swell_conversations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  fire_at TIMESTAMPTZ NOT NULL,
  fired_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'scheduled',
  payload JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_swell_nurture_fire_status ON swell_nurture_jobs(fire_at, status);
CREATE INDEX IF NOT EXISTS idx_swell_nurture_lead ON swell_nurture_jobs(lead_id);
CREATE INDEX IF NOT EXISTS idx_swell_nurture_tenant_status ON swell_nurture_jobs(tenant_id, status);

-- ─── DNC Phones ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS swell_dnc_phones (
  tenant_id TEXT NOT NULL REFERENCES swell_tenants(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_swell_dnc_tenant ON swell_dnc_phones(tenant_id);

-- ─── Calendar Tokens ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS swell_calendar_tokens (
  tenant_id TEXT PRIMARY KEY REFERENCES swell_tenants(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMPTZ NOT NULL,
  calendar_id TEXT,
  calendar_name TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ─── Blocked Dates ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS swell_blocked_dates (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES swell_tenants(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, date)
);

CREATE INDEX IF NOT EXISTS idx_swell_blocked_dates_tenant_date ON swell_blocked_dates(tenant_id, date);

-- ─── Schedule Configuration ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS swell_schedule_configs (
  tenant_id         TEXT PRIMARY KEY REFERENCES swell_tenants(id) ON DELETE CASCADE,
  timezone          TEXT NOT NULL DEFAULT 'America/New_York',
  work_days         INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5,6}', -- 0=Sun..6=Sat
  work_start        TEXT NOT NULL DEFAULT '08:00',  -- HH:MM
  work_end          TEXT NOT NULL DEFAULT '18:00',
  max_jobs_per_day  INTEGER NOT NULL DEFAULT 3,
  avg_job_hours     REAL NOT NULL DEFAULT 2.0,
  buffer_mins       INTEGER NOT NULL DEFAULT 30,
  service_cities    TEXT[] NOT NULL DEFAULT '{}',   -- for weather geocoding; uses ai_config route_cities if empty
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Appointments ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS swell_appointments (
  id                SERIAL PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES swell_tenants(id) ON DELETE CASCADE,
  lead_id           BIGINT NOT NULL REFERENCES swell_leads(id) ON DELETE CASCADE,
  conversation_id   BIGINT REFERENCES swell_conversations(id),
  status            TEXT NOT NULL DEFAULT 'pending', -- pending|confirmed|completed|no_show|cancelled
  scheduled_date    DATE NOT NULL,
  scheduled_time    TEXT,          -- HH:MM or NULL if TBD
  duration_hours    REAL DEFAULT 2.0,
  service_summary   TEXT,
  quoted_price_cents INTEGER,
  preferred_day     TEXT,          -- raw text from lead ("Tuesday", "morning", etc.)
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appt_tenant_date ON swell_appointments(tenant_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_appt_lead ON swell_appointments(lead_id);

-- ─── Crews ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS swell_crews (
  id                SERIAL PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES swell_tenants(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  max_jobs_per_day  INTEGER NOT NULL DEFAULT 3,
  avg_job_hours     REAL NOT NULL DEFAULT 2.0,
  service_keys      TEXT[] NOT NULL DEFAULT '{}',  -- comma-separated service keys
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_swell_crews_tenant_active ON swell_crews(tenant_id, active);

-- ─── Phase 2: Review & Reputation Engine ────────────────────────────────────

-- Extend tenants with owner info + review/EOD settings
ALTER TABLE swell_tenants ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE swell_tenants ADD COLUMN IF NOT EXISTS owner_phone TEXT;
ALTER TABLE swell_tenants ADD COLUMN IF NOT EXISTS owner_phone_verified BOOLEAN DEFAULT false;
ALTER TABLE swell_tenants ADD COLUMN IF NOT EXISTS owner_phone_pending TEXT;
ALTER TABLE swell_tenants ADD COLUMN IF NOT EXISTS google_review_url TEXT;
ALTER TABLE swell_tenants ADD COLUMN IF NOT EXISTS eod_offset_hours REAL DEFAULT 1.0;

-- Extend leads with scoring
ALTER TABLE swell_leads ADD COLUMN IF NOT EXISTS lead_score INTEGER DEFAULT 50;
ALTER TABLE swell_leads ADD COLUMN IF NOT EXISTS satisfaction_score INTEGER;
ALTER TABLE swell_leads ADD COLUMN IF NOT EXISTS repeat_probability TEXT DEFAULT 'warm';

-- Phone verification codes (expires in 10 min)
CREATE TABLE IF NOT EXISTS swell_phone_verifications (
  id          SERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  phone       TEXT NOT NULL,
  code        TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- End-of-day owner check tracking
CREATE TABLE IF NOT EXISTS swell_eod_checks (
  id            SERIAL PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  check_date    DATE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'sent',
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at  TIMESTAMPTZ,
  raw_response  TEXT,
  processed_at  TIMESTAMPTZ,
  UNIQUE(tenant_id, check_date)
);

-- Post-service review follow-ups
CREATE TABLE IF NOT EXISTS swell_review_follows (
  id                    SERIAL PRIMARY KEY,
  tenant_id             TEXT NOT NULL,
  lead_id               INTEGER NOT NULL,
  appointment_id        INTEGER NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending',
  follow_up_phone       TEXT,
  sent_at               TIMESTAMPTZ,
  replied_at            TIMESTAMPTZ,
  reply_text            TEXT,
  sentiment_score       INTEGER,
  sentiment_confidence  REAL,
  route_taken           TEXT,
  review_link_sent_at   TIMESTAMPTZ,
  feedback_link_sent_at TIMESTAMPTZ,
  feedback_token        TEXT UNIQUE DEFAULT gen_random_uuid()::text,
  nudge_sent_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_follows_tenant ON swell_review_follows(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_review_follows_lead ON swell_review_follows(lead_id);
CREATE INDEX IF NOT EXISTS idx_review_follows_token ON swell_review_follows(feedback_token);

-- Internal feedback form submissions
CREATE TABLE IF NOT EXISTS swell_feedback_submissions (
  id               SERIAL PRIMARY KEY,
  review_follow_id INTEGER NOT NULL REFERENCES swell_review_follows(id),
  tenant_id        TEXT NOT NULL,
  lead_id          INTEGER,
  rating           INTEGER,
  comment          TEXT,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AI self-improvement: add learned_notes field to track insights from successful conversations
ALTER TABLE swell_ai_configs ADD COLUMN IF NOT EXISTS learned_notes TEXT;
ALTER TABLE swell_ai_configs ADD COLUMN IF NOT EXISTS service_area_hubs_json JSONB DEFAULT '[]'::JSONB;
ALTER TABLE swell_leads ADD COLUMN IF NOT EXISTS in_service_area BOOLEAN;

-- ─── VAPI Voice Calls ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS swell_calls (
  id                SERIAL PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES swell_tenants(id) ON DELETE CASCADE,
  lead_id           BIGINT REFERENCES swell_leads(id) ON DELETE CASCADE,
  vapi_call_id      TEXT UNIQUE,
  direction         TEXT NOT NULL DEFAULT 'inbound',
  status            TEXT NOT NULL DEFAULT 'queued',
  from_phone        TEXT,
  to_phone          TEXT,
  duration_seconds  INTEGER,
  cost_cents        INTEGER,
  transcript        TEXT,
  recording_url     TEXT,
  summary           TEXT,
  ended_reason      TEXT,
  started_at        TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calls_tenant ON swell_calls(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_lead ON swell_calls(lead_id);
CREATE INDEX IF NOT EXISTS idx_calls_vapi_id ON swell_calls(vapi_call_id);

-- Add VAPI assistant ID per tenant
ALTER TABLE swell_tenants ADD COLUMN IF NOT EXISTS vapi_assistant_id TEXT;

-- ─── Users (Team Members) ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS swell_users (
  id            SERIAL PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES swell_tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'rep',
  enabled       BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_swell_users_tenant ON swell_users(tenant_id);

-- ─── Unified Customer Profile ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS swell_customers (
  id                    SERIAL PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES swell_tenants(id) ON DELETE CASCADE,
  full_name             TEXT,
  phone                 TEXT,
  email                 TEXT,
  address               TEXT,
  city                  TEXT,
  state                 TEXT,
  zip                   TEXT,
  tags                  TEXT[] NOT NULL DEFAULT '{}',
  notes                 TEXT,
  lead_score            INTEGER DEFAULT 50,
  lifetime_value_cents  INTEGER DEFAULT 0,
  job_count             INTEGER DEFAULT 0,
  last_job_at           TIMESTAMPTZ,
  source                TEXT,
  repeat_probability    TEXT DEFAULT 'warm',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant ON swell_customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON swell_customers(tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_customers_email ON swell_customers(tenant_id, email);

-- Link leads to customers
ALTER TABLE swell_leads ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES swell_customers(id);
CREATE INDEX IF NOT EXISTS idx_leads_customer ON swell_leads(customer_id);

-- Link calls to customers
ALTER TABLE swell_calls ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES swell_customers(id);
CREATE INDEX IF NOT EXISTS idx_calls_customer ON swell_calls(customer_id);

-- ─── Service Map Geocoding ──────────────────────────────────────────────────

-- Add geocoding columns to customers
ALTER TABLE swell_customers ADD COLUMN IF NOT EXISTS address_lat DOUBLE PRECISION;
ALTER TABLE swell_customers ADD COLUMN IF NOT EXISTS address_lon DOUBLE PRECISION;
ALTER TABLE swell_customers ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_customers_geocoded ON swell_customers(tenant_id, geocoded_at);

-- Add geocoding columns to leads
ALTER TABLE swell_leads ADD COLUMN IF NOT EXISTS address_lat DOUBLE PRECISION;
ALTER TABLE swell_leads ADD COLUMN IF NOT EXISTS address_lon DOUBLE PRECISION;
ALTER TABLE swell_leads ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_geocoded ON swell_leads(tenant_id, geocoded_at);

-- ─── Property fields for quoting & lead scoring ─────────────────────────────
ALTER TABLE swell_leads ADD COLUMN IF NOT EXISTS home_sqft INTEGER;
ALTER TABLE swell_leads ADD COLUMN IF NOT EXISTS window_count INTEGER;
ALTER TABLE swell_customers ADD COLUMN IF NOT EXISTS home_sqft INTEGER;
ALTER TABLE swell_customers ADD COLUMN IF NOT EXISTS window_count INTEGER;

-- ─── A/B Variants for message testing ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS swell_ab_variants (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES swell_tenants(id) ON DELETE CASCADE,
  lead_id BIGINT NOT NULL REFERENCES swell_leads(id) ON DELETE CASCADE,
  conversation_id BIGINT REFERENCES swell_conversations(id) ON DELETE CASCADE,
  variant_group TEXT NOT NULL,   -- e.g. 'nurture_sequence', 'opening_msg'
  variant TEXT NOT NULL,          -- 'A', 'B', 'C'
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  outcome TEXT,                   -- 'replied', 'booked', 'closed', 'lost', null
  outcome_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_swell_ab_variants_tenant ON swell_ab_variants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_swell_ab_variants_lead ON swell_ab_variants(lead_id);
CREATE INDEX IF NOT EXISTS idx_swell_ab_variants_group ON swell_ab_variants(variant_group, variant);
