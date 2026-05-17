#!/usr/bin/env node
// Discord Reconciliation Cron — WPW campaign replies → Discord channels
// No SSH. Uses direct Supabase + Discord REST API.

import pkg from '/opt/homebrew/lib/node_modules/pg/lib/index.js';
const { Client } = pkg;

const SUPABASE_URL = 'postgresql://postgres.hclpovktywijfnswthpm:Eaglesfan1998$@aws-1-us-east-1.pooler.supabase.com:5432/postgres';
const BOT_TOKEN    = 'MTQ4OTY3MzYwNjk2NjI4MDQ0Mw.Gj4Wj_.N3vRyL6ufA2ffP4rBUxoc5RQYZfHHN9ykS395w';
const CH_REACTIVATION = '1502357456452587612';
const CH_UPDATES      = '1502363455779504198';
const CH_LEADS        = '1439375021586911285';
const MATTHEW_ID      = '1390089142087717087';

async function discordPost(channelId, content) {
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Discord API ${res.status}: ${err}`);
  }
  return res.json();
}

function routeReply(reply) {
  const body = (reply.body || '').toLowerCase();
  const cls  = reply.classification || '';

  if (cls === 'opt_out') return null; // already handled

  const urgentKeywords = ['issue', 'complaint', 'refund', 'angry', 'nerve', 'ruined', 'stole', 'asshole', 'manager', 'lawsuit', 'money back', 'never showed'];
  const isUrgent = cls === 'human_handoff' && urgentKeywords.some(k => body.includes(k));

  if (isUrgent) return CH_UPDATES;
  if (cls === 'human_handoff') return CH_REACTIVATION;
  return CH_LEADS;
}

function formatMessage(reply, channelId) {
  const name    = reply.to_name || reply.from_address || 'Unknown';
  const phone   = reply.from_address || '';
  const msg     = reply.body || '';
  const cls     = reply.classification || 'unclassified';
  const campaign = reply.campaign_name || `Campaign ${reply.campaign_id}`;

  const emoji = cls === 'human_handoff' ? '🙋' : cls === 'opt_out' ? '🚫' : '💬';
  const matthewMention = channelId === CH_UPDATES ? `<@${MATTHEW_ID}> ` : '';

  return `${matthewMention}${emoji} **Reply — ${name}** (${phone})\n📋 Campaign: ${campaign}\n🏷️ Classification: \`${cls}\`\n💬 "${msg}"`;
}

async function main() {
  const client = new Client({ connectionString: SUPABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const { rows } = await client.query(`
      SELECT cr.id, cr.campaign_id, cr.from_address, cr.body, cr.classification,
             cs.to_name, hc.name AS campaign_name
      FROM hh_campaign_replies cr
      LEFT JOIN hh_campaign_sends cs ON cs.id = cr.send_id
      LEFT JOIN hh_campaigns hc ON hc.id = cr.campaign_id
      WHERE cr.routed_to_discord = false
        AND cr.classification != 'opt_out'
        AND cr.received_at > NOW() - INTERVAL '48 hours'
      ORDER BY cr.received_at ASC
      LIMIT 20
    `);

    if (rows.length === 0) {
      process.stdout.write('NO_REPLY');
      return;
    }

    let routed = 0;
    for (const reply of rows) {
      const channelId = routeReply(reply);
      if (!channelId) {
        await client.query(`UPDATE hh_campaign_replies SET routed_to_discord = true WHERE id = $1`, [reply.id]);
        continue;
      }
      try {
        const content = formatMessage(reply, channelId);
        await discordPost(channelId, content);
        await client.query(`UPDATE hh_campaign_replies SET routed_to_discord = true WHERE id = $1`, [reply.id]);
        routed++;
      } catch (err) {
        console.error(`Failed to route reply ${reply.id}:`, err.message);
      }
    }

    console.log(`Routed ${routed}/${rows.length} replies to Discord.`);
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
