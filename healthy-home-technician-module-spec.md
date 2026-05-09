# Healthy Home OS — Technician Module Spec
**Version:** 1.1  
**Target:** Replit Agent  
**Depends on:** Healthy Home OS backend/base system already existing or in progress

---

## READ THIS FIRST — Instructions for Replit Agent

This spec **extends** the existing Healthy Home OS.  
Do **not** rebuild anything that already exists.

The Healthy Home system is evolving into a unified internal operating system for:
- admin / owner
- canvassers / sales reps
- technicians / service people

Your job in this spec is to extend the existing Healthy Home app/backend to support **technician operations** cleanly and practically.

### Follow these rules exactly
1. Inspect the current codebase first and extend what already exists.
2. Do not rebuild the app from scratch.
3. Do not create a separate backend for technicians.
4. Backend correctness and role-safe permissions matter more than frontend polish.
5. Build in phases.
6. Reuse the existing backend models, routes, auth, and UI where reasonable.
7. Keep the system practical for a real home services operation.
8. Do not over-engineer location tracking, maps, or notifications in this phase.

---

## Amendments / implementation guardrails

Before implementation, follow these additional rules:

1. Use **resource-scoped permissions**, not only blanket route-level admin restrictions. Technicians should only be able to access the customer/job data needed for their own assigned jobs.
2. When a technician marks a job as completed, update both:
   - `Job.technicianStatus = completed`
   - `Job.status = completed`
   and trigger the same content/review workflow logic as the existing admin complete-job flow.
3. Register static routes like `/upcoming` before dynamic `/:id` routes to avoid route matching bugs.
4. Make location sharing visibly stateful in the technician UI:
   - clearly show when location sharing is active
   - only send pings while technician is actively working a job
   - stop on completion, shift end, logout, or page exit
5. If practical, include `customerInterestLevel` on upsell flags with values:
   - `low`
   - `medium`
   - `high`
6. Keep issue/follow-up structures simple, but design them so they can later evolve into a broader task/issue management layer.

---

# Product overview

Healthy Home is a home services / exterior cleaning business focused on:
- House Wash
- Driveway Cleaning
- Bundle

The app already supports or is being built to support:
- canvassing
- leads
- customers
- jobs
- review workflows
- owner/admin dashboard
- reporting
- backend sync

This spec adds a **technician-facing field operations layer**.

Technicians should be able to:
- log in
- see only their assigned jobs
- update field status
- capture before/after media
- add service notes
- flag upsell opportunities
- flag follow-up issues
- optionally share active-job location
- view a small personal dashboard
- view upcoming assigned jobs/calendar

---

# Role model

The app has exactly 3 roles:

| Role | Value | Purpose |
|---|---|---|
| Owner / Admin | `admin` | Full access |
| Canvasser / Sales | `canvasser` | Leads, canvassing, sales workflow |
| Technician | `technician` | Assigned jobs only, field execution |

## Technician permissions

Technicians **can**:
- view their own assigned jobs
- view customer/job information only for assigned jobs
- update technician job status
- add job notes
- upload before/after photos
- upload from camera or camera roll
- flag upsell opportunities
- flag follow-up issues
- view their own technician dashboard
- view upcoming assigned jobs

Technicians **cannot**:
- see other technicians’ jobs
- access owner/admin dashboards
- edit leads
- view canvassing logs
- edit pricing
- cancel jobs directly
- mark upsells sold
- access broader revenue data

---

# Phase 1 — Backend schema extensions

Extend the existing schema cleanly.

## 1A. Extend Job model
Add fields like:

- `technicianStatus`
  - `en_route`
  - `arrived`
  - `in_progress`
  - `completed`
  - `issue`
  - `reschedule_requested`
- `technicianStatusUpdatedAt`
- `estimatedArrivalAt`
- `actualStartAt`
- `actualEndAt`
- `serviceDurationMinutes`
- `lastLocationLat`
- `lastLocationLng`

### Important
`technicianStatus` is field workflow.  
`job.status` is business workflow.  
They must stay aligned where appropriate, especially on completion.

---

## 1B. Add UpsellFlag model
Fields should include:
- id
- jobId
- technicianId
- serviceType
  - driveway
  - patio
  - fence
  - softwash_addon
  - repeat_maintenance
  - other
- notes
- estimatedValue (optional)
- customerInterestLevel (optional: low / medium / high)
- status
  - pending
  - reviewed
  - quoted
  - sold
  - dismissed
- reviewedBy
- reviewedAt
- createdAt
- updatedAt

