# BUILD BRIEF — WPW Reactivation Campaign System

## Context
You are building the full reactivation campaign system for **Wolf Pack Wash** inside the existing Healthy Home backend CRM. All work happens inside `/Users/zak/.openclaw/workspace/hh-backend-fresh`. This is a Replit-deployed Express + React monorepo (pnpm workspaces). Schema is Drizzle ORM on Supabase Postgres.

The user (Zak) has reviewed and approved this exact spec. Do not improvise scope changes. If you hit something genuinely unclear or risky, stop and surface it instead of guessing.

## Connection & secrets
**Supabase connection string** (use ONLY for running the migration SQL via psql, not for committed code):
```
postgresql://postgres:Eaglesfan1998!@db.hclpovktywijfnswthpm.supabase.co:5432/postgres
```
- Apply migrations directly with `psql` against this URL.
- Do NOT use `drizzle-kit push` — the existing `replit.md` warns it can break shared tables. Run SQL directly.
- Do NOT commit the connection string to any file.

## Critical safety constraints (read `hh-backend-fresh/replit.md` first)
- This Supabase project is shared with the Wolfpack D2D app. **Never** alter, drop, or write to: `leads` (read + hh_filter-only), `pins`, `d2d_touches`, `d2d_quotes`, `d2d_media`, `d2d_services`, `crm_activity`, `call_logs`, `conversations`, `automation_rules`, `message_*`, `nurture_*`, `voice_settings`.
- All new tables must be `hh_*` prefixed.
- All `hh_*` tables use TEXT for status/enum columns (not pgEnum).
- All HH tables get `sync_source` and `updated_by` columns.

## Deliverables

### A) Database migration (run via psql)
Create new file: `hh-backend-fresh/scripts/migrations/2026-04-28-reactivation-system.sql`. Inside it:

1. **`hh_dnc`** (DNC table):
   - `id` SERIAL PRIMARY KEY
   - `phone` TEXT (E.164, UNIQUE NULLS DISTINCT)
   - `email` TEXT (lowercased, UNIQUE NULLS DISTINCT)
   - `name` TEXT (lowercased, for name-only DNC entries)
   - `reason` TEXT NOT NULL — manual | sms_stop | email_unsubscribe | spam_complaint | deceased | wrong_number | legal | opted_out
   - `notes` TEXT
   - `added_by` TEXT
   - `created_at` TIMESTAMPTZ DEFAULT NOW() NOT NULL
   - Indexes on phone, email, name

2. **`hh_campaigns`** (verify exists; if missing create per `lib/db/src/schema/campaigns.ts` SQL header). Then ALTER TABLE to add:
   - `from_address` TEXT (replaces hardcoded fromEmail default)
   - `from_display_name` TEXT
   - `from_avatar_url` TEXT
   - `batch_size` INTEGER DEFAULT 10
   - `batch_interval_minutes` INTEGER DEFAULT 60
   - `daily_limit` INTEGER DEFAULT 100
   - `send_window_start` TEXT DEFAULT '09:00' — HH:MM local
   - `send_window_end` TEXT DEFAULT '18:00'
   - `send_window_days` INTEGER[] DEFAULT ARRAY[1,2,3,4,5,6] — 0=Sun..6=Sat
   - `send_timezone` TEXT DEFAULT 'America/New_York'
   - `sequence_id` INTEGER — FK to hh_campaign_sequences (nullable; null means single send)
   - `sequence_step_index` INTEGER DEFAULT 0
   - `parent_campaign_id` INTEGER — FK self for sequence chaining
   - `template_id` INTEGER — FK to hh_campaign_templates (nullable)
   - `total_failed` INTEGER DEFAULT 0
   - `total_unsubscribed` INTEGER DEFAULT 0

3. **`hh_campaign_sends`** (verify exists; if missing create per schema). Then ALTER TABLE to add:
   - `last_event_at` TIMESTAMPTZ — most recent event timestamp
   - `bounced_at` TIMESTAMPTZ
   - `unsubscribed_at` TIMESTAMPTZ
   - Indexes on (campaign_id, status), (lead_id), (customer_id), (to_address)

