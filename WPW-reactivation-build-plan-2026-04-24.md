# Wolf Pack Wash Reactivation Build Plan — 2026-04-24

## Objective
Build a high-conviction reactivation campaign for past Wolf Pack Wash customers that gets prior good customers back on the schedule quickly and safely.

This is not a generic promo blast. It is a rebooking / schedule-capture campaign for prior customers.

## Key strategic decisions finalized

### 1) Audience type
This campaign is for **past customers**, not cold leads.
The messaging should lean on:
- prior service relationship
- familiarity
- ease of getting back on schedule
- continuity
- same-rate retention angle

### 2) Risk constraint
Some customers received a duplicate charge months after service last year. They may not have directly associated it with Wolf Pack Wash, but this creates real reactivation risk.

Because of that:
- list hygiene and segmentation are critical
- risky/problem customers should not be included in the first wave
- messaging should be warm and smooth, not aggressive or sloppy

### 3) Offer angle
Primary campaign hook:
- **keep your same rate from last year**

Preferred message structure:
- "Last year we washed your house at [address]. If you want to get back on the schedule, click here. Click here to keep your same rate from last year."

Final wording still to be tightened, but the pricing strategy decision is:
- lean on **same-rate protection from last year**
- ideally personalize by prior address/service history
- avoid using the generic $199 acquisition pitch for this reactivation flow

### 4) Sender identity
Do not use Zak.
Preferred assistant identity for outbound messaging:
- **Robin**

Recommended format:
- "Robin with Wolf Pack Wash"

Reasoning:
- human and conversational
- not overly salesy
- coherent with the assistant-led reactivation/scheduling system

### 5) Channels
This should be a **multi-touch SMS + email funnel**.

Preferred sequence:
- Day 1: SMS 1
- Day 2: SMS 2 to non-responders / non-clickers
- Day 3: Email 1
- Day 5: Email 2
- Day 6/7: SMS 3 final bump

### 6) Landing / booking flow direction
Initial plan was a preference picker.
The stronger direction discussed is a **calendar-backed slot picker** with real availability controls.

Preferred user experience:
- customer clicks tracked link
- mobile-optimized scheduling page opens
- customer sees allowed dates/time windows
- customer selects slot
- slot is written to Google Calendar or held through calendar-backed logic
- system prevents double booking
- customer sees confirmed success state

### 7) Confirmation language direction
User prefers stronger language than "we'll confirm shortly."
Current preferred post-booking message direction:
- **"Thanks, we've confirmed your appointment."**

Follow-up enhancements desired:
- Add to Calendar button if possible
- automatic confirmation email after booking
- optionally invite them to the calendar event directly

### 8) Calendar direction
User likes the idea of using Google Calendar so:
- time slots can be blocked as they fill
- schedule appears fuller / more real
- double-booking risk is reduced

Most likely strongest implementation path:
- controlled live slot picker
- real slot inventory
- Google Calendar write/invite flow
- customer-facing hard confirmation only if booking logic is reliable

## Backend/data findings checked today
Local Healthy Home / Wolf Pack Wash backend structure appears to support the needed data model.

### Customer data available in schema
- firstName
- lastName
- phone
- email
- address
- city
- state
- zip
- notes
- optOut
- reviewCampaignEligible

### Job data available in schema
- serviceType
- packageType
- quotedPrice
- soldPrice
- paymentStatus
- paymentAmountCollected
- scheduledAt
- completedAt
- notes

### Review / customer quality data available in schema
- review workflow records
- satisfactionScore
- issue flags
- delivery status/log fields
- review campaign eligibility markers

This suggests we should be able to segment by:
- prior service type
- prior amount paid / sold price
- last service date
- notes
- review/satisfaction history
- flagged issue status

## Recommended segmentation logic

### Tier 1 — safest first-wave list
Include customers with:
- completed prior job
- valid phone and/or email
- no opt-out / unsubscribe
- no flagged issue
- no known refund/dispute/chargeback problem
- ideally positive review/satisfaction history

