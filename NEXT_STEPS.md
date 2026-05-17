# MackWash Receptionist Mode — Next Steps for Zak

**Date:** May 13, 2026  
**Priority:** 🔴 Same-day action items

---

## 1. Identify the 2 Closed Leads (TODAY)

Mack said he closed 2 leads from yesterday. We need to:

1. **Ask Mack:** Which 2 customers did you close?
2. **Get their names/numbers** from Mack
3. **Find them in the recent leads list:**
   - Brian (+16786987946)
   - Russ Sharpe (+17708710698)
   - Robin Riggsbee (+16786188833)
   - Chante Freeman (+16787041143)
   - Lokesh Mondal (+15713539495)
   - Katrelle Tyson Pollard (+16785925527)
   - Rick Cairnes (+17705272183)

4. **Update their status in Swell CRM:**
   - Mark as "closed" or "booked" (depending on CRM field naming)
   - Add booking notes if available

5. **Log conversion data for Facebook:**
   - This data is critical for Facebook pixel optimization (CAPI)
   - Without it, FB doesn't learn which leads convert
   - Next campaigns will be less targeted without this feedback

---

## 2. Brief Mack on New Workflow (OPTIONAL)

If Mack hasn't already been told:

> "Your new Hayden flow: when someone texts, Hayden will greet them, ask what they need, gather their address and property details, then hand off to you in Discord with everything pre-filled. You just text them the estimate and close. No more AI quotes — everything is yours."

This keeps Mack in control while reducing his initial friction (Hayden does the warm greeting + basic qualification).

---

## 3. Monitor 1st Day of New Flow

**Watch for:**
- ✅ Does Hayden greet correctly as receptionist?
- ✅ Does Hayden ask for address/details without pricing?
- ✅ Does Discord thread appear with `info_complete` tag?
- ✅ Can Mack accept/decline in Discord?
- ✅ Two-way SMS bridge working (Mack texts in thread, customer sees it)?

**If issues:**
- Check Swell server logs: `/Users/zak/.openclaw/workspace/swell/`
- Check Discord bot token is valid (hasn't been revoked)
- Check Twilio SMS still working (low balance again?)

---

## 4. Conversion Data → Facebook (DAILY)

**Process:**
1. End of day, Mack tells you which leads converted
2. You mark them in Swell CRM as "closed/booked"
3. Swell's CAPI integration fires "Purchase" event to Facebook
4. FB pixel learns which lead sources convert best
5. Next campaign is more targeted

**Why this matters:**
- Without conversion feedback, FB ads become random
- You're currently paying $25/day ad spend with zero feedback
- Even manual updates help FB optimize next week's spend
- This is the ROI measurement loop

---

## 5. Hayden Owner Chat (Already Live)

Mack can now text his MackWash number:
- "How many leads today?" → Hayden replies with stats
- "What's my reply rate?" → Hayden shows metrics
- All responses logged to Discord

No action needed — it's live. Just make sure Mack knows he can use it.

---

## 6. Next Week: Facebook Campaign Optimization

Once you have 1-2 days of conversion data:
- Update Facebook campaign targeting (look for winning interests/locations)
- Adjust bid strategy based on CAPI feedback
- Consider scaling winning ad sets
- Pause underperforming ones

---

## Quick Checklist

- [ ] Ask Mack for the 2 closed leads from yesterday
- [ ] Update their status in Swell CRM
- [ ] Log conversion data to Facebook (via CAPI)
- [ ] Watch 1st new lead flow through new receptionist mode
- [ ] Check Discord thread creation works
- [ ] Brief Mack on workflow if needed
- [ ] Monitor Twilio balance stays positive
- [ ] Test Mack can text for stats

---

## Contact Points

**Swell Admin Dashboard:**
- URL: https://mackwash.nopressurelaunch.com
- Username: `mackwash`
- Password: `nopressure`

**Database Queries (if needed):**
- Supabase console: [Blue Ocean project](https://app.supabase.com)
- Lead table: `swell_leads` (filter by tenant_id = 'mackwash')
- Conversations: `swell_conversations`
- Check SMS status: `swell_conversation_messages`

**Emergency Contacts:**
- Mack: (470) 874-1267
- Discord: Look for @Mack (ID: 1327340335675736125) in MackWash guild

---

**Status:** Configuration deployed ✅  
**Last updated:** 2026-05-13 14:10 EDT