### Rule
Technicians may create upsell flags, but cannot move them beyond `pending`.

---

## 1C. Add TechnicianLocation model
Fields:
- id
- userId
- jobId (optional)
- latitude
- longitude
- onShift
- recordedAt

### Rule
Keep historical pings. Do not overwrite old records.

---

## 1D. Add FollowUpFlag model
Fields:
- id
- jobId
- technicianId
- flagType
  - customer_concern
  - issue_callback
  - follow_up_needed
  - quote_opportunity
- notes
- resolved
- resolvedBy
- resolvedAt
- createdAt

---

## 1E. Add necessary relations
Add the proper relations from:
- `User`
- `Job`

for:
- upsell flags
- follow-up flags
- location pings

Do not remove existing relations.

---

# Phase 2 — Role-based and resource-scoped access

Extend the existing auth/access model.

## Required access rules
- `admin`: full access
- `technician`: only access records related to their assigned jobs
- `canvasser`: no access to technician-only routes/pages unless explicitly needed

## Important
Do not rely only on blanket route-level permissions.  
Use **resource checks** for job-specific access.

For example:
- a technician can access `/api/tech/jobs/:id` only if that job is assigned to them
- a technician can upload photos only for their own assigned job
- a technician can add notes only for their own assigned job

---

# Phase 3 — Technician backend routes

Add technician-specific routes or extend the existing route structure cleanly.

---

## 3A. Technician jobs routes
Support:
- get today’s assigned jobs
- get upcoming assigned jobs
- get single assigned job detail
- update technician job status
- add/update service notes

### Status transition rules
Allowed transitions should be enforced server-side:

- `null -> en_route`
- `en_route -> arrived`
- `arrived -> in_progress`
- `in_progress -> completed`
- `in_progress -> issue`
- `in_progress -> reschedule_requested`

Reject invalid transitions with 400.

Technicians **cannot** set status to `canceled`.

If attempted, return:
- 403
- message: `"Contact admin to cancel a job."`

### Completion behavior
When technician marks a job completed:
- set `Job.technicianStatus = completed`
- set `Job.status = completed`
- set `actualEndAt = now`
- calculate `serviceDurationMinutes` if possible
- ensure `JobContent` exists
- create review workflow if missing
- trigger existing completion/review logic

When technician marks `arrived`:
- set `actualStartAt = now`

---

## 3B. Upsell flag routes
Support:
- technician creates upsell flag
- admin lists all upsell flags
- admin reviews/updates upsell status

Technician input should include:
- jobId
- serviceType
- notes
- optional estimated value
- optional customer interest level

Technician ID must come from authenticated user, not request body.

---

## 3C. Follow-up flag routes
Support:
- technician creates follow-up flag
- admin lists unresolved follow-up flags
- admin resolves follow-up flags

Technician input should include:
- jobId
- flagType
- notes

---

## 3D. Location routes
Support:
- technician sends location ping
- admin retrieves active/latest technician locations

### Location rules
- only send/store location when technician is actively working
- allowed active statuses:
  - en_route
  - arrived
  - in_progress
- stop pings when:
  - completed
  - shift ended
  - logout
  - page/app exit
- no 24/7 tracking
- no background always-on tracking
- keep historical pings
- admin view should return most recent ping per technician

### Ping frequency
- every 2 minutes while active is acceptable for this phase

---

## 3E. Content/photo upload
Extend the job content/media system so technicians can:
- capture before photos
- capture after photos
- upload from device camera
- upload from camera roll
- attach files to the correct job

Implementation goals:
- support multipart upload
- store media in the existing storage layer
- append photo URLs to the correct job content record
- create content record if missing
- support multiple files
- return updated content record

---

## 3F. Technician dashboard route
Create a technician dashboard endpoint returning only the authenticated tech’s performance summary.

Suggested response:
- technicianId
- technicianName
- today:
  - jobsAssigned
  - jobsCompleted
  - jobsRemaining
- thisWeek:
  - jobsCompleted
  - averageServiceMinutes
  - completionRate
  - upsellsFlagged
  - reviewsLinkedToJobs
- upcomingJobs

### Important
Do not expose broader sales/revenue dashboards to technicians in this phase.

---

# Phase 4 — Admin additions

Extend admin visibility to include technician activity.

Add support for:
- active technicians
- today’s assigned jobs per technician
- current technician field status
- pending upsell flags
- unresolved follow-up flags
- latest technician location ping timestamp

If practical, add these to the owner/admin dashboard:
- pendingUpsellFlags
- unresolvedFollowUpFlags
- activeTechnicianCount

