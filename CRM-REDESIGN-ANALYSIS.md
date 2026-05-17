# Healthy Home CRM — DEEP ANALYSIS & FINAL IMPLEMENTATION PLAN

**Date:** May 15, 2026  
**Status:** Analysis Phase (Ready for your feedback)

---

## EXECUTIVE SUMMARY

The existing 4-phase plan is solid, but **incomplete**. It covers UI/UX and data fixes but misses:

1. **Authentication system** (currently just a password, no per-user roles)
2. **Business logic definition** (how targets work, how commissions are calculated, what "good conversation" means)
3. **Multi-tenant strategy** (Healthy Home vs WPW — separate CRMs or one unified?)
4. **Real-time updates** (do dashboards need live refresh or polling is fine?)
5. **Mobile strategy** (responsive web only, or native apps?)
6. **Integration sequencing** (which integrations must work before launch?)

---

## PART 1: CURRENT STATE INVENTORY

### What's Already Built ✅

| Component | Status | Notes |
|-----------|--------|-------|
| **Database schema** | ✅ Complete | 27 tables, all major entities covered |
| **API routes** | ✅ Complete | 40+ endpoints (earnings, campaigns, jobs, etc.) |
| **Dashboard pages** | ✅ Partial | 18 pages exist but need RBAC filtering + styling |
| **RBAC framework** | ⚠️ Skeleton | `rbac.ts` defined but not integrated |
| **Auth system** | ❌ Stub | Just a single password, no user/role management |
| **Twilio SMS** | ✅ Working | SMS sending, inbound handling |
| **Facebook Lead Ads** | ⚠️ Broken | 115 pending logs (harmless logging bug — leads are in DB) |
| **Discord integration** | ✅ Working | Lead notifications, thread creation |
| **VAPI (voice)** | ✅ Working | Minimal usage, ready to expand |

### What's Missing ❌

| Component | Impact | Effort |
|-----------|--------|--------|
| **Per-user authentication** | CRITICAL | Users can't be identified; can't filter data by rep |
| **Rep target management** | HIGH | Can't set daily/weekly goals per rep |
| **Earnings backfill** | HIGH | Can't calculate commissions; payroll impossible |
| **RBAC enforcement** | HIGH | All users see all data (security issue) |
| **Healthy Home branding** | MEDIUM | Dashboard is generic, no colors/logo |
| **Mobile optimization** | MEDIUM | Reps in field will struggle with desktop layout |
| **Canvassing sync** | MEDIUM | D2D app data not in new schema |
| **Job photo uploads** | MEDIUM | Photos captured but not linked to jobs |
| **Campaign execution** | MEDIUM | Campaigns 3 & 4 stuck, status inconsistent |
| **Review workflow** | MEDIUM | Never fires, no satisfaction tracking |

---

## PART 2: CRITICAL BUSINESS LOGIC QUESTIONS

Before we code, I need to understand:

### A. REP TARGETS & GOALS

**Q1: How are daily targets set?**
- [ ] Hardcoded same for all reps?
- [ ] Configurable per-rep by Zak?
- [ ] Seasonal/dynamic based on historical performance?
- [ ] **What's the target breakdown?**
  - Conversations: 20/day (fixed?)
  - Closes: 4/day (fixed?)
  - Revenue: $1,200/day (fixed?)

**Q2: What's a "good conversation"?**
- [ ] Any response to outreach?
- [ ] SMS reply from customer?
- [ ] Customer says "yes, interested"?
- [ ] Customer asks about pricing?
- [ ] How is this tracked in the system?

**Q3: How do reps view their progress?**
- [ ] Real-time dashboard auto-refresh every X seconds?
- [ ] Manual refresh button (lower server load)?
- [ ] Daily summary email at EOD?

---

### B. COMMISSION & EARNINGS LOGIC

**Q4: How are rep commissions calculated?**
- [ ] Flat % of deal value (e.g., 15% of $400 job = $60)?
- [ ] Tiered % (e.g., 10% under $300, 15% $300-600, 20% over)?
- [ ] Flat fee per close (e.g., $75/close)?
- [ ] Hybrid (% + bonus for hitting targets)?
- [ ] **Who gets the commission?**
  - The rep who knocked the door?
  - The rep who closed the sale?
  - The rep who scheduled the job?
  - All three split it?

**Q5: When is commission paid out?**
- [ ] On sale (when lead becomes "quoted")?
- [ ] On job completion (when tech finishes)?
- [ ] On payment received (when customer pays)?
- [ ] Weekly batch on Friday?

**Q6: What about refunds/cancellations?**
- [ ] Commission clawed back immediately?
- [ ] Marked as "disputed" and reviewed manually?
- [ ] Held for X days then returned to rep?

