# Swell SQLite → Supabase (PostgreSQL) Migration Summary

**Status:** Core infrastructure migrated; remaining work: async/await fixes + type corrections

---

## ✅ Completed

### Task 1: Supabase Migration (Core)

- **1a.** ✅ Updated package.json
  - Removed `better-sqlite3` and `@types/better-sqlite3`
  - Added `postgres` (^3.4.4) - lightweight async PostgreSQL client
  - Added `google-auth-library` and `googleapis` for calendar integration
  - Moved `@types/node` to dependencies

- **1b.** ✅ Created `server/db/schema.sql`
  - All tables prefixed with `swell_` (idempotent creation)
  - Proper JSONB columns for payload/metadata
  - Full indexes on tenant + created_at, status filters, fire_at+status for nurture jobs
  - Calendar tokens table for OAuth state management
  - Blocked dates table for availability management

- **1c.** ✅ Rewrote `server/db/index.ts`
  - Now uses `postgres` client with SSL required
  - Schema applied on startup via `schema.sql` file
  - Connection pooling (max 10)

- **1d.** ✅ Rewrote `server/db/queries.ts`
  - All functions are now async (Promise-based)
  - Uses tagged template literals: ``sql`SELECT * FROM swell_tables` ``
  - All table names updated to `swell_` prefix
  - Proper typing for JSONB → JS objects
  - Updated interfaces: `enabled` still needs type fix (boolean vs number)

- **1e.** ✅ Updated key routes for async/await
  - `server/routes/leads.ts` - all queries await'd
  - `server/routes/facebook.ts` - all queries await'd
  - `server/routes/twilio.ts` - all queries await'd
  - `server/middleware/auth.ts` - `authenticate()` now async
  - `server/middleware/tenant.ts` - middleware now async

- **1f.** ✅ Updated `server/seed.ts`
  - All queries await'd
  - Array handling for fb_form_ids/fb_page_ids corrected

### Task 2: Google Calendar Integration (Complete)

- **2a.** ✅ Created `server/services/calendar.ts`
  - OAuth URL generation
  - Token exchange and refresh
  - Calendar list/selection
  - Availability checking (with blocked dates)
  - Event creation for bookings
  - Blocked date CRUD

- **2b.** ✅ Created `server/routes/calendar.ts`
  - `GET /api/calendar/auth-url` - returns Google OAuth URL
  - `GET /api/calendar/oauth/callback` - handles OAuth redirect (public)
  - `GET /api/calendar/status` - connection status
  - `GET /api/calendar/calendars` - list user's calendars
  - `POST /api/calendar/select` - save selected calendar
  - `GET /api/calendar/availability` - next N days with status
  - `GET /api/calendar/blocked` - list blocked dates
  - `POST /api/calendar/blocked` - add blocked date
  - `DELETE /api/calendar/blocked/:date` - remove blocked date

- **2c.** ✅ Registered calendar router in `server/index.ts`

### Task 4: Test SMS Widget (Complete)

- ✅ Created `server/routes/test.ts`
  - `POST /api/test/sms` - simulated SMS conversation with Hayden
    - Creates/reuses test lead (status='test')
    - Routes through real `handleInboundSms()` engine
    - Returns response + token metrics
  - `DELETE /api/test/sms/:conversationId` - clear test conversation
  - `POST /api/test/sms-trigger` - real Twilio SMS for full loop testing
    - Sends actual SMS from tenant's Twilio number
    - Good for verifying webhook round-trip

- ✅ Registered test router in `server/index.ts`

---

## ⚠️ Remaining Work (TypeScript Build Fixes)

### High Priority (Blocking Build)

1. **Boolean vs Number type mismatch**
   - Issue: `enabled` field is `boolean` in AIConfig but seed returns `number` (1/0)
   - Files affected: `seed.ts`, `seed-ai.ts`
   - Fix: Standardize to `boolean` throughout, convert 1/0 to true/false in seed-ai.ts

2. **JSONB type handling**
   - Issue: `raw_payload` and other JSONB columns stored as `Record<string, unknown>` but some routes cast to `string`
   - Files affected: `routes/facebook.ts`, `services/conversation.ts`
   - Fix: JSON.parse() where needed, keep as objects in db layer

3. **Missing awaits in services**
   - Files: `services/conversation.ts`, `services/nurture-loop.ts`, `services/ai-followup.ts`
   - Fix: Add `await` prefix to all query function calls that return Promises

4. **Google library imports**
   - Issue: TS2307 errors for `googleapis` and `google-auth-library`
   - Fix: Run `npm install` to pull them from package.json

### Medium Priority

5. **Calendar service type issues**
   - `Parameter 'cal' implicitly has 'any' type` in calendarList iteration
   - Fix: Type cast or use `as any` for Google API responses

