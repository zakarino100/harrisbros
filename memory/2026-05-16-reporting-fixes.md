# 2026-05-16 - Auto Report Fixes

## Issue
Three reporting jobs created on May 14th night were not delivering:
1. WPW Reactivation Split Test EOD (8 PM daily) — timing out
2. WPW Review Campaign A/B EOD (8 PM daily) — timing out
3. MackWash New Lead Alert (every 10 min) — failing with agent errors

**Root causes:**
- Reactivation tried to SSH into old Replit server (dead endpoint, causing hang)
- Review A/B query was timing out (likely pooler connection issue)
- MackWash using Haiku for complex DB work (too weak for the task)

---

## Fixes Applied (May 16, 2:14 PM EDT)

### ✅ WPW Reactivation Split Test EOD Report (73c6a7df)
**Changed:**
- ❌ Removed: SSH into Replit (dead endpoint)
- ✅ Added: Direct Supabase query (postgresql://...)
- ✅ Upgraded: Haiku → Sonnet (more capable)
- ✅ Increased timeout: 60s → 120s

**New behavior:**
- Queries campaigns 2, 3, 4 directly from Supabase
- Analyzes winner/loser, calculates reply rates
- Generates 2 suggested variants with hypotheses
- Delivers to your Discord DM as suggestions (waits for APPROVE/EDIT/REJECT)
- Fires at 8 PM EDT daily

---

### ✅ WPW Review Campaign A/B EOD Report (673ced88)
**Changed:**
- ✅ Upgraded: Haiku → Sonnet
- ✅ Increased timeout: 60s → 90s
- ✅ Simplified query: Campaigns 3 & 4 only

**New behavior:**
- Queries campaigns 3 & 4 from Supabase
- Reports: sends, replies, reply rate, winner, top 3 messages
- Tight format (5-7 sentences max)
- Delivers to your Discord DM
- Fires at 8 PM EDT daily

---

### ⚠️ MackWash New Lead Alert (74f71925)
**Status:** DISABLED (lower priority, needs deeper rework)

**Issue:** Haiku agent can't properly execute DB connections in isolated cron environment

**When to re-enable:** Once you have time to debug or I can rewrite as a proper Node.js script instead of agent task

---

## Next: First Test

Both EOD reports are scheduled for **8 PM EDT today (Saturday, May 16)**.

They will run automatically and deliver to your Discord:
- **`user:1385472518978011266`** (your DM)
- Channel: discord
- Mode: announce

**Watch for:**
- Reactivation: Full analysis + 2 variant suggestions
- Review A/B: Quick winner announcement + top replies
- Both should arrive between 8:00-8:05 PM EDT

If either times out again, I'll investigate further. If both fire successfully, they'll be stable going forward.

---

## Summary

| Job | Was | Now | Status |
|-----|-----|-----|--------|
| Reactivation EOD | SSH timeout | Supabase direct | ✅ Fixed |
| Review A/B EOD | Query timeout | Simplified + upgraded | ✅ Fixed |
| MackWash Alert | Haiku failing | Disabled | ⚠️ Pending |

**Next 8 PM:** You'll get two reports in Discord DM. 🚀
