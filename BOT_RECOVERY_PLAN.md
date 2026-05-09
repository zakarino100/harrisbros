# Bot Recovery Plan — May 9, 2026

## Summary
Both **Hayden** (Swell SMS responder) and **Gia** (Mop Mafia customer bot) reconnected 1000+ times today, causing Discord to flag and reject their tokens. Bots have been offline since.

---

## Root Causes

### 1. **Hayden (Swell Discord Gateway)**
- Discord gateway was losing connection and reconnecting every 5 seconds with NO BACKOFF
- Rapid reconnection loop triggered Discord's abuse detection
- Bot token was flagged and invalidated

### 2. **Gia (Mop Mafia Bot)**
- Same issue on Mop Mafia's Replit
- Token also flagged after 1000+ attempts

---

## Fix Plan

### STEP 1: Reset Bot Tokens (REQUIRED)
Discord has flagged both tokens. You **must** regenerate them:

#### For **Hayden** (Swell):
1. Go to: https://discord.com/developers/applications
2. Click **Swell** app (or find it by searching for "1499988099428782172")
3. Click **Bot** in the left sidebar
4. Under "TOKEN", click **Reset Token**
5. Copy the new token (it looks like: `MTQ5OTk4ODA5OTQyODc4MjE3Mg.G...`)
6. Update `/Users/zak/.openclaw/workspace/swell/.env`:
   ```
   DISCORD_BOT_TOKEN=<paste-new-token-here>
   ```
7. **Commit and push** the change to deploy

#### For **Gia** (Mop Mafia):
1. Go to: https://discord.com/developers/applications
2. Find the **Mop Mafia** bot app (or search: "1501084742701809795")
3. Click **Bot** → **Reset Token**
4. Update Mop Mafia's Replit `.env` with the new token
5. **Redeploy** the Mop Mafia Replit

---

### STEP 2: Deploy Code Fix (Already Done ✅)

I've already fixed the Swell Discord gateway to use **exponential backoff** instead of fixed 5-second retries:

**Changes made:**
- Backoff starts at 5s, doubles each retry (5s → 10s → 20s → 40s → 60s cap)
- Added jitter (randomness) to prevent thundering herd
- Max 5 reconnection attempts before giving up
- Better logging and error handling
- File: `/Users/zak/.openclaw/workspace/swell/server/services/discord-gateway.ts` ✅

**To deploy:**
```bash
cd /Users/zak/.openclaw/workspace/swell
npm run build
# Push to Replit or run locally
```

**Note:** Gia's code needs the same fix, but it's on Mop Mafia's Replit. You'll need to update that repo similarly.

---

### STEP 3: Run Discord Notification Backfill

Once the token is reset and server is running, catch up any missed notifications from today:

#### Option A: Run on Swell Replit
```bash
# SSH into Replit console and run:
BACKFILL_HOURS=24 npx ts-node scripts/discord-backfill.ts
```

#### Option B: Dry-run first (no changes)
```bash
DRY_RUN=true BACKFILL_HOURS=24 npx ts-node scripts/discord-backfill.ts
```

This will:
- Find all leads created in the last 24 hours without Discord thread IDs
- Send them to the appropriate Discord channel
- Mark them as notified so they don't get duplicated

---

## Checklist

- [ ] **Hayden token reset** — New token obtained from Discord Developer Portal
- [ ] **Update Swell `.env`** — `DISCORD_BOT_TOKEN=...`
- [ ] **Push to Swell Replit** — Code changes deployed
- [ ] **Gia token reset** — New token obtained (Mop Mafia Replit)
- [ ] **Update Gia's Replit `.env`** — New token deployed
- [ ] **Gia code fix** — Apply exponential backoff logic (same as Hayden)
- [ ] **Run backfill** — `BACKFILL_HOURS=24 npx ts-node scripts/discord-backfill.ts`
- [ ] **Test Hayden** — Send a test lead via Facebook, verify Discord notification fires
- [ ] **Test Gia** — Send a test SMS to Mop Mafia, verify bot responds

---

## Expected Outcome

✅ Bots will stay connected instead of reconnecting constantly
✅ Discord won't flag them for abuse
✅ All leads will be notified in Discord channels
✅ SMS responses will work (Hayden will respond to lead SMS)
✅ Customer SMS will work (Gia will respond to Mop Mafia customer texts)

---

## Prevention

Going forward:
1. **Monitor bot token usage** — Check Discord audit logs monthly
2. **Set up health checks** — Ping the Discord gateway connection every 5-10 minutes
3. **Alert on repeated disconnects** — If >3 disconnects in 30 min, page ops
4. **Log gateway events** — Archive connection/disconnect events for debugging

---

## Questions?

If either bot reconnects >5 times after the fix, that's a sign of a deeper issue (bad token, bot is banned, etc.). Check:
- Bot token is valid and not expired
- Bot has required permissions in the Discord guild
- Guild ID is correct in the bot's config
- No rate limiting from Discord (check gateway error codes)

Good luck! 🚀