---

# Phase 5 — Technician UI screens

Build simple technician-facing screens.
Keep them mobile-friendly and operational.

---

## Screen 1 — Technician home / today’s jobs
Show:
- greeting
- today’s assigned jobs
- scheduled time
- customer name
- address
- service type
- current status
- summary:
  - jobs today
  - completed
  - remaining

---

## Screen 2 — Technician job detail
Show:
- customer name
- address
- phone number
- service type
- job notes
- current status
- valid next-status buttons only
- before photo upload
- after photo upload
- notes area
- flag upsell button
- flag follow-up button
- visible location-sharing state if active

### Important
After photo section can appear once the job is in progress or later.

---

## Screen 3 — Flag upsell
Simple form:
- service type
- notes
- optional estimated value
- optional customer interest level
- submit

On submit:
- create pending upsell flag
- redirect back to job

---

## Screen 4 — Flag follow-up
Simple form:
- flag type
- notes
- submit

On submit:
- create follow-up flag
- redirect back to job

---

## Screen 5 — Technician dashboard
Show cards for:
- jobs completed today
- jobs completed this week
- average service time this week
- completion rate this week
- upsells flagged this week

Also show:
- upcoming assigned jobs

Keep it simple.

---

# Phase 6 — Admin UI additions

Extend admin UI with field activity visibility.

Suggested additions:
- **Field Activity** section on admin dashboard:
  - active technicians
  - current job
  - technician status
  - last ping time
- admin page for upsell flags
- admin page for unresolved follow-up flags

If location is shown in admin UI for this phase:
- coordinates as text only
- no maps required

---

# Phase 7 — Sync behavior

All technician actions must write directly to the shared backend.

There should be:
- no separate technician database
- no separate shadow state as source of truth

Technician actions should update the shared backend entities directly, including:
- job status
- notes
- media
- upsell flags
- follow-up flags
- location pings

Admin views should read from those same backend records.

---

# Phase 8 — Workflow decisions

## Upsell policy
Technicians should **flag upsell opportunities**, not directly price/sell them by default.

Why:
- keeps technicians focused on execution quality
- prevents pricing inconsistency
- reduces training complexity
- still captures expansion opportunities

### Permission model
| Action | Technician | Admin |
|---|---|---|
| Flag upsell opportunity | Yes | Yes |
| Suggest estimated value | Yes | Yes |
| Set customer interest signal | Yes | Yes |
| Quote customer | No (default) | Yes |
| Mark upsell sold | No | Yes |
| Dismiss upsell | No | Yes |

---

## Location-sharing policy
Location sharing should be:
- practical
- limited
- visible
- tied to active work
- easy to stop

Do not build a creepy always-on tracker.

---

# Phase 9 — Testing requirements

Test all core technician flows.

Minimum tests:
- technician can fetch only assigned jobs
- technician cannot access another tech’s job
- invalid status transition returns 400
- technician cannot cancel job
- technician completion updates both technician and job completion states
- review workflow triggers on completion
- photo upload attaches to correct job
- upsell flag creation works
- follow-up flag creation works
- location ping works
- latest active location query works
- technician dashboard aggregates correctly
- canvasser role cannot access technician routes/pages

If test infrastructure exists, use it.  
If not, create lightweight tests for critical backend logic.

---

# Definition of done

The technician module is complete when:

- [ ] schema additions are implemented cleanly
- [ ] role/resource permissions are enforced
- [ ] technicians only see their own jobs
- [ ] status updates work with valid transitions
- [ ] technician completion updates job completion and triggers review workflow
- [ ] before/after media upload works
- [ ] upsell flags work
- [ ] follow-up flags work
- [ ] location ping works only during active work states
- [ ] technician dashboard works
- [ ] admin can monitor technician field activity
- [ ] technician UI screens render without major errors
- [ ] no duplicate backend or disconnected technician datastore is introduced

---

# Things Replit Agent must NOT do

- Do not build a separate technician backend
- Do not let technicians edit prices
- Do not let technicians cancel jobs directly
- Do not expose owner revenue/sales dashboard to technicians
- Do not add maps for this phase
- Do not add push notifications for this phase
- Do not add always-on background location tracking
- Do not rebuild existing Healthy Home modules unnecessarily

---

# Final instruction to Replit Agent

Before making major changes, first return:

1. a concise audit of the current technician-relevant architecture
2. the proposed schema additions
3. the route plan
4. the permission model
5. the phased implementation plan

Then proceed phase by phase.
