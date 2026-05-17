# Healthy Home CRM — Comprehensive Redesign Analysis & Implementation Plan

**Date:** May 14, 2026  
**Status:** Full Audit Complete | Implementation Ready

---

## EXECUTIVE SUMMARY

The Healthy Home CRM backend is **fully operational** but has significant gaps in:
- **Permission system**: No role-based access control (RBAC); all users see all data
- **Financial tracking**: Rep & tech earnings tables are empty (critical gap for payroll)
- **Campaign management**: Status inconsistencies (campaigns marked "draft" with sends already recorded)
- **D2D integration**: Canvassing data exists but not well-connected to rep dashboard
- **UI/UX**: No brand identity, not mobile-optimized, no per-rep customization

**Recommendation:** Implement full RBAC system, populate earnings tables, rebrand with Healthy Home identity, and rebuild dashboard with mobile-first rep-centric views.

---

## 1. DATABASE AUDIT

### Schema Overview
- **49 total tables** across multiple subsystems
- **Major sections**: Users/Auth, Campaigns, Jobs, Customers, D2D Canvassing, Integrations, Earnings
- **Total database size**: ~3.2 MB

### Table Inventory & Data Quality

#### USER MANAGEMENT
| Table | Rows | Columns | Status | Notes |
|-------|------|---------|--------|-------|
| `hh_users` | 4 | 13 | ✅ Good | Zak, Naseem, Judah, Matthew. Roles: canvasser/technician/rep/management. **No explicit admin role.** |

**CRITICAL GAP:** No permission/role mapping — all roles see all features.

#### CUSTOMERS & LEADS
| Table | Rows | Columns | Status | Notes |
|-------|------|---------|--------|-------|
| `hh_customers` | 17 | 16 | ✅ Good | Basic info, opt_out flag, sync_source tracking. |
| `leads` | 678 | 77 | ✅ Good | Large schema tracking all lead touchpoints. Business units: Healthy Home, WPW. |
| `hh_lead_details` | 27 | 13 | ⚠️ Sparse | Only 27 rows vs 678 leads — 96% of leads missing detailed info! |
| `hh_lead_activity` | 75 | 18 | ⚠️ Sparse | Limited activity logging. |
| `hh_lead_meta` | 10 | 10 | ❌ Minimal | Only 10 rows tracking custom metadata. |

**CRITICAL GAPS:**
- Most leads missing detail records
- Lead activity incomplete
- Custom metadata almost unused

#### JOBS & FULFILLMENT
| Table | Rows | Columns | Status | Notes |
|-------|------|---------|--------|-------|
| `hh_jobs` | 14 | 21 | ⚠️ Incomplete | 14 jobs. Missing technician_assigned for many. No payment tracking. |
| `hh_job_content` | 14 | 10 | ✅ Good | Job photos, descriptions aligned with jobs. |
| `hh_job_photos` | 0 | 10 | ❌ Empty | No photos stored/linked. |
| `hh_feedback` | 0 | 8 | ❌ Empty | No post-job feedback collected. |

**CRITICAL GAPS:**
- Job-to-tech assignment incomplete
- Photos not being stored
- Post-job feedback unused

#### EARNINGS & PAYROLL
| Table | Rows | Columns | Status | Notes |
|-------|------|---------|--------|-------|
| `hh_rep_earnings` | **0** | 15 | ❌ CRITICAL | **EMPTY — no rep earnings tracking at all!** |
| `hh_tech_earnings` | **0** | 13 | ❌ CRITICAL | **EMPTY — no tech payout tracking!** |
| `hh_tech_clock_sessions` | 0 | 6 | ❌ Empty | No time tracking for techs. |
| `hh_settings` | 2 | 3 | ✅ Minimal | Has discord_notifications & tech_commission_config. |

**CRITICAL GAPS:**
- **NO earnings records exist** — payroll cannot be processed
- Commission rates configured but no earnings calculated
- No time tracking for hourly work

