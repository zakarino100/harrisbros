#!/usr/bin/env node
// Discord Notification Reconciliation Cron
// Queries HH Supabase for unrouted campaign replies, posts to Discord, marks as routed.
// No SSH required — bot token is hardcoded.

const { Client } = require('/opt/homebrew/lib/node_modules/pg');
const https = require('https');

const DISCORD_TOKEN = 'MTQ4OTY3MzYwNjk2NjI4MDQ0Mw.Gj4Wj_.N3vRyL6ufA2ffP4rBUxoc5RQYZfHHN9ykS395w';
const CHANNELS = {
  leads:        '1439375021586911285',
  reactivation: '1502357456452587612',
  updates:      '1502363455779504198',
};
const MATTHEW_ID = '1390089142087717087';

const ESCALATION_KEYWORDS = ['issue', 'complaint', 'refund', 'angry', 'manager'];

function discordPost(channelId, content) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ content });
    const opts = {
      hostname: 'discord.com',
      path: `/api/v10/channels/${channelId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bot ${DISCORD_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Discord API ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function routeReply(reply) {
  const classification = (reply.classification || '').toLowerCase();
  const body = (reply.body || '').toLowerCase();

  if (classification === 'human_handoff') {
    const isEscalation = ESCALATION_KEYWORDS.some(kw => body.includes(kw));
    if (isEscalation) {
      return { channelId: CHANNELS.updates, mention: true };
    }
    return { channelId: CHANNELS.reactivation, mention: false };
  }

  return { channelId: CHANNELS.leads, mention: false };
}

function formatMessage(reply, mention) {
  const lines = [];
  if (mention) {
    lines.push(`<@${MATTHEW_ID}> — **Escalation Alert**`);
  }
  lines.push(`**New Campaign Reply** (ID: ${reply.id})`);
  if (reply.from_address) lines.push(`**From:** ${reply.from_address}`);
  if (reply.channel)      lines.push(`**Channel:** ${reply.channel}`);
  if (reply.classification) lines.push(`**Classification:** ${reply.classification}`);
  if (reply.body)         lines.push(`**Message:** ${reply.body.substring(0, 500)}`);
  if (reply.received_at)  lines.push(`**Received:** ${new Date(reply.received_at).toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
  return lines.join('\n');
}

async function main() {
  const db = new Client({
    host: 'aws-1-us-east-1.pooler.supabase.com',
    port: 5432,
    user: 'postgres.hclpovktywijfnswthpm',
    password: 'Eaglesfan1998$',
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  await db.connect();

  const { rows: replies } = await db.query(`
    SELECT id, campaign_id, lead_id, customer_id, from_address, channel, body,
           classification, classification_reason, received_at
    FROM hh_campaign_replies
    WHERE routed_to_discord = false
      AND classification != 'opt_out'
      AND received_at > NOW() - INTERVAL '48 hours'
    ORDER BY received_at ASC
  `);

  if (replies.length === 0) {
    console.log('NO_REPLY');
    await db.end();
    return;
  }

  console.log(`Found ${replies.length} unrouted reply(ies). Processing...`);

  let routed = 0;
  let errors = 0;

  for (const reply of replies) {
    try {
      const { channelId, mention } = routeReply(reply);
      const content = formatMessage(reply, mention);

      await discordPost(channelId, content);

      await db.query(
        'UPDATE hh_campaign_replies SET routed_to_discord = true WHERE id = $1',
        [reply.id]
      );

      console.log(`✓ Routed reply ${reply.id} → channel ${channelId}`);
      routed++;

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error(`✗ Failed to route reply ${reply.id}: ${err.message}`);
      errors++;
    }
  }

  await db.end();
  console.log(`Done. Routed: ${routed}, Errors: ${errors}`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