6. **Test SMS route return types**
   - `handleInboundSms()` returns wrong type
   - Fix: Define proper return type for `handleInboundSms()` in `services/conversation.ts`

7. **Nurture loop function names**
   - Using old names `dueNurtureJobs`, `markNurtureFired`
   - Fix: Update to `getDueNurtureJobs`, `markNurtureJobFired`

### Low Priority

8. **Client: Settings page & Test SMS widget**
   - Not yet implemented (UI-only, doesn't block build)
   - Create `client/src/pages/Settings.tsx` with Calendar tab + General tab
   - Add "Test Hayden" button to Dashboard
   - Create test SMS modal component

---

## Next Steps

### 1. Install dependencies
```bash
npm install
```

### 2. Fix seed-ai.ts booleans
- Change `enabled: 1` → `enabled: true`
- Change `pricing_locked: 1` → `pricing_locked: true`

### 3. Update services/conversation.ts, services/nurture-loop.ts, services/ai-followup.ts
- Add `await` to all query calls:
  - `getAIConfig()` → `await getAIConfig()`
  - `getOrCreateConversation()` → `await getOrCreateConversation()`
  - `getConversationByLeadId()` → `await getConversationByLeadId()`
  - etc.
- Fix boolean comparisons (remove `|| enabled` checks on Promises)

### 4. Fix raw_payload handling
- In routes that reference `lead.raw_payload`:
  - It's already a JS object from postgres client
  - Remove manual JSON.parse() calls
  - Type as `Record<string, unknown>` or keep as-is

### 5. Build & test
```bash
npm run build
npm run dev
```

### 6. Test in dev
- Login to each tenant dashboard
- Verify leads load
- Test calendar OAuth flow
- Try test SMS widget (once Settings UI is added)

---

## Migration Checklist

- [x] Updated package.json dependencies
- [x] Created PostgreSQL schema
- [x] Rewrote db/index.ts
- [x] Converted all queries to async
- [x] Updated main routes (leads, facebook, twilio)
- [x] Updated auth/tenant middleware
- [x] Created calendar service & routes
- [x] Created test SMS routes
- [x] Updated server/index.ts to register new routes
- [ ] Fix TypeScript build errors
- [ ] Run full npm run build
- [ ] Test in dev environment
- [ ] Deploy to Replit

---

## Files Changed

### Database
- `/server/db/index.ts` - Rewritten for postgres client
- `/server/db/schema.sql` - Created with full schema
- `/server/db/queries.ts` - Rewritten (async, postgres syntax)

### Middleware
- `/server/middleware/auth.ts` - authenticate() now async
- `/server/middleware/tenant.ts` - middleware now async

### Routes
- `/server/routes/leads.ts` - All queries awaited
- `/server/routes/facebook.ts` - All queries awaited
- `/server/routes/twilio.ts` - All queries awaited
- `/server/routes/calendar.ts` - Created (new)
- `/server/routes/test.ts` - Created (new)

### Services
- `/server/services/calendar.ts` - Created (new)
- `/server/seed.ts` - Updated for async + postgres

### Config
- `/package.json` - Updated dependencies
- `/server/index.ts` - Registered calendar and test routers

---

## Key Design Decisions

1. **Postgres package**: Lightweight, TypeScript-native, uses tagged template literals
2. **Schema in SQL file**: Idempotent DDL, easier to review and version
3. **All table names prefixed with `swell_`**: Clearer scope, easier to find in DB
4. **JSONB for flexible data**: raw_payload, metadata, services_json, etc.
5. **Calendar tokens separate table**: Clean OAuth state management
6. **Test lead status='test'**: Keeps test data separate from real leads

---

## Known Issues & Solutions

| Issue | Solution |
|-------|----------|
| `enabled` field is boolean but seed returns 1/0 | Standardize to boolean (true/false) in seed-ai.ts |
| `raw_payload` sometimes cast to string | Remove casts, it's already an object from postgres client |
| Missing Google libraries | Run `npm install` |
| Calendar OAuth not yet integrated in UI | Create Settings page with Calendar tab |
| Test SMS widget not in Dashboard | Add modal + button (client-side) |

---

## Performance Notes

- Index on `swell_leads(tenant_id, created_at DESC)` for list queries
- Index on `swell_nurture_jobs(fire_at, status)` for cron lookups
- Index on `swell_conversations(tenant_id, status)` for dashboard filters
- Connection pooling (max 10) prevents exhaustion
- Schema is idempotent — safe to re-run on migrations

---

**Last Updated:** 2026-05-02 01:30 EDT  
**Migrated By:** Subagent  
**Target:** Boss approval for final testing
