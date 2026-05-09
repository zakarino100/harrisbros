# MEMORY.md

## Identity and relationship

- I am Robin 🐧, Zak's personal assistant and business partner across his ventures.
- My requested traits: logical, kind, deductive, problem-solving, great at sales, emotionally stable.

## Zak

- Call the user Boss or Zak.
- Timezone: America/New_York.
- Primary current focus: identify and execute the highest-leverage actions to grow home services businesses.

## Current business operating context

- Primary home services brand: Healthy Home.
- Core Healthy Home offers: House Wash, Driveway Cleaning, and Bundle.
- Daily Healthy Home sales target: 4 sales/day; working KPI framing is about 20 good conversations/day, 4 closes/day, at least $1,200 sold/day, and at least 1 bundle/day.
- Strategic sequence: Healthy Home is the immediate cash engine; Blue Ocean is the recurring/high-margin engine; bigger marketplace ideas are not a current execution priority.
- Blue Ocean is a digital marketing and AI services agency — not a home services brand. It runs the social/content/AI infrastructure for Zak's own brands (Wolf Pack Wash, Mop Mafia) and external clients (Showroom Auto Styles, others). COMMAND is essentially the core product Blue Ocean delivers to clients.
- Blue Ocean brand voice: Hormozi-style — direct, value-first, no hype, results-driven. Logo is black/white/cyan wave mark.
- **Scout** = WPW's internal Discord bot (server assistant). **Luna** = WPW's customer-facing AI SMS persona (what leads talk to). Do not confuse.
- **Hayden** = Swell cross-tenant SMS responder (all Blue Ocean clients: Harris Bros, MackWash, Showroom, etc.) — NOT customer-facing persona, just internal API.
- **Gia** = Mop Mafia's customer-facing AI SMS persona. Bot token: MTUwMTA4NDc0MjcwMTgwOTc5NQ.GN58HZ.k_zpLdlELWiADdVPWZ59glEjX52HJhU2x9TWkI (stored in Swell Replit secret DISCORD_BOT_TOKEN and Mop Mafia CRM Replit). Gia gathers info only — does NOT quote or book. Hands off to owner (Zak's mom) via Discord.
- **Hayden** = Swell's cross-tenant SMS sales AI (MackWash, Harris Bros). Quotes and closes. Different role from Gia.
- Wolf Pack Wash has a large existing content library (images/videos) — needs curation and scheduling, not creative generation.
- Mop Mafia and Blue Ocean need creative generated from scratch — AI copy, templates, and visuals.
- Showroom Auto Styles is an external Blue Ocean client (auto detailing/showroom).
- Finish Line Auto Spa: NOT an active engagement (as of 2026-04-28). Was a planned Blue Ocean client (Nevaeh's cousin Dusty's auto detailing in Jamestown NY) but Zak is not working with them now. Do not assume Finish Line work, infra, secrets, or pricing apply.
- Nevaeh is a guy, not a woman. He just had a son (April 2026) — Zak is "uncle Zak". Nevaeh has ~6 weeks parental leave.
- Nevaeh partnership with Blue Ocean: likely a sales split for clients he brings that Zak closes, rather than a full equity partnership.
- Healthy Home backend/dashboard is being built on Replit and should serve as the source of truth for sales, jobs, reviews, content capture, and daily reporting.
- Healthy Home canvassing app should sync bidirectionally with that backend; backend is canonical, canvassing app is the field-sales client.
- Review workflow plan: satisfaction prompt first, 4-5 routes to Google review request, 1-3 routes to internal feedback form and service recovery.
- Robin should be plugged into daily business stats/metrics for analysis.

## Swell — Blue Ocean's lead command product (NEW 2026-05-01)

### CRITICAL HANDOFF BEHAVIOR (IMPLEMENTED 2026-05-07)
Once a human rep responds to a lead via Discord/SMS:
1. **AI STOPS** — no more Hayden messages to the customer ✅ IMPLEMENTED
2. **Status flips** — conversation marked as `handoff`, `handoff_reason = "rep_took_over"` ✅ IMPLEMENTED
3. **Conversation frozen** — AI gate checks status; if "handoff" or "stopped", returns `{ok:false, reason: 'ai_paused_handoff'}` ✅ ALREADY EXISTED
4. **But still analyze** — all messages logged with role='rep' for learning ✅ ALREADY LOGGED

Changes made:
- `/api/messages/:conversationId/send` now auto-sets `status="handoff"` on first rep message
- `/api/messages/new` also marks `status="handoff"` if first message is from rep
- Conversation service already respects handoff status and stops AI
- All messages are logged for analysis (existing behavior)

This prevents duplicate messages (AI + human talking at once) while letting us measure AI effectiveness.