**Q7: How are technicians paid?**
- [ ] Hourly rate (clock in/out tracked)?
- [ ] Flat fee per job (e.g., $50/house wash)?
- [ ] Hybrid (hourly + bonus for customer reviews)?
- [ ] **What's the hourly rate or per-job fee?**

---

### C. CUSTOMER OWNERSHIP & VISIBILITY

**Q8: Can multiple reps service the same customer?**
- [ ] No — once a rep sells to a customer, only they see them?
- [ ] Yes — any rep can see/service existing customers?
- [ ] Hybrid — rep who sold the customer has priority, but can reassign?

**Q9: If a customer doesn't pay, who's responsible?**
- [ ] Rep who sold them (loses commission)?
- [ ] Management (Zak/Matthew) handles collections?
- [ ] Shared (rep pays if 30+ days late)?

---

### D. BUSINESS UNIT STRATEGY

**Q10: Is Healthy Home a single business or multiple brands?**

Current state: Database tracks `businessUnit` field with values like "Healthy Home" and "WPW".

- [ ] Option A: **Unified CRM** — One dashboard for all brands, reps can see all brands' data
  - Pros: Single system, cross-brand insights
  - Cons: Reps might see other brands' data they shouldn't
  
- [ ] Option B: **Separate instances** — Each brand has its own CRM
  - Pros: Clear separation, no cross-contamination
  - Cons: Duplicate setup, can't see company-wide metrics
  
- [ ] Option C: **Admin can switch brands** — Zak sees one unified dashboard, reps see their assigned brand
  - Pros: Best of both
  - Cons: More complex RBAC

**Which is it?**

---

### E. CANVASSING & D2D SPECIFICS

**Q11: How does door-to-door canvassing workflow work?**

Current state: Schema has `d2d_touches` (232 records) and `canvassing_sessions` (1 record).

- [ ] Rep starts a "canvassing session" (logs the date/area)
- [ ] Each door knocked = 1 "touch" record
- [ ] Rep captures: address, homeowner name, whether interested, quote given, phone number
- [ ] At end of day, rep submits session with totals (X doors, Y interested, Z quoted)
- [ ] **Is the canvassing app separate from the CRM dashboard?**
  - If yes: Does app sync back to CRM after each session?
  - If no: Is the "Start Canvassing" button in the CRM dashboard?

**Q12: Are canvassing routes pre-planned?**
- [ ] Rep gets assigned a route (list of neighborhoods/streets)?
- [ ] Rep canvasses randomly in their city?
- [ ] Zak assigns canvassing areas daily?

---

### F. NOTIFICATIONS & ALERTS

**Q13: What notifications does each user need?**

**For reps (Matthew, Judah):**
- [ ] New lead assigned (SMS/push/email)?
- [ ] Job completed (notification)?
- [ ] Customer left review (alert)?
- [ ] Close to daily target (alert)?
- [ ] Job needs follow-up (reminder)?

**For techs (Naseem):**
- [ ] New job assigned?
- [ ] Job time approaching?
- [ ] Customer review posted?

**For admin (Zak):**
- [ ] Daily summary email (sales, closes, revenue)?
- [ ] Rep below target (alert)?
- [ ] Integration errors (alert)?
- [ ] Large deal closed (alert)?

---

## PART 3: TECHNICAL QUESTIONS

### G. AUTHENTICATION & MULTI-USER

**Q14: How should we handle multi-user login?**

Current state: Single password (DASHBOARD_PASSWORD env var) — anyone who knows it gets full access.

- [ ] **Option A: Simple user accounts**
  - Username + password per user
  - Role assigned in DB (admin/management/rep/tech)
  - Session stored in cookie
  - Effort: 2-3 days

- [ ] **Option B: SAML/OAuth (e.g., Google Sign-In)**
  - Users sign in with Google
  - Role managed in our DB
  - Effort: 3-5 days

- [ ] **Option C: Keep password, add role flags**
  - Single password still
  - But when logged in, prompt "Who are you?" (dropdown of users)
  - Effort: 1 day (quick fix)

**Recommendation:** Option A (proper accounts). Once Healthy Home grows, you'll want per-rep access logs, audit trails, and security.

---

### H. DEPLOYMENT & INFRASTRUCTURE

**Q15: Where should the CRM live?**
- [ ] Current Replit (`healthy-home-backend.replit.app`)?
- [ ] New Replit (separate from API)?
- [ ] Docker container (Railway, Fly, etc.)?

**Q16: Do we need high availability?**
- [ ] Single instance (crashes = downtime, but acceptable for now)?
- [ ] Multiple instances with load balancer?

**Q17: Offline support?**
- [ ] Reps must have internet (typical for SaaS)?
- [ ] Reps should work offline, sync when back online?

---

### I. REAL-TIME & PERFORMANCE

