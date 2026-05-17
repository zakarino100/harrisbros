/**
 * test-review-funnel.mjs
 *
 * Simulation-only test for the WPW Review Funnel.
 * NO SMS is sent. NO Twilio calls. NO DB writes.
 *
 * Run with: node test-review-funnel.mjs
 */

import pg from '/opt/homebrew/lib/node_modules/pg/lib/index.js';
const { Client } = pg;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TEST_FIRST_NAME = 'Zak';
const TEST_PHONE = '+13154470614';

const DB_CONFIG = {
  host: 'aws-1-us-east-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.hclpovktywijfnswthpm',
  password: 'Eaglesfan1998$',
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
};

// ---------------------------------------------------------------------------
// Inline helpers (mirrors review-funnel.ts logic — no imports needed)
// ---------------------------------------------------------------------------

function classifyFunnelReply(reply) {
  const intent = reply.classification_reason?.intent ?? '';
  const lower = (reply.body ?? '').toLowerCase();

  if (intent === 'already_did_it') return 'positive';

  const positiveIntents = ['positive', 'satisfied', 'ready_to_book', 'already_did_it', 'will_review'];
  if (positiveIntents.includes(intent)) return 'positive';

  const negativeIntents = ['complaint', 'not_satisfied', 'had_issue', 'wrong_number', 'bad_experience'];
  if (negativeIntents.includes(intent)) return 'negative';

  const positiveKeywords = ['great', 'awesome', ' 5 ', 'five', 'love', 'loved', 'perfect', 'excellent'];
  for (const kw of positiveKeywords) {
    if (lower.includes(kw)) return 'positive';
  }
  if (/\b5\b/.test(lower)) return 'positive';

  const negativeKeywords = ['bad', 'terrible', '1 star', '2 star', 'disappointed', 'never came', "didn't come", 'didnt come'];
  for (const kw of negativeKeywords) {
    if (lower.includes(kw)) return 'negative';
  }

  return 'ambiguous';
}

function generateFeedbackUrl(sendId, name, phone) {
  const base = 'https://healthy-home-backend-production.up.railway.app/api/reviews/feedback-opened';
  return `${base}?token=${sendId}&name=${encodeURIComponent(name)}&phone=${encodeURIComponent(phone)}&rating=2`;
}

function interpolate(template, firstName) {
  return template.replace(/\{\{firstName\}\}/g, firstName);
}

function hr(char = '─', len = 70) {
  return char.repeat(len);
}