### Tier 2 — manual review bucket
- completed prior job
- valid contact info
- unclear notes
- unclear satisfaction history
- no explicit issue flag but not clean enough to auto-send first

### Tier 3 — exclude from first campaign
- flagged issues
- refund/dispute/chargeback history
- negative review workflow / service recovery cases
- suspicious notes tied to billing problems
- invalid contact info / opt-outs

### Strong first audience idea
User believes there may be a table with review follow-ups from customers.
Best first-wave list likely:
- prior customers with **4-star and 5-star** outcomes
- positive satisfaction / review history
- no issue flags

This is likely the safest and highest-converting starting segment.

## Funnel strategy

### Core objective
Not to re-sell from scratch.
Instead:
- rebook prior customers
- get them back on the schedule fast
- create a low-friction slot-selection path
- track every touch and conversion event

### Messaging angle
Positioning should be:
- it's that time of year
- your home is likely due again
- you're a past customer
- you can keep your same rate from last year
- getting back on the schedule is easy

### SMS notes
First SMS should include company identification.
Recommended format:
- "Hey [First Name], this is Robin with Wolf Pack Wash..."

Reason:
- reduces scam feel
- improves trust/compliance
- avoids "who is this?"

### Email/landing notes
No need to use Robin in the landing page headline.
Landing page headline should stay simple.
Examples discussed:
- Pick Your Preferred Day
- Choose Your Spot on the Schedule
- Get Back on the Schedule

## Tracking and reporting requirements
Need campaign tracking across links and downstream conversion points.

### SMS realistic metrics
SMS typically cannot provide reliable open rates like email.
What should be tracked instead:
- sent
- delivered
- failed
- clicked
- replied
- opted out / STOP

## Immediate build priorities (updated 2026-04-25)

### 1) Reactivation campaign first
- finish DNC / suppression hygiene
- finalize reactivation-safe audience
- launch and test the reactivation campaign end-to-end
- confirm reply handling, tracking, and human handoff before scaling

### 2) Nurture system is the next major priority
This is one of the highest-leverage next builds after reactivation is running.

Required direction:
- build a reusable nurture / reply-handling system, not a one-off script
- first immediate follow-on use case: **Harris Bros** because conversion is weak and follow-up needs improvement
- long-term use cases: Wolf Pack Wash Meta leads, Harris Bros Meta leads, and eventually all inbound lead channels across brands

### 3) Discord lead ops improvements
Need lead-thread workflow inside Discord so sales can work from the thread itself.

Desired behavior:
- new leads continue landing in **#leads**
- booked / confirmed jobs post to **#bookings**
- inside lead threads, reps should be able to update lead status directly from Discord
- status changes should sync back to CRM / lead records

Recommended status options to support in Discord first:
- New
- Contacted
- Qualified
- Quote Sent
- Booked
- Won
- Lost
- DNC

### 4) Reactivation reply-handling requirements
Incoming replies from reactivation campaigns should be watched and classified.

Core routing rules:
- **Opt-out / do-not-contact** language → immediately mark for DNC / suppression handling
- **Simple pricing question where prior known price can answer cleanly** → eligible for AI-assisted response
- **Anything requiring recalculation or human judgment** → route to salesperson / Discord for takeover

Examples that should route to human / Discord:
- wants add-on services
- wants a new quote
- moved / new property
- needs recalculated pricing
- anything ambiguous or multi-part

### 5) Reactivation Discord handoff requirement
When a reactivation reply becomes a real opportunity or needs a person:
- create or update a lead thread in **#leads**
- clearly label it as a **reactivation campaign lead**
- include the incoming message and customer context
- assign / route to a salesperson for follow-up

## Implementation note
Best architecture is likely:
- one shared inbound-reply classification layer
- one shared human-handoff path into Discord + CRM
- channel-specific adapters (reactivation SMS, Meta leads, website, etc.) on top

That keeps the Harris Bros + Wolf Pack + future brands from turning into separate brittle systems.