#### CAMPAIGNS & SMS
| Table | Rows | Columns | Status | Notes |
|-------|------|---------|--------|-------|
| `hh_campaigns` | 5 | 37 | ⚠️ Inconsistent | Status conflicts: Campaign 2 is "draft" but has 20 sends recorded. |
| `hh_campaign_sends` | 295 | 31 | ✅ Good | Good send tracking. |
| `hh_campaign_replies` | 9 | 24 | ✅ Good | Limited replies (3.1% reply rate). |
| `hh_campaign_sequences` | 4 | 10 | ✅ Good | Sequences defined but not fully utilized. |
| `hh_campaign_templates` | 21 | 13 | ✅ Good | Message templates available. |
| `hh_sms_conversations` | 2 | 9 | ❌ Minimal | Only 2 active conversations. |

**ISSUES:**
- Campaign 3 & 4 (review request A/B tests) scheduled but never sent
- Campaign 5 marked scheduled but 80 already sent
- SMS conversation tracking underutilized

#### CANVASSING & D2D
| Table | Rows | Columns | Status | Notes |
|-------|------|---------|--------|-------|
| `hh_canvassing_sessions` | 1 | 24 | ⚠️ Critical | **Only 1 session!** No active D2D tracking. |
| `d2d_touches` | 232 | 11 | ✅ Good | Good touch history (legacy schema). |
| `d2d_quotes` | 36 | 10 | ✅ Good | Quote tracking. |
| `d2d_services` | 7 | 5 | ✅ Good | Service types defined. |
| `canvassing_routes` | 0 | 10 | ❌ Empty | No routes defined. |

**CRITICAL GAPS:**
- Canvassing not actively tracked (only 1 session!)
- D2D app data exists but not synced to new schema
- No active canvassing sessions despite team in field

#### REVIEWS & SATISFACTION
| Table | Rows | Columns | Status | Notes |
|-------|------|---------|--------|-------|
| `hh_review_requests` | 1 | 12 | ⚠️ Minimal | Only 1 request sent. |
| `hh_review_workflows` | 1 | 20 | ⚠️ Minimal | 1 workflow. 0 satisfaction responses. |

**CRITICAL GAPS:**
- Review workflow not implemented
- No satisfaction tracking
- Campaigns 3 & 4 (review A/B test) scheduled but not executing

#### INTEGRATIONS
| Table | Rows | Columns | Status | Notes |
|-------|------|---------|--------|-------|
| `hh_integration_logs` | 359 | 10 | ✅ Good | Good audit trail. |
| `hh_discord_convos_threads` | 32 | 7 | ✅ Good | Discord notifications working. |
| `hh_fb_lead_details` | 155 | 20 | ✅ Good | Facebook Lead Ads data syncing. |
| `call_logs` | 33 | 11 | ✅ Good | VAPI calls logged. |
| `hh_call_logs` | 1 | 14 | ⚠️ Minimal | Only 1 call in new schema. |

**STATUS:**
- Facebook Lead Ads: **115 PENDING records** (not processed!)
- Discord: Working
- VAPI: Working but minimal usage
- Twilio SMS: Working

#### REPORTING & DAILY METRICS
| Table | Rows | Columns | Status | Notes |
|-------|------|---------|--------|-------|
| `hh_daily_reports` | 39 | 24 | ✅ Good | 39 days of metrics tracked. Comprehensive KPI capture. |
| `crm_activity` | 632 | 8 | ✅ Good | Activity audit trail. |

---

## 2. INTEGRATION AUDIT

### Summary
| Integration | Status | Issues | Last Activity |
|-------------|--------|--------|----------------|
| **Twilio SMS** | ✅ Working | None | Ongoing |
| **Facebook Lead Ads** | ⚠️ Broken | 115 pending records, 9 errors | May 14, 22:19 |
| **Facebook CAPI** | ✅ Working | Occasional errors (6) but mostly success | May 14, 22:19 |
| **VAPI (Voice)** | ✅ Working | Minimal usage (only 1 recent call) | May 9 |
| **Discord** | ✅ Working | Some Scout errors but reactivation works | May 11 |
| **Google Calendar** | ✅ API exists | Not tested | — |
| **Resend (Email)** | Unknown | No integration logs | — |

