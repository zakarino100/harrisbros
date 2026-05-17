#!/usr/bin/env node
/**
 * swell-ab-report.mjs
 *
 * Auto-optimizing A/B variant engine for the MackWash receptionist nurture sequence.
 *
 * For each stage:
 *   - If BOTH variants have ≥ 15 sends → evaluate winner, log history, generate new challenger
 *   - If either variant has < 15 sends  → report "insufficient_data", keep testing
 *   - If within 2% reply rate           → call it a "tie", keep testing
 *
 * Winner logic:
 *   1. Winner becomes permanent A (stays)
 *   2. Haiku generates a new challenger B
 *   3. New B is written to swell_variant_messages
 *   4. Cycle result logged to swell_ab_test_history
 *
 * Discord DM sent to Zak with full cycle summary.
 */

import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from swell directory
const envPath = path.join(__dirname, '../swell/.env');
dotenv.config({ path: envPath });

const { Client } = pg;

const MIN_SENDS_PER_VARIANT = 15; // Both variants must meet this threshold
const TIE_THRESHOLD_PCT     = 2;  // Within 2 percentage points = tie

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getABReportData(client) {
  const result = await client.query(`
    SELECT
      nj.kind,
      c.nurture_variant AS variant,
      COUNT(DISTINCT nj.id) AS sent,
      COUNT(DISTINCT CASE WHEN reply_check.replied IS NOT NULL THEN nj.id END) AS replied
    FROM swell_nurture_jobs nj
    JOIN swell_conversations c ON c.id = nj.conversation_id
    LEFT JOIN LATERAL (
      SELECT 1 AS replied
      FROM swell_conversation_messages m
      WHERE m.conversation_id = nj.conversation_id
        AND m.role = 'user'
        AND m.created_at > nj.fired_at
        AND nj.fired_at IS NOT NULL
      LIMIT 1
    ) reply_check ON true
    WHERE nj.tenant_id = 'mackwash'
      AND nj.status = 'fired'
      AND (nj.kind LIKE 'touch_%' OR nj.kind = 'opener')
      AND c.nurture_variant IS NOT NULL
    GROUP BY nj.kind, c.nurture_variant
    ORDER BY nj.kind, c.nurture_variant
  `);
  return result.rows;
}

async function getCurrentVariantTexts(client, stage) {
  const result = await client.query(
    `SELECT variant, body FROM swell_variant_messages
     WHERE tenant_id = 'mackwash' AND stage = $1 AND active = true`,
    [stage]
  );
  const map = {};
  result.rows.forEach(r => { map[r.variant] = r.body; });
  return map;
}