4. **`hh_campaign_templates`** (saved templates, with the 5 Luna defaults seeded):
   - `id` SERIAL PRIMARY KEY
   - `name` TEXT NOT NULL
   - `type` TEXT NOT NULL CHECK (type IN ('email','sms'))
   - `subject` TEXT
   - `body` TEXT NOT NULL
   - `from_display_name` TEXT
   - `from_address` TEXT
   - `tags` TEXT[] DEFAULT ARRAY[]::TEXT[]
   - `created_by` TEXT
   - `created_at`, `updated_at` TIMESTAMPTZ
   - Seed with 5 templates from `WPW-reactivation-templates-FINAL.md`:
     - "Luna · Reactivation SMS 1 (soft opener)"
     - "Luna · Reactivation Email 1 (value stack)"
     - "Luna · Reactivation SMS 2 (scarcity)"
     - "Luna · Reactivation Email 2 (social proof)"
     - "Luna · Reactivation SMS 3 (last call)"
   - Tag all 5 with `['wpw', 'reactivation', 'luna']`

5. **`hh_campaign_sequences`** (drip sequence definition):
   - `id` SERIAL PRIMARY KEY
   - `name` TEXT NOT NULL
   - `description` TEXT
   - `steps` JSONB NOT NULL DEFAULT '[]' — array of `{ stepIndex, type, templateId, delayDays, sendAtTime }`
   - `tags` TEXT[]
   - `created_by` TEXT
   - `created_at`, `updated_at` TIMESTAMPTZ
   - Seed with one sequence: "WPW Pollen-Season Reactivation 2026" pointing to the 5 template IDs in order.

6. **`hh_campaign_replies`** (incoming reply log):
   - `id` BIGSERIAL PRIMARY KEY
   - `campaign_id` INTEGER (FK hh_campaigns, ON DELETE SET NULL)
   - `send_id` BIGINT (FK hh_campaign_sends, ON DELETE SET NULL)
   - `lead_id` UUID
   - `customer_id` INTEGER
   - `from_address` TEXT NOT NULL
   - `channel` TEXT NOT NULL CHECK (channel IN ('sms','email'))
   - `body` TEXT NOT NULL
   - `subject` TEXT
   - `classification` TEXT — opt_out | simple_question | human_handoff | unclassified
   - `classification_reason` TEXT
   - `routed_to_discord` BOOLEAN DEFAULT FALSE
   - `discord_message_id` TEXT
   - `requires_review` BOOLEAN DEFAULT FALSE
   - `reviewed_at` TIMESTAMPTZ
   - `reviewed_by` TEXT
   - `received_at` TIMESTAMPTZ DEFAULT NOW() NOT NULL
   - Indexes on (campaign_id), (classification), (received_at DESC)

7. **DNC seed inserts**: 35 entries from `dnc_master.csv` — 21 with phone (matched), 14 with name only (unmatched seed names). Use the matching results below:

```text
PHONE-MATCHED (21):
Carla abramczyk          +19192448182  carla.abramczyk@gmail.com  seed
Chris pozezana           +12033490425  pozezanac@gmail.com         seed
George Shelton           +19195181100                              seed
Shane Maxwell            +18138425440  Smmaxwell0521@gmail.com     seed
Tom Kinkelaar            +14043146740  Tkinkelaar12@gmail.com      seed
Julie Davenport          +19193766563                              seed
Yong Yang                +19199619794                              sales_low_rating
Tim Perkins              +19195224766                              sales_low_rating
Jose Figueroa            +19199060037                              sales_low_rating
Mitch OFurey             +19197582322                              sales_low_rating
Dan Tamburro             +19192728475                              sales_low_rating
Adam Jackson             +19195183535                              sales_low_rating
Regi Oommen              +19193089985                              sales_low_rating
Cynthia Gigandet         +19192803052                              sales_low_rating
Brian Bewley             +19894939790                              sales_low_rating
Ryan Zepp                +17042220469                              sales_low_rating
Eddie Mack               +17045768344                              sales_low_rating
Grace Grady              +19148441631                              sales_low_rating
Ronald Watt              +19196185346                              sales_low_rating
Pamela Maxey             +19198682625                              sales_low_rating
James Applewhite         +19108358328                              sales_low_rating

NAME-ONLY (14):
Daniel demás, Darren pasdernick, Diane Carraway, Kevin Nelson,
Linda McCarthy, Mark Pirelli, Michael Erheart, Robert Ornitz,
Sean Martin, Alexi Claudio, Shannon Beckstrand, Kate Thomas,
Kimberly Arana, Tara DellaVecchia
```
Reason for all: 'manual'. Notes: '2026-04-28 reactivation safety list — seed' (seed) or '2026-04-28 reactivation safety list — low-rating customer feedback' (sales_low_rating).