### Critical Issues

**1. Facebook Lead Ads — 115 PENDING Records**
- Leads are being received but not processed
- Root cause: Integration workflow broken or paused
- Impact: No inbound lead processing from Facebook

**2. Empty Earnings Tables**
- Rep & tech earnings never populated despite 14 jobs and 678 leads
- Commission config exists in settings but no job→earnings trigger
- Impact: Cannot calculate payroll or sales commissions

**3. Canvassing Data Disconnected**
- D2D app has 232 touches and 36 quotes in legacy schema
- Canvassing sessions not synced to new `hh_canvassing_sessions` table
- Impact: Rep has no live D2D tracking in dashboard

**4. Campaign Status Inconsistencies**
- Campaign 2: Status="draft" but total_sent=20
- Campaign 5: Status="scheduled" but total_sent=80
- Impact: Campaign UI shows incorrect state

**5. Review Workflow Never Executed**
- Campaigns 3 & 4 (A/B test variants) stuck in "scheduled" status
- Satisfaction workflow created but never triggered
- Impact: Zero review requests sent despite completion of jobs

---

## 3. PERMISSION & ACCESS CONTROL GAPS

### Current State
- **No RBAC implemented**
- All users see same dashboard and can access all features
- Users have roles (canvasser/technician/rep/management) but no permission mapping
- No per-rep data filtering

### Required Roles

#### ADMIN (Zak)
- View all reps' data
- Manage all campaigns, jobs, customers
- Access financial dashboard (revenue, collections, earnings)
- Manage rep/tech settings and roles
- Run reports

#### REP (Matthew, Judah, etc.)
- View **only** own daily targets, pipeline, jobs
- See own customers
- Cannot see other reps' data or financials
- Limited to assigned canvassing routes

#### TECHNICIAN (Naseem, etc.)
- View assigned jobs
- Clock in/out
- Update job status & photos
- Cannot see sales data or other techs' jobs

---

## 4. UI/UX REDESIGN SPEC

### Design System
**Colors:**
- Navy: `#0F172A` (primary, nav, headers)
- Teal: `#3DD6C0` (accents, CTAs, success)
- White: `#FFFFFF` (backgrounds, text on dark)
- Gray: `#F1F5F9` – `#64748B` (secondary, disabled)

**Logo:**
- Cursive wordmark for light backgrounds
- White version for dark backgrounds
- Place in top-left nav at 140px height

**Typography:**
- Display: Cursive or serif for headings (brand font)
- Body: System stack (-apple-system, BlinkMacSystemFont, Segoe UI)
- Sizes: 1rem default, responsive scaling

**Layout:**
- Mobile-first (primary use case: reps in field)
- 2-col on tablet, 3-4 col on desktop
- Touch-friendly buttons (min 44px height)

### Page Structure

#### 1. ADMIN DASHBOARD (Zak only)
**URL:** `/admin`

**Layout:**
- Top: Nav bar with logo, user menu, settings
- Left: Collapsible sidebar (navigation)
- Main: Content area

**Tabs:**
1. **Overview**
   - All reps' aggregate metrics
   - Revenue pipeline by service
   - Outstanding collections
   - Team performance chart

2. **Sales Reps**
   - List of reps with daily/weekly stats
   - Click to drill into rep's detail view
   - Edit rep permissions, targets, pay settings

3. **Financial**
   - Revenue sold vs collected by rep/week/service
   - Commission tracking (rep earnings)
   - Tech payroll (hours & payout)
   - Invoice/receipt management

4. **Campaigns**
   - List all campaigns
   - Create/edit/send campaigns
   - View sends, replies, conversion rates
   - A/B test results (campaigns 3 & 4)