**Future Phase 3 includes a Blue-Ocean super-admin UI** (Zak-only) showing all leads + all campaigns across every tenant in one view. Used to onboard new clients via form (no code), monitor cross-client metrics, and make global config changes.


- Multi-tenant SaaS-style dashboard hosted at `<client>.nopressurelaunch.com`. One Replit, one DB, every Blue Ocean client gets a tenant.
- Built v0.1 in `/Users/zak/.openclaw/workspace/swell/` (Express + better-sqlite3 + React + Tailwind v4). Black/gold theme. Login-gated, mobile-first, KPI tiles + lead list + lead drawer with activity timeline.
- Webhook URL is shared (`/api/facebook/webhook`); routes by FB form_id → tenant.
- Tenants seeded from env vars (`SWELL_TENANTS=HARRIS_BROS,MACKWASH,...`).
- Theme matches `nopressurelaunch.com` (black + gold) by default; per-tenant brand color override available.
- **Adding a new client is one DB row + one DNS record** (no code deploy required).

### Swell AI SMS Responder + Discord Handoff (planned, in progress 2026-05-01)

Core goal: every Blue Ocean client gets an AI that auto-responds to inbound FB leads via SMS, qualifies/quotes/saves the sale, and hands off to the human rep via Discord when needed. **This is what justifies the $1,200/mo retainer.**

- **Model strategy:** **Sonnet for primary conversation** (handles pricing, scheduling, objection handling, save-the-sale logic where mistakes cost money). **Haiku for classification/summarization** (handoff intent detection, conversation summary on transfer) — cheap, fast, good enough. Configurable per tenant.
- **Why Boss prioritized this:** Harris Bros (existing window-cleaning client) is failing to close the FB leads Boss is sending him — threatens the retainer. Boss needs the AI to take pressure off the rep so the system actually works for the rep, not the rep against the system.
- **Conversation script template** (per tenant override-able):
  1. Greet + identify ("Hi, this is [AI name] with [brand]. Just reaching out regarding your [service] inquiry.")
  2. Recency check ("Has it been more or less than 6 months since [service] was last done?")
  3. Service address ("What's the service address? I'll get you an exact price.")
  4. Quote with route pitch ("If I can get you on the route I have in [city] next week, I can do [services] for $X — includes [full value build].")
  5. **Do NOT ask for confirm at quote time** — save quote, follow up later if no response.
  6. On reply → save / transfer / save-the-sale.
- **Save-the-sale rules** (pricing must be set up so these are bakeable in):
  - $20 off for a Google review pledge
  - $50 transport fee waive
  - Both should be baked into base price so AI has discount headroom without hurting margin.
- **Upsell logic** must be configurable per client (e.g. add gutter cleaning when house wash is the lead service).
- **Handoff to human via Discord:**
  - Each Blue Ocean client gets their own Discord server (Boss creates each one manually, then plugs ID into Swell).
  - On handoff: bot creates a channel for the customer in the tenant's guild, posts lead info + full SMS transcript + handoff reason summary, opens a thread the rep can use.
  - **Accept / Decline** buttons. Decline = send polite "no one available right now" SMS to customer.
  - Two-way bridge: rep types in Discord thread → bot sends as SMS to customer; customer SMS replies appear in the thread.
  - Customer also notified via SMS that a human is taking over.
- **Guardrails** (hard limits, server-side, not user-editable):
  - Hard discount cap (no more than $20 review + $50 transport; nothing else).
  - Never invent service availability or appointment times — always frame as "I have a route in your area next week" not "Tuesday at 3pm."
  - On STOP/UNSUBSCRIBE → immediately stop, mark lead opted_out, alert rep.
  - Forced handoff conditions: complaint, complex question, repeated confusion, request for owner.
  - Always disclose AI on first contact (compliance + trust).
  - Per-conversation token cap to limit cost.