**Q18: Dashboard refresh strategy?**
- [ ] Polling every 10 seconds (simple, causes load)?
- [ ] Polling every 60 seconds (lighter, less fresh)?
- [ ] WebSockets (real-time, more complex)?
- [ ] Manual refresh button only (safest)?

**Q19: Expected concurrent users?**
- [ ] < 5 (just Zak, Matthew, maybe 1 more)?
- [ ] 5-20 (team grows, multiple reps)?
- [ ] 20+ (scaling up)?

---

### J. DATA MIGRATION & HISTORICAL DATA

**Q20: What about the existing 678 leads?**
- [ ] Backfill rep ownership (assign rep to each old lead)?
- [ ] Start fresh (keep old data but don't migrate)?
- [ ] Hybrid (import only high-value leads)?

**Q21: How far back should historical data go?**
- [ ] Only current month (simpler)?
- [ ] Last 90 days (safer)?
- [ ] Full history (all 678 leads)?

---

### K. INTEGRATIONS: PRIORITY & SEQUENCING

**Q22: Which integrations are must-have at launch?**

Rank these 1-10 (1 = can live without, 10 = must have day 1):

- [ ] Twilio SMS (lead follow-up)
- [ ] Facebook Lead Ads (inbound leads)
- [ ] Discord (notifications to Zak)
- [ ] VAPI (phone calls)
- [ ] Google Calendar (scheduling)
- [ ] Stripe (payment processing — NOT in current schema!)
- [ ] Email (Resend — currently unused)
- [ ] Review automation (SMS to customers asking for Google review)

**Q23: Should we add Stripe integration for payments?**
- [ ] Collect payments in the CRM?
- [ ] Or just reference Stripe elsewhere?
- [ ] Track "payment received" status (yes/no for now)?

---

## PART 4: REVISED 4-PHASE PLAN

### PHASE 1: FOUNDATIONS (Days 1-3)

**Goals:** Get authentication + RBAC working. Fix critical bugs.

**Tasks:**

1. **Auth system** (1.5 days)
   - [ ] Create `users` table with hashed passwords (if not exists)
   - [ ] Implement login/logout endpoints
   - [ ] Add JWT or session-based auth
   - [ ] Attach `user` to every API request
   - [ ] Implement RBAC middleware on all protected routes

2. **Bug fixes** (0.5 days)
   - [ ] Fix Facebook Lead Ads log status (update 115 pending → success)
   - [ ] Fix campaign status inconsistencies (campaigns 2, 3, 4, 5)
   - [ ] Fix canvassing session sync (migrate d2d_touches → new schema)

3. **Rep targets system** (1 day)
   - [ ] Create `hh_rep_targets` table (daily_conversations, daily_closes, daily_revenue)
   - [ ] Add endpoints to set/update targets
   - [ ] Wire targets into dashboard

4. **Earnings backfill** (1 day)
   - [ ] Write SQL to calculate commissions from existing 14 jobs
   - [ ] Populate `hh_rep_earnings` backfill
   - [ ] Create earnings trigger (on job completion or payment?)

**Deliverable:** Users can log in as themselves, see only their own data (with RBAC enforcement). Admin dashboard shows aggregated metrics. No UI styling yet.

---

### PHASE 2: CORE DASHBOARDS (Days 4-7)

**Goals:** Build the rep and admin dashboards with real data + RBAC filtering.

**Tasks:**

1. **Rep dashboard rebuild** (2 days)
   - [ ] Mobile-first layout (single column, touch-friendly)
   - [ ] Daily target tracker (progress bars)
   - [ ] Today's action items (canvassing, follow-ups)
   - [ ] Live pipeline (conversations, quotes, closes)
   - [ ] Customers list (owned by this rep only)
   - [ ] Wire in RBAC (rep can only see their own data)

2. **Admin dashboard rebuild** (2 days)
   - [ ] Overview (all reps' aggregate metrics)
   - [ ] Sales reps tab (drill into each rep's data)
   - [ ] Financial tab (earnings, commissions, collections)
   - [ ] Wire in RBAC (admin sees everything)

3. **Customer view details** (0.5 days)
   - [ ] Timeline of all interactions
   - [ ] Job history
   - [ ] Payments received
   - [ ] Reviews

4. **Jobs page** (1 day)
   - [ ] List assigned jobs
   - [ ] Job detail (customer info, service, price)
   - [ ] Photo upload (wire up the empty photos table)
   - [ ] Mark complete

**Deliverable:** Fully functional rep + admin dashboards with RBAC. Real data showing through. Mobile-friendly.

---

### PHASE 3: INTEGRATIONS & WORKFLOWS (Days 8-10)

**Goals:** Fix campaigns, review workflow, canvassing sync, SMS/Discord automation.

**Tasks:**

1. **Campaign management** (1 day)
   - [ ] Fix status inconsistencies (audit all 5 campaigns)
   - [ ] Implement campaign re-trigger (for stuck campaigns 3 & 4)
   - [ ] Build campaign editor in admin dashboard

2. **Review workflow** (1 day)
   - [ ] Implement satisfaction prompt (job completion → SMS satisfaction check)
   - [ ] Route satisfied customers to Google review request
   - [ ] Route unsatisfied to internal feedback form
   - [ ] Trigger Campaigns 3 & 4 (A/B test)

3. **Canvassing integration** (1 day)
   - [ ] Sync D2D app sessions to dashboard
   - [ ] Add "Start Canvassing" button to rep dashboard
   - [ ] Track daily canvassing activity (doors, conversations, quotes)

4. **Notifications** (0.5 days)
   - [ ] Wire up rep alerts (new lead, job assigned, review posted)
   - [ ] Wire up admin alerts (large deal, rep below target)

**Deliverable:** All automations working. Campaigns firing. Review flow active. D2D data syncing.

---

### PHASE 4: BRANDING & POLISH (Days 11-14)

**Goals:** Make it look like Healthy Home. Optimize for mobile. Test thoroughly.

**Tasks:**

1. **Brand identity** (1 day)
   - [ ] Apply Healthy Home colors (navy #0F172A, teal #3DD6C0)
   - [ ] Integrate logo (cursive + white versions)
   - [ ] Update typography (display font for headings)
   - [ ] Consistent spacing/layout

2. **Mobile optimization** (1 day)
   - [ ] Test on iPhone/Android
   - [ ] Fix touch targets (min 44px)
   - [ ] Optimize for slow connections (lazy load, compress images)
   - [ ] Vertical layout for small screens

3. **Testing & validation** (1 day)
   - [ ] User test with Matthew (rep view)
   - [ ] User test with Zak (admin view)
   - [ ] Load test (simulate 5 concurrent reps)
   - [ ] Security audit (RBAC, auth, data filtering)

4. **Deployment & monitoring** (1 day)
   - [ ] Set up error logging/alerts
   - [ ] Deploy to production Replit
   - [ ] Create runbooks (troubleshooting, manual operations)
   - [ ] Document API changes

**Deliverable:** Production-ready CRM. Branded. Mobile-friendly. Fully tested.

---

## PART 5: DEPENDENCIES & SEQUENCING

**Critical path (order matters):**

1. **Auth system** must come first (everything depends on it)
2. **RBAC** must follow auth (needed for data filtering)
3. **Earnings backfill** needed before showing financial dashboards
4. **Dashboards** need all above before they can work
5. **Integrations** can happen in parallel with dashboards
6. **Branding** can wait until end

**Parallel work:**
- Phase 1 + early Phase 2 auth work can be parallelized
- Integration fixes (Facebook logs, campaigns) can happen alongside auth

**Blockers to watch:**
- If auth takes longer than expected, dashboards are blocked
- If we don't clarify commission logic, earnings backfill is blocked
- If targets system not defined, rep dashboard goals won't work

---

## PART 6: OPEN QUESTIONS FOR YOU

I need clarity on these 23 questions before we finalize the plan:

### Business Logic (Q1-Q13)
- **Targets:** How are daily goals set? What's "good conversation"?
- **Commissions:** Flat %, tiered, or hybrid? When paid out? Refund logic?
- **Techs:** Hourly or per-job? What's the rate?
- **Customers:** Can multiple reps service same customer?
- **Business units:** One CRM for all brands or separate?
- **Canvassing:** How does workflow work? Pre-planned routes?
- **Notifications:** What alerts do reps/techs/admin need?

### Technical (Q14-K23)
- **Auth:** Proper user accounts, OAuth, or quick password fix?
- **Deployment:** Current Replit or new instance?
- **Performance:** How many concurrent users expected?
- **Real-time:** Polling, WebSockets, or manual refresh?
- **Integrations:** What's must-have vs nice-to-have?
- **Stripe:** Do we integrate payments?

---

## PART 7: RECOMMENDATIONS

**I suggest:**

1. **Use the proper 4-phase plan** — it's solid and matches reality
2. **Prioritize auth + RBAC** — the biggest blocker
3. **Get commission logic defined** — affects earnings backfill + dashboard
4. **Keep integrations flexible** — Twilio + Discord are must-haves, rest can come after
5. **Test with Matthew ASAP** — as soon as rep dashboard is usable
6. **Don't over-engineer mobile** — responsive web is fine for now (can add native app later)

---

## NEXT STEPS

1. **You answer the 23 questions** (pick an option for each, or explain your own)
2. **I refine the plan** based on your answers
3. **We finalize a detailed task breakdown** (story points, dependencies, sequence)
4. **We start Phase 1** with a clear scope

---

**What questions do you want to clarify first?**