5. **Settings**
   - Integration management (Discord, Twilio, Facebook, VAPI)
   - Commission rates and pay rules
   - SMS template library
   - Branding

#### 2. REP DASHBOARD (Matthew, Judah, etc.)
**URL:** `/rep` or `/rep/:repId`

**Layout:** Mobile-first single-column

**Sections (in order):**
1. **Daily Target Tracker** (pinned)
   - Revenue target (numeric input or visual progress)
   - Conversations target
   - Closes target
   - Show current progress + remaining

2. **Today's Action Items**
   - "Start Canvassing" button
   - Active jobs to complete
   - Customers needing follow-up

3. **Live Pipeline**
   - Doors knocked today
   - Good conversations
   - Quotes given
   - Closes (with customer names & amounts)
   - Average ticket price

4. **Jobs** (pull from `hh_jobs`)
   - Scheduled jobs for today/this week
   - Assigned technician
   - Customer info
   - Status (scheduled/in-progress/completed)
   - Payment status

5. **Customers** (recent interactions)
   - List of customers rep has sold to
   - Full history when clicked
   - Contact info, all purchases, job status

#### 3. TECHNICIAN DASHBOARD (Naseem, etc.)
**URL:** `/tech`

**Sections:**
1. **Clock In/Out**
   - Start/end work day
   - Track hours

2. **Assigned Jobs**
   - List of jobs assigned to tech
   - Status: scheduled/in-progress/completed
   - Customer address & contact
   - Photos (before/after)

3. **Job Details** (when expanded)
   - Service type & pricing
   - Photo upload (before, during, after)
   - Add notes
   - Mark complete + collect payment

---

## 5. KEY MISSING FEATURES

### A. Rep Permission System
**Current:** No RBAC. Need:
- Middleware to filter queries by rep_id
- Rep isolation in dashboard endpoints
- API validation that rep can only access their own data

**Schema change:**
```sql
-- Add to hh_users
ALTER TABLE hh_users ADD COLUMN manager_id INTEGER;
ALTER TABLE hh_users ADD COLUMN team_lead_id INTEGER;
ALTER TABLE hh_users ADD COLUMN roles TEXT[] DEFAULT '{"rep"}';
ALTER TABLE hh_users ADD COLUMN permissions JSONB DEFAULT '{}';
```

### B. Daily Target Tracker
**Current:** Static KPI targets in code  
**Need:**
- Per-rep daily targets (revenue, conversations, closes)
- Stored in settings or new table
- Dashboard pulls targets and displays progress

**New table:**
```sql
CREATE TABLE hh_rep_targets (
  id SERIAL PRIMARY KEY,
  rep_id INTEGER REFERENCES hh_users(id),
  target_date DATE,
  revenue_target NUMERIC(10,2),
  conversations_target INTEGER,
  closes_target INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### C. Earnings Calculation
**Current:** Tables exist but empty  
**Need:**
- Job completed → trigger earnings calculation
- Rep commission based on close price
- Tech commission based on hours worked

**Fix:**
```sql
-- When job completed, insert into hh_rep_earnings
INSERT INTO hh_rep_earnings (rep_id, job_id, lead_id, customer_name, earn_type, gross_amount_cents, commission_cents, status)
SELECT (SELECT tech_user_id FROM hh_jobs WHERE id = NEW.id),
  NEW.id,
  NEW.lead_id,
  (SELECT CONCAT(first_name, ' ', last_name) FROM hh_customers WHERE id = NEW.customer_id),
  'commission',
  NEW.sold_price::numeric * 100,
  (NEW.sold_price::numeric * hh_settings.commission_rate * 100),
  'pending'