function box(title) {
  console.log('\n' + hr('═'));
  console.log(`  ${title}`);
  console.log(hr('═'));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const client = new Client(DB_CONFIG);
await client.connect();

// ── Step 1: Campaign message previews ───────────────────────────────────────
box('STEP 1 — CAMPAIGN MESSAGE PREVIEWS ({{firstName}} = "Zak")');

const step1Res = await client.query(
  `SELECT id, name, body FROM hh_campaigns WHERE id IN (6, 7) ORDER BY id`
);

for (const row of step1Res.rows) {
  console.log(`\n📱 Campaign ${row.id}: ${row.name}`);
  console.log(hr());
  console.log(interpolate(row.body, TEST_FIRST_NAME));
  console.log(hr());
}

// ── Step 2: Simulate positive reply → Step 2A ───────────────────────────────
box('STEP 2 — SIMULATE POSITIVE REPLY → Step 2A (Review Ask)');

const positiveReply = {
  body: 'Great job, loved it!',
  classification_reason: null,
};
const positiveClass = classifyFunnelReply(positiveReply);

const step2aRes = await client.query(
  `SELECT id, name, body FROM hh_campaigns WHERE id = 8`
);
const step2aBody = step2aRes.rows[0]?.body ?? '(not found)';

console.log(`\n📩 Incoming reply: "${positiveReply.body}"`);
console.log(`🧠 Classification: ${positiveClass.toUpperCase()}`);
console.log(`\n📤 Would queue Campaign 8 → ${TEST_PHONE}`);
console.log(hr());
console.log(interpolate(step2aBody, TEST_FIRST_NAME));
console.log(hr());

// ── Step 3: Simulate negative reply → Step 2B ───────────────────────────────
box('STEP 3 — SIMULATE NEGATIVE REPLY → Step 2B (Feedback Form)');

const negativeReply = {
  body: 'You guys never showed up',
  classification_reason: null,
};
const negativeClass = classifyFunnelReply(negativeReply);

const step2bRes = await client.query(
  `SELECT id, name, body FROM hh_campaigns WHERE id = 9`
);
const step2bBody = step2bRes.rows[0]?.body ?? '(not found)';

// Simulate what a queued send would look like (fake send ID for preview)
const simulatedSendId = 99999n;
const feedbackUrl = generateFeedbackUrl(simulatedSendId, TEST_FIRST_NAME, TEST_PHONE);
const renderedStep2b = interpolate(step2bBody, TEST_FIRST_NAME)
  .replace('{{feedbackFormUrl}}', feedbackUrl);

console.log(`\n📩 Incoming reply: "${negativeReply.body}"`);
console.log(`🧠 Classification: ${negativeClass.toUpperCase()}`);
console.log(`\n📤 Would queue Campaign 9 → ${TEST_PHONE}`);
console.log(`🔗 Feedback URL: ${feedbackUrl}`);
console.log(hr());
console.log(renderedStep2b);
console.log(hr());

// ── Step 4: DB state of campaigns 6-9 ───────────────────────────────────────
box('STEP 4 — DB STATE: Campaigns 6–9');

const dbRes = await client.query(
  `SELECT id, name, status, type, parent_campaign_id, batch_size,
          send_window_start, send_window_end, send_timezone,
          LEFT(body, 80) AS body_preview
   FROM hh_campaigns
   WHERE id IN (6, 7, 8, 9)
   ORDER BY id`
);

console.log('');
for (const row of dbRes.rows) {
  console.log(`Campaign ${row.id}: ${row.name}`);
  console.log(`  Status:      ${row.status}`);
  console.log(`  Type:        ${row.type}`);
  console.log(`  Parent:      ${row.parent_campaign_id ?? '(none)'}`);
  console.log(`  Batch size:  ${row.batch_size}`);
  console.log(`  Window:      ${row.send_window_start}–${row.send_window_end} ${row.send_timezone}`);
  console.log(`  Body:        "${row.body_preview}..."`);
  console.log('');
}

await client.end();

// ── Step 5: READY FOR REVIEW checklist ──────────────────────────────────────
box('STEP 5 — ✅ READY FOR REVIEW CHECKLIST');

console.log(`
  Before going live, Zak must verify each of the following:

  CAMPAIGNS (in DB, all status=draft — nothing sends yet)
  ─────────────────────────────────────────────────────────
  [ ] Campaign 6: Step 1 Variant A — message copy looks right
  [ ] Campaign 7: Step 1 Variant B — message copy looks right
  [ ] Campaign 8: Step 2A (Review Ask) — Google link is correct
  [ ] Campaign 9: Step 2B (Feedback Form) — {{feedbackFormUrl}} resolves correctly

  CODE
  ─────────────────────────────────────────────────────────
  [ ] artifacts/api-server/src/services/review-funnel.ts — classify + process logic
  [ ] artifacts/api-server/src/routes/review-sms.ts — POST /review/process-funnel-replies added
  [ ] artifacts/api-server/src/routes/index.ts — /review router registered

  LIVE TEST (to +13154470614 — must be triggered manually)
  ─────────────────────────────────────────────────────────
  [ ] Manually add +13154470614 as a send in campaign 6 or 7 (status=queued)
  [ ] Deploy updated code to Railway
  [ ] Trigger campaign-sender to dispatch Step 1 SMS to +13154470614
  [ ] Reply with a positive message (e.g. "5 stars, great job!")
  [ ] Call POST /api/review/process-funnel-replies
  [ ] Confirm Step 2A (Google review link) is queued in hh_campaign_sends
  [ ] Repeat with negative reply to confirm Step 2B (feedback form) queues
  [ ] Confirm feedback URL opens correctly in browser

  SIGN-OFF
  ─────────────────────────────────────────────────────────
  [ ] Zak approves all 4 message copies
  [ ] Zak approves branching logic (positive/negative/ambiguous)
  [ ] Set campaigns 6 & 7 status = 'active' only after sign-off
`);

console.log(hr('═'));
console.log('  🔒 NOTHING WAS SENT. ALL CAMPAIGNS REMAIN IN DRAFT STATUS.');
console.log(hr('═') + '\n');
