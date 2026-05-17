# Healthy Home CRM — Implementation Guide

## Overview

This guide provides step-by-step instructions to deploy the Healthy Home CRM redesign. The redesign includes:
- ✅ RBAC system (role-based access control)
- ✅ Rep dashboard (mobile-first)
- ✅ Admin dashboard (full visibility)
- ✅ Healthy Home branding (logo, colors)
- ⏳ Campaign fixes (status inconsistencies)
- ⏳ Earnings backfill (payroll system)

---

## WHAT'S BEEN IMPLEMENTED

### 1. RBAC Middleware (`src/lib/rbac.ts`)
- ✅ Role checking functions
- ✅ Permission validators for different features
- ✅ Data filtering helpers

**Status:** Ready to integrate into routes

**Next step:** Wire into auth middleware in `app.ts`

### 2. Rep Dashboard (`src/pages/dashboard-rep.tsx`)
- ✅ Mobile-first design
- ✅ Daily targets tracker with progress bars
- ✅ Quick action buttons
- ✅ Activity pipeline (doors, quotes, closes, avg ticket)
- ✅ Tomorrow's schedule
- ✅ Recent customers list

**Status:** React component ready

**Next step:** Integrate API endpoint for data fetching

### 3. Rep Dashboard API (`src/routes/dashboard-rep.ts`)
- ✅ `GET /api/dashboard/rep/today` — rep's daily metrics
- ✅ `GET /api/dashboard/rep/:repId/weekly` — 7-day metrics
- ✅ `GET /api/dashboard/rep/:repId/targets` — daily targets

**Status:** Express routes ready

**Next step:** Mount in `app.ts` router

### 4. Admin Dashboard API (`src/routes/dashboard-admin.ts`)
- ✅ `GET /api/dashboard/admin/overview` — all reps' aggregate metrics
- ✅ `GET /api/dashboard/admin/reps` — list of all reps with stats
- ✅ `GET /api/dashboard/admin/financial` — revenue, collections, outstanding

**Status:** Express routes ready

**Next step:** Mount in `app.ts` router

### 5. Branding Updates
- ✅ Logo files copied to `public/` folder (cursive & white versions)
- ✅ Layout component updated to use actual Healthy Home logo
- ✅ Sidebar color scheme changed to navy/teal
- ✅ Top bar changed to dark gray/navy gradient

**Status:** Visual changes applied

**Next step:** Rebuild and verify

### 6. App Router Updated
- ✅ Added `/rep` route pointing to `DashboardRep` component

**Status:** Navigation ready

**Next step:** Test on mobile

---

## WHAT STILL NEEDS TO BE DONE

### Phase 1: Critical (This Week)

#### 1.1 Backfill Earnings Tables
**File:** `migrations/backfill-earnings.sql`

**Action:**
```bash
PGPASSWORD='Eaglesfan1998$' psql -h aws-1-us-east-1.pooler.supabase.com \
  -U postgres.hclpovktywijfnswthpm -d postgres -p 5432 < migrations/backfill-earnings.sql
```

**What it does:**
- Scans all completed jobs
- Calculates 20% commission for each rep
- Populates `hh_rep_earnings` table

**Expected result:** 
- Should populate 14+ earnings records (one per completed job)
- Shows total commissions owed

#### 1.2 Fix Campaign Status Inconsistencies
**File:** `artifacts/api-server/src/routes/campaigns.ts` (update needed)

**Action:**
```bash
# Audit current campaigns
PGPASSWORD='Eaglesfan1998$' psql -h aws-1-us-east-1.pooler.supabase.com \
  -U postgres.hclpovktywijfnswthpm -d postgres -p 5432 << 'EOF'
  
SELECT id, name, status, total_sent, created_at FROM hh_campaigns ORDER BY id;
EOF
```

**Findings:**
- Campaign 2: Status="draft" but total_sent=20 ❌ (FIX: Change to "sent")
- Campaign 3 & 4: Status="scheduled" but never sent ❌ (FIX: Trigger send or set to "draft")
- Campaign 5: Status="scheduled" but total_sent=80 ❌ (FIX: Change to "sent")

**Action items:**
1. Update campaign 2 status to "sent"
2. Decide: retry campaigns 3 & 4 or cancel them
3. Update campaign 5 status to "sent"

#### 1.3 Process Facebook Lead Ads Pending Records
**Status:** 115 pending records not being processed

**Action:**
1. Check webhook handler for facebook_lead_ads
2. Review pending records (probably stuck due to old date)
3. Either:
   - Mark as "processed" or "discarded"
   - Or re-trigger processing with retry logic

### Phase 2: Integration (Next Week)

#### 2.1 Mount New Routes in API
**File:** `artifacts/api-server/src/app.ts`

**Action:**
Add to route imports and mounting:
```typescript
import dashboardRepRouter from "./routes/dashboard-rep";
import dashboardAdminRouter from "./routes/dashboard-admin";

// After existing routes:
app.use("/api/dashboard/rep", dashboardRepRouter);
app.use("/api/dashboard/admin", dashboardAdminRouter);
```

#### 2.2 Wire Auth Middleware
**File:** `artifacts/api-server/src/app.ts`

**Action:**
- Implement proper user parsing from cookie/session
- Add `req.user` population
- Apply RBAC checks to sensitive endpoints

#### 2.3 Create React API Client
**File:** `src/api/dashboard-rep.ts` (create new)

**Action:**
Create React Query hooks for new API endpoints:
```typescript
export function useRepDashboardToday(repId: number) {
  return useQuery({
    queryKey: ["dashboard", "rep", repId, "today"],
    queryFn: () => fetch(`/api/dashboard/rep/today?repId=${repId}`).then(r => r.json()),
  });
}
```