FROM hh_settings;
```

### D. Live Canvassing Integration
**Current:** Data in old schema (d2d_touches, d2d_quotes)  
**Need:**
- Sync D2D app touches to `hh_canvassing_sessions`
- Real-time location pings to `hh_tech_location_pings`
- Map view showing rep locations

### E. Campaign Execution Fix
**Critical:** Campaigns 3 & 4 stuck in scheduled state

**Action:**
1. Review campaign_sender.ts for why campaigns not sending
2. Check CRON job scheduling
3. Re-trigger campaigns 3 & 4

### F. Customer History View
**Need:**
- When customer viewed in dashboard, show:
  - All jobs for this customer
  - All payments
  - All interactions (SMS, emails, calls)
  - Outstanding balance

**Implement in new `/api/customers/:id/history` endpoint

---

## 6. IMPLEMENTATION ROADMAP

### Phase 1: CRITICAL FIXES (Week 1)
- [ ] Fix empty earnings tables (backfill from existing jobs)
- [ ] Fix campaign status inconsistencies
- [ ] Fix Facebook Lead Ads pending records (reprocess 115)
- [ ] Implement basic RBAC middleware
- [ ] Add rep_id filtering to all endpoints

### Phase 2: CORE FEATURES (Week 2)
- [ ] Implement rep targets table
- [ ] Build rep dashboard (mobile-first)
- [ ] Build admin dashboard with rep list
- [ ] Implement customer history view
- [ ] Fix canvassing session syncing

### Phase 3: REBRAND & POLISH (Week 3)
- [ ] Apply Healthy Home color scheme
- [ ] Integrate logo (cursive & white versions)
- [ ] Mobile optimization pass
- [ ] Add Healthy Home brand to all pages
- [ ] Test on mobile devices

### Phase 4: VALIDATION (Week 4)
- [ ] User testing with Matthew (rep view)
- [ ] Admin testing with Zak
- [ ] Integration testing (SMS, Facebook, Discord)
- [ ] Performance optimization
- [ ] Deployment to production

---

## 7. DATA GAPS TO ADDRESS

### Immediate Actions
1. **Backfill hh_rep_earnings**
   - From leads table, calculate commission for all sold deals
   - From jobs table, calculate payout for all completed jobs

2. **Sync D2D app data**
   - Export d2d_touches → hh_canvassing_sessions
   - Update latest canvassing activity in dashboard

3. **Fix campaign statuses**
   - Audit campaign 2, 3, 4, 5 send history
   - Correct status fields
   - Re-trigger campaigns 3 & 4

4. **Enable Facebook Lead Ads processing**
   - Review pending 115 records
   - Check webhook handler
   - Re-process or discard invalid leads

---

## 8. SUMMARY OF KEY FINDINGS

### 🟢 What's Working Well
- Core infrastructure (Express API, Drizzle ORM, PostgreSQL) solid
- Integrations (Twilio, Discord, Facebook CAPI, VAPI) functional
- Campaign framework in place
- Daily reporting automated

### 🟡 What Needs Attention
- Campaign status inconsistencies
- Facebook Lead Ads backlog (115 pending)
- Canvassing data not synced to new schema
- Review workflow stuck
- Earnings tables empty

### 🔴 Critical Gaps
- **No RBAC** — all users see all data
- **No earnings tracking** — cannot process payroll
- **No per-rep targets** — dashboard shows hard-coded targets
- **No per-rep dashboard** — reps see admin view
- **No Healthy Home branding** — dashboard is generic
- **Not mobile-optimized** — primary use case is field reps on phones

---

## NEXT STEPS

1. **Approve redesign spec** ← You are here
2. **Implement RBAC system** (1-2 days)
3. **Rebuild dashboards with rep views** (3-4 days)
4. **Fix data gaps** (1-2 days)
5. **Rebrand & optimize mobile** (2-3 days)
6. **Testing & deployment** (1-2 days)

**Total estimated time:** 10-15 business days

---

**Report prepared by:** Full-stack engineering analysis  
**Database version:** PostgreSQL 13 (Supabase)  
**API version:** Express + Drizzle ORM  
**Frontend:** React + Wouter + TailwindCSS

