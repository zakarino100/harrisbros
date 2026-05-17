#!/usr/bin/env node

/**
 * Discord Notification Reconciliation for WPW Campaign Replies
 * Cron: 9b2a3fb8-f2dd-4973-8339-48c219922621
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const pg = require('pg');
const https = require('https');

const execAsync = promisify(exec);

// Configuration
const DB_CONFIG = {
  host: 'db.hclpovktywijfnswthpm.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Eaglesfan1998$',
  ssl: true,
};

const DISCORD_CHANNELS = {
  updates: '1502363455779504198',
  reactivation: '1502357456452587612',
  leads: '1439375021586911285',
};

const MANAGER_ROLE_ID = '1390089142087717087';
const REPLIT_SSH_KEY = '~/.ssh/replit_wolfpackwash';
const REPLIT_HOST = '01616f2b-facf-41fc-a607-25a0ebe18b96@01616f2b-facf-41fc-a607-25a0ebe18b96-00-3gcvfx18qfig3.riker.replit.dev';

// Get Discord bot token from SSH
async function getDiscordBotToken() {
  try {
    const { stdout } = await execAsync(
      `ssh -i ${REPLIT_SSH_KEY} -p 22 ${REPLIT_HOST} 'printf "%s" "$DISCORD_BOT_TOKEN"'`
    );
    return stdout.trim();
  } catch (error) {
    throw new Error(`Failed to get Discord bot token: ${error.message}`);
  }
}

// Query unrouted replies from Supabase
async function getUnroutedReplies(pool) {
  const query = `
    SELECT id, customer_name, customer_phone, message_body, classification, received_at
    FROM hh_campaign_replies
    WHERE routed_to_discord = false
      AND classification != 'opt_out'
      AND received_at > NOW() - INTERVAL '48 hours'
    ORDER BY received_at ASC
  `;

  try {
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    throw new Error(`Database query failed: ${error.message}`);
  }
}

// Post message to Discord
async function postToDiscord(botToken, channelId, message, mentions = []) {
  return new Promise((resolve, reject) => {
    const content = mentions.length > 0 
      ? `${mentions.map(id => `<@${id}>`).join(' ')} ${message}`
      : message;

    const payload = JSON.stringify({ content });

    const options = {
      hostname: 'discord.com',
      port: 443,
      path: `/api/v10/channels/${channelId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve(true);
        } else {
          reject(new Error(`Discord API error: ${res.statusCode} ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Mark reply as routed
async function markAsRouted(pool, replyId) {
  const query = `
    UPDATE hh_campaign_replies
    SET routed_to_discord = true, routed_at = NOW()
    WHERE id = $1
  `;

  try {
    await pool.query(query, [replyId]);
  } catch (error) {
    throw new Error(`Failed to mark reply ${replyId} as routed: ${error.message}`);
  }
}

// Determine Discord channel and mentions based on classification
function getChannelAndMentions(classification) {
  if (classification === 'customer_issue' || classification === 'manager_request') {
    return {
      channelId: DISCORD_CHANNELS.updates,
      mentions: [MANAGER_ROLE_ID],
    };
  } else if (classification === 'reactivation') {
    return {
      channelId: DISCORD_CHANNELS.reactivation,
      mentions: [],
    };
  }
  return {
    channelId: DISCORD_CHANNELS.leads,
    mentions: [],
  };
}

// Format reply message for Discord
function formatMessage(reply) {
  return `**${reply.customer_name}** (${reply.customer_phone})\n${reply.message_body}\n_Received: ${new Date(reply.received_at).toLocaleString()}_`;
}

// Main reconciliation logic
async function reconcile() {
  const pool = new pg.Pool(DB_CONFIG);
  let routed = 0;
  let errors = [];

  try {
    console.log('[Discord Notification Reconciliation] Starting...');

    // Get Discord bot token
    console.log('Retrieving Discord bot token...');
    const botToken = await getDiscordBotToken();

    // Query unrouted replies
    console.log('Querying unrouted replies from Supabase...');
    const replies = await getUnroutedReplies(pool);

    if (replies.length === 0) {
      console.log('No unrouted replies found.');
      return 'NO_REPLY';
    }

    console.log(`Found ${replies.length} unrouted replies. Processing...`);

    // Process each reply
    for (const reply of replies) {
      try {
        const { channelId, mentions } = getChannelAndMentions(reply.classification);
        const message = formatMessage(reply);

        console.log(`Posting reply #${reply.id} (${reply.classification}) to channel ${channelId}...`);
        await postToDiscord(botToken, channelId, message, mentions);

        // Mark as routed
        await markAsRouted(pool, reply.id);
        routed++;
        console.log(`✓ Reply #${reply.id} routed successfully`);
      } catch (error) {
        const errMsg = `Failed to route reply #${reply.id}: ${error.message}`;
        console.error(errMsg);
        errors.push(errMsg);
      }
    }

    console.log(`[SUMMARY] Routed ${routed}/${replies.length} replies`);

    if (errors.length > 0) {
      console.error(`[ERRORS] ${errors.length} error(s) occurred:`);
      errors.forEach(e => console.error(`  - ${e}`));
      throw new Error(`Reconciliation completed with ${errors.length} error(s)`);
    }

    return `SUCCESS: Routed ${routed} replies`;
  } catch (error) {
    console.error(`[FATAL] ${error.message}`);
    // Alert Zak
    throw error;
  } finally {
    await pool.end();
  }
}

// Run reconciliation
reconcile()
  .then((result) => {
    console.log(`\n✓ ${result}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\n✗ Reconciliation failed: ${error.message}`);
    process.exit(1);
  });