### Phase 3: Testing & Refinement

#### 3.1 Mobile Testing
- Test rep dashboard on iPhone 12, Android device
- Verify touch targets (44px minimum)
- Test on slow 4G connection

#### 3.2 Functionality Testing
- [ ] Rep logs in, sees only their own data
- [ ] Admin logs in, sees all reps' data
- [ ] Daily targets progress bars update correctly
- [ ] Scheduled jobs appear on dashboard
- [ ] Campaign metrics visible in admin dashboard

#### 3.3 Performance
- [ ] Dashboard loads in <2s on mobile
- [ ] No N+1 queries in API endpoints
- [ ] Profile weekly endpoint performance

---

## DEPLOYMENT CHECKLIST

### Pre-Deployment
- [ ] Run database migrations
- [ ] Fix campaign statuses
- [ ] Process pending Facebook lead records
- [ ] Test auth flow (who can see what)
- [ ] Mobile testing on 2+ devices
- [ ] API endpoint testing with Postman/curl

### Deployment Steps

1. **Build dashboard:**
   ```bash
   cd artifacts/dashboard
   npm run build
   ```

2. **Copy build to API server's public folder:**
   ```bash
   cp -r dist/* ../api-server/dist/
   ```

3. **Deploy API server to Railway:**
   ```bash
   cd artifacts/api-server
   npm run build
   # Commit and push (Railway auto-deploys)
   ```

4. **Verify in production:**
   - Visit https://healthy-home-backend-production.up.railway.app
   - Login with password
   - Test admin dashboard
   - Test rep dashboard (/rep)

### Post-Deployment
- [ ] Monitor logs for errors
- [ ] Check integration logs (Discord, SMS, Facebook)
- [ ] Verify earnings calculations are correct
- [ ] Get feedback from Matthew (rep view) and Zak (admin view)

---

## KEY FILES & LOCATIONS

| Component | File | Status |
|-----------|------|--------|
| RBAC System | `src/lib/rbac.ts` | ✅ Ready |
| Rep Dashboard UI | `src/pages/dashboard-rep.tsx` | ✅ Ready |
| Rep Dashboard API | `src/routes/dashboard-rep.ts` | ✅ Ready |
| Admin Dashboard API | `src/routes/dashboard-admin.ts` | ✅ Ready |
| Earnings Migration | `migrations/backfill-earnings.sql` | ✅ Ready |
| Layout (Branding) | `src/components/layout.tsx` | ✅ Updated |
| Router | `src/App.tsx` | ✅ Updated |
| Logos | `public/hh-logo-*.png` | ✅ Copied |

---

## CRITICAL DATA FIXES

### Earnings Backfill
```sql
-- Run this to populate hh_rep_earnings
-- See: migrations/backfill-earnings.sql
PGPASSWORD='...' psql ... < migrations/backfill-earnings.sql
```

### Campaign Status Fix
```sql
-- Fix campaign statuses
UPDATE hh_campaigns SET status = 'sent' WHERE id = 2;
UPDATE hh_campaigns SET status = 'cancelled' WHERE id IN (3, 4) AND total_sent = 0;
UPDATE hh_campaigns SET status = 'sent' WHERE id = 5;
```

---

## TESTING SCRIPT

```bash
#!/bin/bash

# Test rep dashboard endpoint
echo "Testing rep dashboard..."
curl -s http://localhost:3000/api/dashboard/rep/today?repId=3 | jq .

# Test admin dashboard overview
echo "Testing admin dashboard..."
curl -s http://localhost:3000/api/dashboard/admin/overview | jq .

# Test rep list
echo "Testing rep list..."
curl -s http://localhost:3000/api/dashboard/admin/reps | jq .
```

---

## TROUBLESHOOTING

### Rep dashboard shows "Rep not found"
- Check that `repId` in API matches existing user ID in `hh_users`
- Matthew Lindner = user ID 4
- Judah Turrentine = user ID 3

### Earnings calculations seem wrong
- Run backfill migration again
- Check `hh_settings.tech_commission_config` is correct
- Verify job.sold_price values are populated

### Campaign status won't update
- Check cascade constraints on hh_campaigns → hh_campaign_sends
- Ensure no foreign key violations

---

## NEXT FEATURES (Post-MVP)

1. **Earnings Dashboard**
   - Show rep all their earnings
   - Payout status (pending, pending_review, paid)
   - Monthly summaries

2. **Per-Rep Targets**
   - Create `hh_rep_targets` table
   - Let admin set targets per rep per day
   - Show progress vs targets

3. **Customer History View**
   - When clicking customer, show all jobs, payments, interactions
   - Phone/SMS history
   - Review status

4. **Live Canvassing Map**
   - Real-time location of reps in field
   - Heat map of door knocks
   - Route optimization

5. **Campaign Performance Dashboard**
   - SMS send/reply stats
   - A/B test results (campaigns 3 & 4)
   - ROI calculations

---

## QUESTIONS & SUPPORT

**Q: When will reps see their own data vs admin's?**
A: After auth middleware is wired. For now, pass `?repId=3` (Matthew) to see rep view.

**Q: How do I test the rep dashboard locally?**
A: 
```bash
cd artifacts/dashboard
npm install
npm run dev
# Visit http://localhost:5173/rep
```

**Q: Who's the admin user?**
A: Zak (user ID 1). Matthew (ID 4) is management.

---

**Report generated:** May 14, 2026  
**Prepared by:** Full-stack engineering analysis