### B) Drizzle schema files (`hh-backend-fresh/lib/db/src/schema/`)
- Update `campaigns.ts` with new columns
- Create `dnc.ts` (or update if exists) with new table including `name` field
- Create `campaign-templates.ts`
- Create `campaign-sequences.ts`
- Create `campaign-replies.ts`
- Export all from `index.ts`
- After schema changes: run `pnpm --filter @workspace/db exec tsc -p tsconfig.json` to regenerate `.d.ts`

### C) Backend services (`hh-backend-fresh/artifacts/api-server/src/services/`)
1. **`dnc.ts`** — UPDATE: extend `isContactAllowed` to also check `name` field when caller passes a name argument. Add `addToDnc({name, ...})` support.
2. **`email-validator.ts`** — NEW: regex format check + DNS MX-record check (use Node `dns/promises.resolveMx`). Return `{valid, reason}`.
3. **`campaign-sender.ts`** — NEW: extracted from existing inline send logic in `routes/campaigns.ts`. Functions:
   - `enqueueCampaignSends(campaignId)` — build audience, create send records, mark `sending` or `scheduled`
   - `processSendBatch(campaignId, batchSize)` — process up to N queued sends, respecting send window + daily limit
   - `tickScheduler()` — find campaigns due (scheduled, batch interval elapsed) and process next batch
   - All sends pass through `isContactAllowed` AND `validateEmail` (for emails)
4. **`reply-classifier.ts`** — NEW: classifies reply text → `opt_out | simple_question | human_handoff | unclassified`. Rules:
   - STOP/UNSUBSCRIBE/CANCEL/QUIT/END/STOPALL → opt_out
   - "what's the price for X" / "how much for X" with no extra context → simple_question
   - Anything else (multi-part, mentions add-ons, new property, ambiguous) → human_handoff
5. **`discord-handoff.ts`** — NEW: posts to Discord webhook. Channel `1497708053779316806`. Pings `<@matthew.fytb>` (resolve to user ID via Discord API or hardcode if found in env). Post format:
   ```
   New reactivation reply — {customerName}
   From: {fromAddress} ({channel})
   Reply: "{body}"
   Classification: {classification}
   View in CRM: {dashboardUrl}/campaigns/{campaignId}/sends/{sendId}
   ```
   Discord webhook URL is in env: `DISCORD_WPW_LEADS_WEBHOOK_URL`. If unset, log warning and write to `hh_integration_logs` instead.

### D) Backend routes (`hh-backend-fresh/artifacts/api-server/src/routes/`)
1. **`campaigns.ts`** — UPDATE:
   - Replace inline send loop with `enqueueCampaignSends` + scheduler-driven batches
   - Honor `batch_size`, `batch_interval_minutes`, `daily_limit`, `send_window_start/end/days/timezone`
   - Add `past_customers` segment type to `buildAudience`. Query:
     ```
     SELECT c.id, c.first_name, c.last_name, c.phone, c.email
     FROM hh_customers c
     WHERE EXISTS (SELECT 1 FROM hh_jobs j WHERE j.customer_id = c.id AND j.status = 'completed')
       AND c.opt_out = false
     ```
     Optional filters in segment JSON: `minDaysSinceLastService`, `maxDaysSinceLastService`, `minSatisfactionScore`, `excludeFlaggedIssues`, `cities`, `zipCodes`.
   - Add `GET /api/campaigns/:id/conversation/:sendId` — returns full timeline for one recipient (sends + replies + opens + clicks merged & sorted)
   - Add `POST /api/campaigns/preview` enhancement to render with sample customer data
   - Add `POST /api/campaigns/from-sequence` — creates a chained set of campaigns from a sequence template
2. **`templates.ts`** — NEW: GET/POST/PATCH/DELETE `/api/campaign-templates`
3. **`sequences.ts`** — NEW: GET/POST/PATCH/DELETE `/api/campaign-sequences`
4. **`replies.ts`** — NEW:
   - `POST /api/campaign-replies/sms-webhook` — Twilio inbound SMS handler. On receive: lookup most recent send to that phone, classify, store reply, route to Discord if human_handoff, auto-DNC if opt_out
   - `POST /api/campaign-replies/email-webhook` — Resend inbound webhook handler (same flow)
   - `GET /api/campaign-replies` — list with filters (campaign, classification, requires_review)
   - `PATCH /api/campaign-replies/:id` — mark reviewed, change classification
