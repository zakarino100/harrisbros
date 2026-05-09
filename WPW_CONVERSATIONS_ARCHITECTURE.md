# WPW Conversations — Architecture & Build Plan
*Documented 2026-05-03 by Robin*

## Goal
Move all WPW customer communications from Google Voice into a tracked, unified system across Discord + Expo mobile app — designed from day one so Matthew can be gradually replaced by the AI.

---

## What Already Exists (Audit)

### Expo App (wpw-d2d-fresh)
- ✅ Google OAuth login (WebBrowser + deep link token flow)
- ✅ Admin tabs: Live Map, Canvass, Route Builder, All Leads, Inbound, Analytics, Team, Import
- ✅ Lead cards, status, Supabase data layer, React Query
- ✅ Route builder screen
- ❌ No Conversations tab
- ❌ No two-way SMS messaging from app

### HH Backend (hh-backend-fresh)
- ✅ Outbound campaigns (SMS/email, audience segmentation, sequences)
- ✅ AI nurture engine (Robin/Scout — exact Zak funnel, Claude-powered)
- ✅ Reply classifier (opt_out / human_handoff / simple_question / unclassified)
- ✅ Discord webhook handoff (posts to #leads via `DISCORD_WPW_LEADS_WEBHOOK_URL`)
- ✅ Scout service — per-lead Discord threads in #leads for FB leads
- ✅ Twilio SMS (inbound + outbound)
- ❌ No "Conversations" Discord category with per-customer threads
- ❌ No two-way SMS bridge (Discord ↔ customer)
- ❌ Campaign replies only fire a webhook ping, don't start a conversation thread

### Discord
- ✅ WPW server exists, #leads channel exists, Scout bot posts there
- ✅ Bot token configured
- ❌ No "Conversations" category
- ❌ No two-way SMS bridge (can't reply in Discord and have it go to customer)

---

## Architecture

```
Customer SMS ←→ Twilio ←→ HH Backend
                               ↕
                        hh_conversations DB
                          /           \
               Discord Thread      Expo App
               (Matthew now)   (Matthew or AI)
```

### Data model: `hh_conversations`
One row per customer conversation thread. Links to:
- `campaign_sends` (the outbound message that started it)
- `customers` or `leads` (the person)
- Discord thread ID
- Status: `active` | `human` | `ai` | `closed`

### Message model: `hh_conversation_messages`
- `role`: `customer` | `rep` | `ai`
- `body`: text
- `channel`: `sms` | `discord` | `app`
- `twilio_sid`, `discord_message_id`

---

## Data Flow

### Campaign reply comes in:
1. Customer replies to pollen season SMS
2. Twilio webhook → HH backend `POST /api/campaign-replies/sms-webhook`
3. Backend: classify reply, create/find conversation record, log message
4. Backend: create Discord thread in "Conversations" category (first time only)
   - Thread opener: customer info embed (name, phone, address, campaign, history)
   - First message: customer's reply text
   - @mention Matthew
5. App: conversation appears in Matthew's Conversations tab with unread badge

### Matthew replies (Discord):
1. Matthew types in Discord thread
2. Discord gateway bot (HH backend) detects the message
3. Backend: sends SMS to customer via Twilio, logs as `rep` message
4. App: thread updates with Matthew's message

### Matthew replies (Expo app):
1. Matthew types in app conversation
2. App: POST /api/conversations/:id/reply
3. Backend: sends SMS to customer via Twilio, posts to Discord thread, logs message

### Customer replies again:
1. Twilio webhook → backend
2. Backend: find existing conversation by phone + thread
3. Log message, post to Discord thread AND update app
4. @mention Matthew again if conversation is in `human` mode

---

## AI-Ready Design

Every conversation has a mode flag: `human` or `ai`.

**Right now:** all conversations start in `human` mode → Discord + app.

**When we flip to AI (phase 2+):**
- Incoming SMS → check conversation mode
- `ai` mode → route to nurture engine (Robin), no Discord ping
- Escalation trigger hit → switch to `human`, post to Discord + ping Matthew
- Manual override: Matthew can toggle per-conversation in the app

This makes Matthew replaceable feature-by-feature without rebuilding the system.

---

## Build Phases

### Phase 1 — Discord Conversations Bridge (build now)
**Backend:**
- [ ] New DB tables: `hh_conversations`, `hh_conversation_messages`
- [ ] New Discord gateway service — listens for messages in Conversations threads
- [ ] Update `replies.ts`: on new campaign reply → create/reuse conversation, create Discord thread
- [ ] Thread opener: customer info embed (name, phone, address, last job, campaign name, quote)
- [ ] Two-way bridge: Discord message in thread → Twilio SMS to customer
- [ ] Twilio inbound → match conversation → post to Discord thread + log

**Discord:**
- [ ] Create "Conversations" forum channel in WPW server (manual step, ~2 min)
- [ ] Set `DISCORD_WPW_CONVERSATIONS_CHANNEL_ID` env var in HH backend

**Result:** Matthew can run his entire sales operation from Discord. Every message tracked in DB.

---

### Phase 2 — Expo App Conversations Tab (after Phase 1)
**Backend:**
- [ ] `GET /api/conversations` — list with last message, unread count, status
- [ ] `GET /api/conversations/:id` — full thread: messages + customer info
- [ ] `POST /api/conversations/:id/reply` — rep sends message (→ Twilio + Discord)
- [ ] `PATCH /api/conversations/:id` — update status, toggle AI mode

**Expo App:**
- [ ] New `ConversationsScreen.tsx` — list view with unread badges
- [ ] New `ConversationDetailScreen.tsx` — chat UI, customer info header, reply box
- [ ] Add "Conversations" tab to AdminTabNavigator (between Inbound and Analytics)
- [ ] Matthew (matthewlinder123@gmail.com) role: ensure rep access

**Result:** Matthew can work from phone in the field without needing Discord.

---

### Phase 3 — Matthew UX Polish + Route Integration
- [ ] Conversations tab shows estimated job value (from quote in conversation)
- [ ] "Book this job" button in conversation → creates pending booking → appears in Route Builder
- [ ] Route Builder shows customer addresses from conversations
- [ ] Scheduling SMS flows from Route Builder (already built in Swell, port here)

---

### Phase 4 — AI Takeover (future)
- [ ] Toggle per-conversation: Human ↔ AI
- [ ] When AI: route inbound to nurture engine (Robin), monitor for escalation
- [ ] Analytics: compare close rate human vs AI
- [ ] Gradually flip campaigns from human-first to AI-first

---

## Matthew's Access
- Email: matthewlinder123@gmail.com
- Role: `rep` (or `admin` — decide based on what we want him to see)
- Tabs he needs: Live Map, Canvass, Conversations, Route Builder, Leads
- Auth: Google OAuth (already implemented in app)

---

## Env Vars Needed (Phase 1)
```
DISCORD_WPW_CONVERSATIONS_CHANNEL_ID=<forum channel id>
DISCORD_BOT_TOKEN=<already set>
```