async function logCycleHistory(client, opts) {
  const {
    stage, cycleStartedAt,
    variantAText, variantBText,
    variantASent, variantAReplied,
    variantBSent, variantBReplied,
    winner, winnerReplyRate,
    newChallengerText,
  } = opts;

  await client.query(`
    INSERT INTO swell_ab_test_history (
      tenant_id, stage, cycle_started_at,
      variant_a_text, variant_b_text,
      variant_a_sent, variant_a_replied,
      variant_b_sent, variant_b_replied,
      winner, winner_reply_rate, new_challenger_text
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [
    'mackwash', stage, cycleStartedAt,
    variantAText, variantBText,
    variantASent, variantAReplied,
    variantBSent, variantBReplied,
    winner, winnerReplyRate,
    newChallengerText,
  ]);
}

async function updateVariantB(client, stage, newBody) {
  await client.query(`
    UPDATE swell_variant_messages
    SET body = $1
    WHERE tenant_id = 'mackwash' AND stage = $2 AND variant = 'B' AND active = true
  `, [newBody, stage]);
}

// ── Anthropic Haiku challenger generation ─────────────────────────────────────

async function generateChallenger(stage, winningText, winnerRate) {
  const apiKey = process.env.MACKWASH_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No Anthropic API key found (MACKWASH_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY)');

  const prompt = `You are writing a follow-up SMS for a house wash business called Mack Wash. \
The winning message for the "${stage}" stage was:

"${winningText}"

It achieved a ${winnerRate}% reply rate. Generate a NEW variant that takes a DIFFERENT angle or tone to try to beat it. \

Rules:
- Warm, friendly tone (not pushy or salesy)
- Use [name] placeholder for the customer's first name
- Never mention pricing, cost, or dollar amounts
- Never promise a specific appointment time
- Under 160 characters
- Output ONLY the message text, nothing else — no quotes, no explanation`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text?.trim() ?? '';
  if (!text) throw new Error('Anthropic returned empty text');
  return text;
}

// ── Discord DM ────────────────────────────────────────────────────────────────

async function sendDiscordDM(message) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const userId   = '1385472518978011266'; // Zak's Discord user ID

  if (!botToken) throw new Error('Missing DISCORD_BOT_TOKEN');

  const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: userId }),
  });
  if (!dmRes.ok) throw new Error(`DM channel create failed: ${dmRes.status} ${await dmRes.text()}`);
  const { id: dmChannelId } = await dmRes.json();

  // Discord messages have a 2000 char limit — chunk if needed
  const chunks = [];
  let remaining = message;
  while (remaining.length > 1900) {
    const cut = remaining.lastIndexOf('\n', 1900);
    chunks.push(remaining.slice(0, cut > 0 ? cut : 1900));
    remaining = remaining.slice(cut > 0 ? cut + 1 : 1900);
  }
  chunks.push(remaining);

  for (const chunk of chunks) {
    const sendRes = await fetch(`https://discord.com/api/v10/channels/${dmChannelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: chunk }),
    });
    if (!sendRes.ok) throw new Error(`Send message failed: ${sendRes.status} ${await sendRes.text()}`);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    console.log('[swell-ab-report] Fetching A/B nurture data...');
    const rows = await getABReportData(client);
    console.log(`[swell-ab-report] Got ${rows.length} records`);

    // Group by stage
    const byStage = {};
    for (const row of rows) {
      if (!byStage[row.kind]) byStage[row.kind] = {};
      byStage[row.kind][row.variant] = {
        sent:    parseInt(row.sent,    10),
        replied: parseInt(row.replied, 10),
      };
    }

    const now     = new Date();
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    let reportLines = [`📊 **MackWash A/B Nurture Report** — ${dateStr}\n`];
    let actionLines = []; // Separate section for optimization actions

    const stages = Object.keys(byStage).sort();

    for (const stage of stages) {
      const data = byStage[stage];
      const aData = data['A'] ?? { sent: 0, replied: 0 };
      const bData = data['B'] ?? { sent: 0, replied: 0 };

      const aSent    = aData.sent;
      const bSent    = bData.sent;
      const aReplied = aData.replied;
      const bReplied = bData.replied;
      const aRate    = aSent > 0 ? (aReplied / aSent) * 100 : 0;
      const bRate    = bSent > 0 ? (bReplied / bSent) * 100 : 0;

      // ── Insufficient data ──────────────────────────────────────────────────
      if (aSent < MIN_SENDS_PER_VARIANT || bSent < MIN_SENDS_PER_VARIANT) {
        reportLines.push(
          `⏳ **${stage}**: not enough data yet (A: ${aSent} sends, B: ${bSent} sends — need ${MIN_SENDS_PER_VARIANT} each)`
        );
        continue;
      }

      // ── Both variants have enough data ────────────────────────────────────
      const diff = Math.abs(aRate - bRate);

      if (diff <= TIE_THRESHOLD_PCT) {
        // Tie — keep testing
        reportLines.push(
          `🤝 **${stage}**: TIE (A: ${aRate.toFixed(1)}% | B: ${bRate.toFixed(1)}%) — within ${TIE_THRESHOLD_PCT}%, keep testing`
        );
        continue;
      }

      // Clear winner
      const winner     = aRate > bRate ? 'A' : 'B';
      const loser      = winner === 'A' ? 'B' : 'A';
      const winnerRate = winner === 'A' ? aRate : bRate;
      const loserRate  = winner === 'A' ? bRate : aRate;
      const winnerSent = winner === 'A' ? aSent    : bSent;
      const loserSent  = winner === 'A' ? bSent    : aSent;

      // Fetch current text for history
      const texts = await getCurrentVariantTexts(client, stage);
      const variantAText = texts['A'] ?? null;
      const variantBText = texts['B'] ?? null;
      const winnerText   = texts[winner] ?? null;

      let challengerText = null;
      let challengerError = null;

      try {
        console.log(`[swell-ab-report] Generating new challenger for ${stage} (winner: ${winner} at ${winnerRate.toFixed(1)}%)...`);
        challengerText = await generateChallenger(stage, winnerText ?? '', winnerRate);
        console.log(`[swell-ab-report] Challenger: "${challengerText}"`);

        // Write new B to DB
        await updateVariantB(client, stage, challengerText);
        console.log(`[swell-ab-report] Updated swell_variant_messages for ${stage}/B`);
      } catch (e) {
        challengerError = e.message;
        console.error(`[swell-ab-report] Challenger generation failed for ${stage}:`, e.message);
      }

      // Log cycle to history
      await logCycleHistory(client, {
        stage,
        cycleStartedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // approximate: 30 days ago
        variantAText,
        variantBText,
        variantASent:    aSent,
        variantAReplied: aReplied,
        variantBSent:    bSent,
        variantBReplied: bReplied,
        winner,
        winnerReplyRate: parseFloat(winnerRate.toFixed(2)),
        newChallengerText: challengerText,
      });

      reportLines.push(
        `🏆 **${stage}**: Variant ${winner} wins! (${winnerRate.toFixed(1)}% vs ${loserRate.toFixed(1)}%)`
      );

      if (challengerText) {
        actionLines.push(
          `✅ **${stage}** → New challenger B generated:\n> "${challengerText}"`
        );
      } else {
        actionLines.push(
          `⚠️ **${stage}** → Winner declared but challenger generation failed: ${challengerError}`
        );
      }
    }

    // Build final Discord message
    let message = reportLines.join('\n');

    if (actionLines.length > 0) {
      message += '\n\n**🔄 Optimization Actions Taken:**\n' + actionLines.join('\n\n');
    } else {
      message += '\n\n_No stages had enough data to declare a winner this cycle._';
    }

    console.log('[swell-ab-report] Sending Discord DM...');
    await sendDiscordDM(message);
    console.log('[swell-ab-report] Done!');

  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('[swell-ab-report] Fatal error:', err.message);
  process.exit(1);
});
