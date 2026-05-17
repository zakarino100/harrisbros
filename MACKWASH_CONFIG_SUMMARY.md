# MackWash Hayden Configuration — Receptionist Mode

**Effective:** May 13, 2026 14:10 EDT  
**Changes by:** Robin (Assistant)  
**Status:** ✅ DEPLOYED

---

## Summary

MackWash's Hayden AI has been reconfigured to operate as an **intake receptionist** rather than a closer. Hayden gathers customer information and hands off to Mack for all pricing and booking discussions.

---

## What Changed

### 1. **Model** ✅ Sonnet (High Quality)
- **Previous:** Default/Haiku
- **New:** Claude Sonnet 4.6
- **Why:** Receptionist mode requires more nuanced multi-turn conversations, qualification questions, and objection handling

### 2. **Persona Script** ✅ Receptionist Mode (info-gathering only)
Hayden's system prompt now includes:

```
# RECEPTIONIST MODE — GATHER INFO, NO QUOTES

You are now operating in RECEPTIONIST MODE for MackWash. Your job is to be 
friendly, professional, and gather all information Mack needs to provide an 
exact quote. You do NOT provide pricing or estimates yourself.
```

**Exact flow:**
1. Greet & introduce Hayden
2. Ask: What service? (house wash, concrete, driveway, etc.)
3. Gather info:
   - Full service address
   - When last done? (helps estimate condition)
   - Approximate property size or details
   - Special requests/concerns
4. Close & hand off:
   - "Perfect! I have everything I need. Someone will reach out shortly with exact estimate."
   - Output: `<<HANDOFF: info_complete>>`

**Hard rules:**
- ❌ NO pricing or estimates
- ❌ NO appointment commitments ("Tuesday at 3pm")
- ❌ NO "I'll email you" (SMS only)
- ❌ NO asking "ready to book" (that's Mack's job)

**If customer asks for price:**
- "Great question. Prices vary based on specifics, so I want to make sure you get an exact quote. Let me have someone reach out today with a number tailored to your property."

---

## Handoff Process

### When Hayden Hands Off
- Outputs: `<<HANDOFF: info_complete>>`
- Discord thread created automatically
- Mack sees:
  - Full SMS conversation transcript
  - All gathered info (address, property details, etc.)
  - Handoff reason: "info_complete"
- Thread gets Accept/Decline buttons
- On accept: thread opens for Mack to text customer

### Mack's Next Steps
1. **Accept** the lead in Discord
2. **Text the customer** with exact estimate and next steps
3. **Close the deal** (negotiate, book, collect payment)
4. **Mark lead as closed** in CRM when done

---

## Critical: Twilio Credits Restored

**Status:** ✅ Credits have been added to Twilio account  
**Action:** Messages can now send again

⚠️ **DO NOT retry old messages** to leads from the outage period (when credits were depleted). Hayden will begin new conversations normally with fresh leads.

---

## Recent Lead Status (May 12-13, 2026)

7 leads created in last 2 days:
1. Brian (5/13, 10:34 AM) - Conv 33, active
2. Russ Sharpe (5/13, 10:34 AM) - Conv 32, active
3. Robin Riggsbee (5/12, 09:34 PM) - Conv 31, active
4. Chante Freeman (5/12, 04:34 PM) - Conv 30, active
5. Rick Cairnes (5/11, 02:34 PM) - Conv 27, active
6. Lokesh Mondal (5/12, 12:34 PM) - Conv 29, active
7. Katrelle Pollard (5/12, 09:34 AM) - Conv 28, active

**Mack mentioned 2 closed leads from yesterday** — need to identify which ones and mark status in CRM. Robin will ask Mack which customers he closed.

---

## Owner SMS Chat (Already Active)

Mack can text his MackWash number with questions:

- "How many leads came in today?" → Hayden replies with stats
- "Tell me about the lead named John" → Hayden looks up info
- "What's my reply rate?" → Hayden shows metrics

**Scope:**
- ✅ Lead stats, performance metrics, activity summaries
- ✅ Status of individual leads by name/phone
- ❌ Platform costs, other client data, internal pricing strategy

**Logging:** All owner SMS exchanges are posted to Discord #leads channel for transparency.

---

## Next Steps

1. **Mack identifies the 2 closed leads** from yesterday → Robin marks them in CRM
2. **First new lead test** → Watch for Hayden's greeting + info-gathering in new receptionist mode
3. **Handoff test** → Verify Discord thread creation and Mack's accept/decline workflow
4. **Monitor 1st day** → Watch for any issues or tweaks needed
5. **Brief Mack** (if needed) on the new handoff flow in Discord

---

## Files Updated

- `MEMORY.md` — Added section on MackWash receptionist mode change
- Supabase `swell_ai_configs` table — Updated `custom_brand_notes` for `mackwash` tenant
- `MACKWASH_CONFIG_SUMMARY.md` (this file) — Documentation of the change

---

## Contacts

- **Mack:** (470) 874-1267 | Discord: 1327340335675736125
- **Hayden Bot Token:** Managed in Swell Replit environment
- **Database:** Supabase PostgreSQL (Blue Ocean project)

---

**Questions?** DM Zak or check the Swell admin dashboard at `mackwash.nopressurelaunch.com`