5. **`dnc.ts`** — UPDATE: list/add/remove endpoints, expose name search

Wire all new routes in `app.ts` or `routes/index.ts`.

### E) Cron / scheduler (`hh-backend-fresh/artifacts/api-server/src/`)
Add a node-cron job that runs every minute:
```ts
cron.schedule('* * * * *', () => tickScheduler().catch(console.error))
```
Place it next to the existing daily-report cron. The scheduler:
- Finds campaigns where status = 'sending' OR (status = 'scheduled' AND scheduledAt <= now)
- For each, checks send window (day of week + hour in campaign's timezone)
- If in window, processes up to `batch_size` queued sends, then sleeps until next batch interval
- Updates `total_sent` / `total_failed` counters
- Marks campaign `sent` when no more queued sends

### F) Frontend (`hh-backend-fresh/artifacts/dashboard/src/pages/campaigns.tsx`)
Update the existing campaigns page:
1. **Create modal** — add:
   - Schedule picker (date + time, timezone defaults to America/New_York)
   - Throttle controls: batch size, batch interval (minutes), daily limit
   - Send window: start time, end time, days-of-week multi-select
   - Template dropdown — fetches from `/api/campaign-templates`, applies subject/body/from on select
   - Sequence dropdown — fetches from `/api/campaign-sequences`, on select chains the campaign create across all steps
   - Segment expansion: include `past_customers` preset with sub-filters (min days since last service, exclude flagged issues, city/zip)
   - Live audience count preview
2. **Detail modal** — add:
   - Conversation timeline view per recipient (click recipient → opens slide-out with full message thread)
   - Reply inbox tab on the page
   - Internal preview button (renders email HTML or SMS text in a modal — no send)
   - Audience preview list (paginated)
3. **Reply inbox** — new tab on the page:
   - Filter: classification, campaign, requires_review
   - Each reply: from, channel, body, classification, action buttons (mark reviewed, override classification, send manual response, push to Discord)

### G) Final wiring
- Update `replit.md` with new env vars + new tables + new routes
- Update `lib/api-spec/openapi.yaml` with new endpoints (run `pnpm --filter @workspace/api-spec run codegen` afterward)
- After all DB schema files change: run `pnpm --filter @workspace/db exec tsc -p tsconfig.json`
- Build the dashboard: `pnpm --filter @workspace/dashboard run build` (verify no type errors)
- Build the api-server: `pnpm --filter @workspace/api-server exec tsc -p tsconfig.json`

### H) Validation tests
After build, run the migration and verify:
1. `psql $URL -c "SELECT count(*) FROM hh_dnc"` returns 35
2. `psql $URL -c "SELECT count(*) FROM hh_campaign_templates"` returns 5
3. `psql $URL -c "SELECT count(*) FROM hh_campaign_sequences"` returns 1
4. Type check passes on api-server, dashboard, lib/db
5. No new lint errors

## Out of scope (Phase 2 — DO NOT BUILD)
- Google Calendar slot picker UI / booking write flow
- Paid email validation (NeverBounce/ZeroBounce)
- Mop Mafia / Harris Bros nurture rollout
- Reactivation analytics dashboard charts (basic counters only)
- AI auto-reply for simple_question class

## Reference files in workspace
- `WPW-reactivation-build-plan-2026-04-24.md` — strategic plan
- `WPW-reactivation-templates-FINAL.md` — final templates with Luna voice
- `WPW-reactivation-email-plan.md` — earlier email plan (older Zak voice, replaced by Luna)
- `dnc_master.csv` — name list
- `hh-backend-fresh/replit.md` — architecture & safety rules
- `hh-backend-fresh/lib/db/src/schema/` — existing Drizzle schemas

## When you finish
Reply with:
1. List of files created / modified
2. Migration SQL apply result (row counts from validation tests)
3. Any deviations from this brief and why
4. Anything you noticed that needs Zak's attention (e.g. Twilio webhook URL needs to be set in Twilio console)
5. Exact next manual steps Zak must do (Replit env vars, Twilio webhook URL, Discord webhook URL, Resend domain verification)