- **AI persona name: Hayden across all tenants** (Boss decided 2026-05-01).
- **Voice: Hormozi / Cardone style** — direct, value-stacked, specific numbers, scarcity framing, action-oriented closes. No "sorry to bother" / "no problem" softeners.
- **Lead nurturing + recovery is mandatory for every tenant** — not optional. Multi-touch follow-up sequence (e.g. 1h check-in if no reply, 24h re-pitch with discount, 72h last-chance, 7d cold revive).
- **Per-tenant AI config** (DB-driven):
  - Model override (sonnet|haiku)
  - Persona name (default Hayden)
  - Pricing matrix (service → base price including baked discount room)
  - Active services
  - Route cities (for the route pitch)
  - Transport fee + review discount amounts
  - Custom system prompt fragments (admin-only — not exposed in tenant UI per Zak's prior rule)
  - Business hours / on-call rules
- **Shared cross-tenant knowledge** (admin-defined, all tenants inherit):
  - Best-practice patterns (save tactics, never lie, AI disclosure, STOP handling).
  - These live in a single `swell_global_prompt_fragments` table or similar.
  - Tenants automatically get them — no override.

## MackWash Pressure Washing (NEW Blue Ocean client — 2026-05-01)

- Owner: Mack. New Blue Ocean client. Monthly retainer **$1,200/mo** if we deliver leads through FB ads.
- Located in Douglasville, GA (suburban Atlanta). Address on FB: 6507 Cowan Mill Rd, Douglasville, GA 30116.
- Phone: (470) 874-1267. Website: mackwash.services. FB page id: 100094353285077 (Boss has full admin access).
- Services: residential & commercial soft/pressure washing. Wants to expand into junk removal later.
- Pricing model: targets ~$150/hr; estimates by visual + time. **Avg ticket ~$400.**
- Plan: replicate the WPW lead-magnet playbook — **$199 House Wash** as the FB ad lead magnet, before/after creative, lead form → quote-up.
- Ad budget: **$25/day** to start. Targeting Douglasville GA + surrounding suburbs.
- Mack's FB page is small (41 followers, 7 following) — needs page warm-up (cover photo, post cadence) alongside ads.
- Before/after photos saved (canonical) to: `CONTENT/MackWash/Before-Afters/` with descriptive filenames. README at `CONTENT/MackWash/README.md`. Working copies also at `mackwash/before-after/01.jpeg … 07.jpeg`. Pairs identified:
  - `house-vinyl-before-02` → `house-vinyl-after-01` (🔥 strongest pair)
  - `house-vinyl-before-04` → `house-vinyl-after-03`
  - `walkway-concrete-before-06` → `walkway-concrete-after-05` (06 has bright green border to crop)
  - `driveway-split-before-after-07` — already a split, ad-ready
- Generated ad creatives belong in `CONTENT/MackWash/Ad Concepts/`.
- Logo: circular, dark navy background, blue/teal accents, "MACKWASH PRESSURE WASHING" wordmark with house silhouette.
- Mack's prior CPL was reportedly $200 — we should crush that with the right offer + creative.
- Note: this is *Blue Ocean client work*, not a Zak-owned brand. We deliver the ads/CRM/content; Mack runs the business and pays the retainer.

## Wolf Pack Wash

- Operating name: Wolf Pack Wash (WPW). Soft/pressure washing brand in Raleigh, NC area.
- House wash promo pricing: $199 under 3,000 sqft; $299 under 4,000 sqft; $499 under 5,000 sqft. Floor is $149 under 2,000 sqft — don't lead with this in ads.
- Current servicer is too slow for ~2,000 sqft homes; goal is to recruit backup servicers and reduce single-operator dependence.
- Facebook ads running at $40/day (scaled up from $25/day test); ads live and generating leads.
- Best-performing ad creative: before/after house wash split image (heavy mold → clean), $199 yellow price badge, Variant D copy: "THAT GREEN STUFF WON'T CLEAN ITSELF — $199", 5-star callout, "Book Now" CTA with paw prints. Strong visual/copy alignment.
- WPW leads routed to Healthy Home backend via dedicated form endpoint (`POST /api/form/submit`). Source tagged as `wolf_pack_wash_website`.
- Facebook Lead Ads integrated with HH backend via Meta webhook + Conversions API (CAPI). Leads auto-synced to Supabase; status changes trigger CAPI events. Dataset ID: `738171941965940`.
- Meta webhook registration was the missing piece for leads syncing — needed subscribing the `leadgen` field in the Meta developer app.
- Prior customer reactivation is planned but needs careful segmentation — historical double-billing issue caused refunds, disputes, and a damaging Yelp review.
- Logo redesign still on the list: want cleaner, bolder, less clipart-like mark for trucks/shirts/signs/social.
- Long-term goal: 3 sales/day from ads while maintaining D2D as the immediate cash channel.
- Content library exists (images/videos) — needs curation and scheduling, not generation.

## Mop Mafia

- Zak's mom's cleaning business launching in Wendell/Raleigh, NC as Mop Mafia Cleaning LLC.
- Landing page: <https://book.mop-mafia.com> (React/Vite SPA on Replit, Supabase backend).
- Funnel: package select → quote → residential/commercial → sq footage → add-ons → contact form → CRM.
- Strategy: focus on bi-weekly recurring residential cleans as the Google Ads offer; spring is peak intent window.
- Funnel upgrade planned: add frequency selector (Step 1, bi-weekly pre-selected with Rate Lock badge), live price calculation before contact form, 4 new Supabase fields (frequency, calculated_price, has_pets, selected_addons).
- Pricing matrix (bi-weekly): Apt $99, ≤1,900 sqft $115, ≤3,200 sqft $145, 3,200+ sqft $175.
- Google Ads campaign structure for Mop Mafia is next step once funnel is updated.
- Mop Mafia phone number: +1 984-464-6019

## Healthy Home backend / CRM

- Built on Replit + Supabase. Source of truth for all leads, jobs, reviews, and reporting.
- All leads tagged with source attribution (utm_source, utm_campaign, etc.) regardless of channel.
- New tables: `hh_fb_lead_details` (FB attribution per lead), `hh_integration_logs` (full audit trail).
- Canvassing app tested in field; bidirectional sync with backend confirmed in principle, needs validation.
- Review automation not yet implemented — was on the agenda as of mid-March.
- Daily stats reporting to Robin partially set up; needs verification/config.
- `FORM_SUBMIT_SECRET` token is browser-visible in WPW embedded form JS — flag for hardening later.
- `META_CONVERSIONS_ACCESS_TOKEN` was shared in chat — recommend rotating after integration confirmed working.
- Current desired lead flow for Wolf Pack Wash: every inbound lead should become quote-ready by capturing service address, requested service(s), rough timeframe, and rough square footage when available, then storing that in CRM + activity timeline + Discord lead thread before a human issues the quote.
- AI nurture should help qualify and organize leads, not fully auto-quote/close yet.
- Zak wants nurture work built for Haiku, with server-side fixed prompts only and no user-editable/custom prompting exposed in UI.
- **Schema drift between code and Supabase is a known recurring issue.** Drizzle schema in `lib/db/src/schema/` has consistently gotten ahead of the actual DB. When endpoints return 500, first-check should be: do all the schema columns/tables exist in Supabase? On 2026-05-01 fixed two waves: (1) Leads tab — `hh_lead_meta` missing + 19 missing columns on `leads`; (2) full audit found 6 more missing tables (`hh_campaign_replies`, `hh_campaign_sequences`, `hh_campaign_templates`, `hh_job_photos`, `hh_tech_clock_sessions`, `hh_tech_location_pings`) and 28 missing columns across `hh_campaigns`, `hh_campaign_sends`, `hh_dnc`, `hh_jobs`, `hh_users`. After fixes: zero drift confirmed.
- **Schema drift audit script** lives at `hh-backend-fresh/lib/db/scripts/schema-drift-audit.ts`. Imports all Drizzle schemas, queries `information_schema`, emits diff + migration file. Run before every deploy: `cd lib/db && SUPABASE_DATABASE_URL=... pnpm tsx scripts/schema-drift-audit.ts`. Output goes to `scripts/migrations/YYYY-MM-DD-schema-drift-fix.sql` — review and clean before applying.
- Re-enabling RLS on Supabase tables: RLS policies tied to `auth.role() = 'authenticated'` will break the backend's direct postgres connection. Either leave RLS off (API layer enforces auth) or write policies that allow the postgres/service_role connection.

## Financial context (as of late March 2026)

- Stripe showed ~$101k gross volume; Zak concerned about tax exposure. Guidance: tax is on net profit, not gross; needs CPA/document gathering.
- Cash-constrained period in late March — ~$700 on hand, ~$3.3k needed by early April. Strategy: don't pay Google Ads balance yet; run FB Lead Ads + D2D as the cash engine.

## WPW reactivation build (DEPLOYED 2026-04-29)

- Sender identity for Wolf Pack Wash assistant outbound: **Luna** (not Robin). Robin stays as the cross-brand assistant; Luna is WPW-specific (wolves + moon brand fit).
- Email sending address: `contact@wolfpackwashnc.com` (display name: `Luna @ Wolf Pack Wash`). Note: actual sending domain is the subdomain `send.wolfpackwashnc.com` (apex was registered on another Resend account).
- Healthy Home backend Replit URL: `https://healthy-home-backend.replit.app` — LIVE in production as of 2026-04-29.
- Resend webhook: id `2db93fdb-de60-4ddc-b317-bedf877440bf`, endpoint `https://healthy-home-backend.replit.app/api/activity/webhooks/resend`, signing secret `whsec_tQDarHlih21eI3L02xIuSmmNBAkijiK9` (Replit secret `RESEND_WEBHOOK_SECRET`). HMAC (Svix) verification enforced when secret is set; native Node crypto, no extra deps.
- Resend sending domain `send.wolfpackwashnc.com`: id `44127ba1-43a8-421b-9baf-a4c400a9bfab`, region `us-east-1`. DNS records (DKIM TXT + SPF MX + SPF TXT) added at Squarespace 2026-04-29; verification pending propagation.
- Supabase DB: project ref `hclpovktywijfnswthpm`, host `db.hclpovktywijfnswthpm.supabase.co`. Wired in via `SUPABASE_DATABASE_URL` Replit secret (code in `lib/db/src/index.ts:7` prefers it over `DATABASE_URL`).
- Replit's bundled Postgres add-on was REMOVED to stop it auto-injecting a conflicting `DATABASE_URL`.
- Discord lead handoff: `#leads` channel `1497708053779316806`, ping `@matthew.fytb` (Matthew handles all incoming WPW leads).
- Resend free tier covers 3,000 emails/month, 100/day — sufficient for ~218 historical record reactivation.
- Email validation: regex + MX-record check (free) is built into the campaign sender pre-send.
- Google Calendar slot picker is Phase 2 (NOT yet built). Calendar creds:
  - GCP project under `aziz.zak98@gmail.com`
  - Calendar ID: `b2dba64cd9d78ac8999cda713e2a99d60d80df0644308dd5dbaa751dd4447aef@group.calendar.google.com`
  - Calendar shared with `contact@wolfpackwashnc.com`
  - API key saved separately; for write access (booking events) we need a service account, not just the API key.

## Replit deploy stack (HH backend)

Final working `.replit` deploy config (this took several iterations to nail down on 2026-04-29):

```toml
[nix]
channel = "stable-24_05"
packages = ["nodejs_22", "nodePackages.npm"]

[deployment]
deploymentTarget = "autoscale"
build = ["sh", "-c", "npm install -g --prefix=$HOME/.local pnpm@10.33.0 && export PATH=$HOME/.local/bin:$PATH && pnpm install --frozen-lockfile && pnpm build"]
run = ["sh", "-c", "node artifacts/api-server/dist/index.cjs"]
```

Key gotchas learned:
- Replit's Nix `nodePackages.pnpm` gave pnpm 8.15.5; we need pnpm 10 to match our lockfile.
- `corepack enable` fails because Nix store is read-only.
- Workaround: `npm install -g --prefix=$HOME/.local pnpm@10.33.0` into a writable dir, then PATH it.
- `package.json` has `"packageManager": "pnpm@10.33.0"` to lock the version.
- Root `build` script filters out `mockup-sandbox` to avoid its `vite build` issues.
- Vite configs in `dashboard` + `mockup-sandbox` now use safe defaults for PORT/BASE_PATH so build doesn't throw.
- Replit's bundled Postgres must be DISCONNECTED, otherwise it auto-injects `DATABASE_URL` and the deploy preflight rejects with "external database detected".

## Facebook lead sync infrastructure (built 2026-04-30)

- Three new endpoints on the HH backend (in `artifacts/api-server/src/routes/facebook.ts`):
  - `POST /api/facebook/sync-pulls-all` — pulls every lead from Meta for the configured form, dedupes (meta_lead_id → phone/email), inserts/updates locally, and **fires Discord notifications for every newly-inserted lead** (so the backfill populates Discord threads for any leads that missed the live webhook). Idempotent.
  - `POST /api/facebook/sync-push-status` — sends a Meta CAPI conversion event for every local lead with source="ad", mapped from CRM status (`new→Lead`, `quoted→QualifiedLead`, `sold→ConvertedLead`, etc.). Idempotent.
  - `GET  /api/facebook/diag` — returns which integrations are configured (Discord bot, page token, CAPI token, form id, channel ids) without leaking secret values. Use this to verify deploy config quickly.
- Auth: a unified `isAdmin()` helper accepts either the dashboard `hh_auth` cookie (logged-in operator) OR `X-HH-Token: <FORM_SUBMIT_SECRET>` header (curl/external).
- `form_id` resolution order: request body → query string → `FACEBOOK_LEAD_FORM_ID` env var. Set the env var so the dashboard buttons don't have to prompt for it.
- Dashboard UI (`artifacts/dashboard/src/pages/leads.tsx`) has two buttons next to "Add Lead": **Catch up on FB** (download icon) and **Push to FB** (upload icon). Both use cookie auth (no token prompt) and surface results via toast.
- `notifyDiscord` defaults to `true` on `sync-pulls-all` — pass `{notifyDiscord:false}` if you ever want a silent backfill.
- Required env vars on Replit secrets for full functionality: `FACEBOOK_WEBHOOK_VERIFY_TOKEN`, `FACEBOOK_PAGE_ACCESS_TOKEN`, `META_CONVERSIONS_ACCESS_TOKEN`, `FACEBOOK_LEAD_FORM_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_LEADS_CHANNEL_ID`, `DISCORD_NOTIFY_USER_ID` (optional), `FORM_SUBMIT_SECRET`, `DASHBOARD_PASSWORD`.
- Deploy is via Replit "Publish" button (no CLI deploy command). The `pnpm build` runs `pnpm install --frozen-lockfile` fresh in the build container, which is why local SSH `pnpm build` may fail on missing `@types/*` until you run `pnpm install` first.

## Swell — Hayden conversation config (updated 2026-05-03)

### Both tenants: <<HOLD>> 3-min delayed quote
- After getting enough info to quote, Hayden sends a "checking route" holding message immediately
- `<<HOLD>>` token splits the response — part after fires via setTimeout 3 min later
- Quote format: "If I can get you on the route I have in [city] this week/next week, I can do $[price] for [service]..."
- After pitch: STOP, wait for response. Then A/B day choice (never open-ended)
- Objection ladder: soft no → ask why → $20 review discount → $50 travel waive → satisfaction guarantee → new A/B days

### MackWash specifics
- Strictly $150/hr. Quote house wash ONLY — never quote driveway proactively (must measure on-site)
- If asked about driveway: "We'll quote that when we come out — bundle deal while we're there"

### Harris Bros specifics  
- Ask "how many windows?" (not panes — estimate 2 panes/window)
- Quarterly plan: pitch AFTER booking confirmed, not before

## WPW Conversations system (built 2026-05-03, deployed)

### Status
- All code written and SCP'd to both Replits. All 3 projects republished ~7:50pm EDT.
- HH backend has: hh_conversations, hh_conversation_messages, hh_rep_earnings, hh_tech_earnings tables (auto-created on boot)
- FB lead → 60s delay → opening SMS (Matthew's voice) → Discord channel created → follow-ups at 2h/24h/72h if no response

### TODO (blocking Discord conversations working fully)
- `DISCORD_WPW_GUILD_ID` = `1439371490947633202` ✅ add to HH backend secrets
- `DISCORD_WPW_CONVERSATIONS_CATEGORY_ID` = **Zak needs to create "CONVERSATIONS" category in WPW Discord and paste ID**
- `DISCORD_MATTHEW_USER_ID` = **Matthew's Discord user ID (for @mentions)**
- Judah's email needed to set role="rep" in HH users DB

### Commission structures (stored in hh_settings key="commission_config")
- Matthew: D2D 30%, ad leads scheduled 10% of final job, reactivation rep-close $20 flat, link $10 flat
- Judah: D2D 20% flat, 25% if hits 2 sales/day
- Nassim (tech): 25%. Harrison/Cameron: 20% placeholder. Payout 3 biz days after serviced.

### Expo App navigators
- Matthew (matthewlinder123@gmail.com): MatthewTabNavigator — Canvass/Leads/Conversations/Routes/Earnings/Profile
- Judah + D2D reps (role=rep): RepTabNavigator — Canvass/Routes/Earnings/Profile
- Techs (role=tech): TechTabNavigator — Jobs/Route/Earnings/Clock/Profile

## Mop Mafia — build context (updated 2026-05-06)

### Pipeline status for FB ads
- mop-mafia.com domain DNS swapped from Bluehost to Squarespace native; added to Replit custom domain (verifying 2026-05-06)
- Mop Mafia added as tenant `mop_mafia` in Swell (2026-05-06) — dashboard password: MopMafia2026!
- Gia AI persona configured: gathers info only, NO pricing, NO booking — hands off to human for personalized quote
- `custom_brand_notes` + `persona_name` now injected into buildSystemPrompt (code fix deployed 2026-05-06)
- Twilio number: +1 (984) 367-0808 (`+19843670808`) — already in use in old CRM Replit, now wired into Swell
- FB page ID: 61584177061574 — wired into Swell
- FB lead form ID: 984364960653170 ✅
- Discord: Guild 1501066212040245348, Leads 1501777617316089866, Sales/Bookings 1501777225966686279, Updates 1501777651554193438 ✅
- Gia Discord bot invited to Mop Mafia server ✅
- Privacy policy page deployed at mop-mafia.com/privacy.html ✅
- Mop Mafia page subscribed to leadgen via FB Graph API ✅ (but through WPW app → HH backend, not Swell)
- **Webhook routing situation (2026-05-06):**
  - Harris Bros → Harris Bros Marketing App (ID 1487357343069688) → real-time webhook → Swell ✅
  - MackWash → hourly polling (no real-time webhook) — works, up to 60 min delay
  - Mop Mafia → hourly polling (same as MackWash) — works, up to 60 min delay
  - WPW → WPW app (955110837022635) → HH backend (DO NOT touch)
  - **TODO:** Subscribe MackWash + Mop Mafia through Harris Bros Marketing App for real-time webhooks. Need page tokens for both generated through Harris Bros Marketing App.
- SMS pipeline confirmed working: FB lead → hourly sync → Swell → Gia SMS ✅
- Discord notifications confirmed working after adding DISCORD_BOT_TOKEN to Swell secrets ✅
- Twilio webhook set for (984) 367-0808 → swell.nopressurelaunch.com/api/twilio/inbound ✅ (note: swell.nopressurelaunch.com DNS not yet set up — need to point this domain to Swell Replit)
- **Swell deployed URL:** Replit dev domain (ef40b1f4...) — swell.nopressurelaunch.com DNS not pointing anywhere yet; need to set up
- Swell status inquiry / post-handoff loop (AI asks Discord about lead outcomes) → not yet built

### Gia flow (different from Hayden)
- Gather: service type, address, sqft/beds, pets/preferences
- Confirm summary warmly
- Handoff: "Our owner will reach out personally within the hour with your custom quote"
- Trigger: <<HANDOFF: ready for quote>>
- NEVER quote price. NEVER book a time.
- Luxury positioning = personal touch from owner (Zak's mom)

## Mop Mafia — build context (2026-05-04)

- Domain: mop-mafia.com
- Owner: Italian-American single mom, daughters: Amira (19), Layla (16), Selina (13)
- Positioning: Woman-owned, family-operated, NO contractors, luxury $1M+ homes, 5-star only
- Phone: (984) 464-6019
- Colors: Navy #0A1628, Gold #C9A84C, Cream #FAF8F5
- AI persona: **Gia** (warm, uses "we", references family when relevant, still closes fast)
- Mop Mafia Discord Guild ID: `1501066212040245348`
- Landing page Replit SSH: `ssh -i ~/.ssh/replit -p 22 b6b02cae-e1f3-446c-8543-e9446efcd0a2@b6b02cae-e1f3-446c-8543-e9446efcd0a2-00-nnyapc16o8hj.spock.replit.dev`
- CRM Replit SSH: `ssh -i ~/.ssh/replit -p 22 a17f3238-df80-4ca2-a27c-ca980c031d06@a17f3238-df80-4ca2-a27c-ca980c031d06-00-3fbc1w9kb87rv.worf.replit.dev`
- Local build files: `/Users/zak/.openclaw/workspace/mop-mafia-site/`
- Generated images: `/Users/zak/.openclaw/workspace/mopmafia-*.jpg`

## Robin's SSH into the Swell Replit

Key: `~/.ssh/replit`
```
ssh -i ~/.ssh/replit -p 22 ef40b1f4-73d3-45c4-9fa5-3c4d156824d5@ef40b1f4-73d3-45c4-9fa5-3c4d156824d5-00-sosmtk9rwo1p.kirk.replit.dev
```
Build: `npm install && npm run build` then `pkill -f 'node dist/server'; nohup node dist/server/index.js > /tmp/swell.log 2>&1 &`

## Twilio Numbers — Full Map
- Account SID: AC0b9f60b9b4915f0e5dc728fcf1a913aa
- Auth Token: 253218d7f0d336ed62c28a70be43b08c

| Number | Brand | Purpose | SMS Webhook |
|---|---|---|---|
| (919) 899-7856 | WPW | Primary customer-facing: calls, texts, campaigns | campaign-replies/sms-webhook |
| (984) 600-7038 | WPW Internal | Luna onboarding texts to employees, internal SMS alerts (urgent leads, reminders) | sms/inbound |
| (919) 371-5474 | Healthy Home | Customer-facing: Mia conversation flow | sms/inbound |
| (984) 367-0808 | Swell | Swell cross-tenant | Swell backend |
| (417) 457-2644 | Harris Bros | Swell/Hayden | Swell backend |
| (770) 415-8392 | Harris Bros | Swell/Hayden | Swell backend |
| (984) 204-6929 | Unknown | Make.com flow | Make.com |
| (984) 205-1627 | Unknown | Make.com flow | Make.com |

## Robin's SSH into the HH backend Replit

Key already added; works via:
```
ssh -i ~/.ssh/replit_wolfpackwash -p 22 01616f2b-facf-41fc-a607-25a0ebe18b96@01616f2b-facf-41fc-a607-25a0ebe18b96-00-3gcvfx18qfig3.riker.replit.dev
```
Note: SSH shell does NOT have node/pnpm on PATH (they're only available inside the deploy build container). For ad-hoc commands, install pnpm into ~/.local the same way the deploy does.

## Reference data files

- Triangle Gutter Guys LLC customer list (name, phone, email, address): `~/Downloads/Customers.xlsx` — 82 customers, NOT Wolf Pack Wash data. Will be used in a future campaign.
- WPW historical sales data: `~/Downloads/Sales-Grid view.csv` (151 rows, has phone + review rating) and `/Users/zak/.openclaw/workspace/wpw-d2d-fresh/server/data/historical-wpw.csv` (218 rows, has phone + email + address).
- WPW unified Stripe customers: `~/Downloads/unified_customers.csv` (Stripe billing data, email + name only).

## Channel continuity

- Shared continuity across web and Discord should rely on workspace memory files, not assumed live cross-session memory.
- Discord access is working in the allowlisted #coool channel after fixing the guild/channel config to use real Discord IDs.

## WPW Discord Channel Structure (confirmed 2026-05-08)
- **Scout** = WPW's internal Discord bot (all notifications). **Luna** = customer-facing SMS persona only, never posts to Discord.
- **#leads** (1439375021586911285) — new organic leads and service inquiries
- **#bookings** — confirmed bookings
- **#reactivation** (1502357456452587612) — notification ping when reactivation customer responds
- **#convos** (1502357892571992204) — one thread per customer, two-way SMS bridge (Matthew replies here → SMS)
- **#updates** (1502363455779504198) — internal ops: customer issues, complaints, employment inquiries, vendor outreach, Matthew status reminders
- Matthew's Discord user ID: `1390089142087717087`

## HH Backend Discord Routing (live 2026-05-08)
- All notifications route through Scout (DISCORD_BOT_TOKEN), not webhooks
- Intent taxonomy: new_lead, reactivation_positive, reactivation_question, customer_issue, employment_inquiry, manager_request, vendor_outreach, booking_confirmation, simple_question, opt_out, unclassified
- Reactivation intents → ping #reactivation + create thread in #convos automatically
- Customer issues/manager requests → #updates (urgent, @Matthew)
- New leads → #leads
- hh_campaign_replies now stores: intent_label, urgency, detected_service, detected_brand, discord_channel_id
- "Spidey Bot" = old Discord webhook name. Replaced by Scout entirely.

## Operational Issues Fixed (2026-05-07)

### Harris Bros Lead/Discord Notification Issue
- **Problem:** New lead came in, no Discord notification fired
- **Root cause:** Swell server was crashed (no node process running)
- **Fix:** Restarted the server (`npm run build && node dist/server/index.js`)
- **Status:** ✅ Server is back up; new leads should now process and notify via Discord

### Swell Health Monitoring (Every 30min)
- **Setup:** Cron job `Swell Health Check` (every 30 minutes)
- **Endpoint:** `GET https://swell.nopressurelaunch.com/api/health` (no auth needed)
- **Model:** Haiku (minimal cost, ~$0.001 per check)
- **Alert:** Pings Boss if server returns non-200 or fails to respond
- **Cron Job ID:** `2e4e25ea-2bd4-4d7b-95b3-ca66a71a80cd`

## Discord Bot Recovery (May 9, 2026 Incident)

### Issue
- Both **Hayden** (Swell SMS bot) and **Gia** (Mop Mafia SMS bot) stopped responding around 5/9 afternoon
- Cause: Discord gateway reconnection loop (5s fixed retry with no backoff) triggered abuse detection
- Both bot tokens were flagged and rejected after 1000+ rapid reconnection attempts
- **Status:** Bots offline, leads not being notified to Discord

### Fix Applied
1. **Code fix**: Updated `swell/server/services/discord-gateway.ts` with exponential backoff (5s → 10s → 20s → 40s → 60s), max 5 retries, jitter to prevent thundering herd
2. **Backfill script created**: `swell/scripts/discord-backfill.ts` to catch up missed Discord notifications
3. **Recovery plan documented**: `/Users/zak/.openclaw/workspace/BOT_RECOVERY_PLAN.md` (full checklist)

### Action Items for Boss
- [ ] Reset Hayden bot token in Discord Developer Portal (https://discord.com/developers/applications → 1499988099428782172)
- [ ] Update Swell `.env` with new Hayden token
- [ ] Deploy Swell code changes (git push to Replit)
- [ ] Reset Gia bot token (Mop Mafia's Replit) — same process
- [ ] Apply exponential backoff fix to Gia's Discord gateway code
- [ ] Run backfill: `BACKFILL_HOURS=24 npx ts-node scripts/discord-backfill.ts`
- [ ] Test both bots with fake leads

### Prevention
- Monitor bot token usage monthly via Discord audit logs
- Set up health check that alerts if bot reconnects >3 times in 30 minutes
- Archive gateway connection/disconnect events for debugging
