#!/usr/bin/env node

const { Client } = require('pg');
const { exec } = require('child_process');
const { promisify } = require('util');
const https = require('https');

const execAsync = promisify(exec);

// Configuration
const dbConfig = {
  host: 'db.hclpovktywijfnswthpm.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Eaglesfan1998$',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 5000
};

const CHANNEL_MAP = {
  'customer_issue': '1502363455779504198',
  'manager_request': '1502363455779504198',
  'reactivation': '1502357456452587612',
  'default': '1439375021586911285'
};

const MENTION_ROLE = '1390089142087717087';

// Get Discord bot token from SSH with timeout
async function getDiscordToken() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('SSH token retrieval timeout after 8 seconds'));
    }, 8000);

    exec(
      'ssh -i ~/.ssh/replit_wolfpackwash -p 22 01616f2b-facf-41fc-a607-25a0ebe18b96@01616f2b-facf-41fc-a607-25a0ebe18b96-00-3gcvfx18qfig3.riker.replit.dev \'printf "%s" "$DISCORD_BOT_TOKEN"\' 2>&1',
      { timeout: 9000 },
      (error, stdout, stderr) => {
        clearTimeout(timeout);
        if (error) {
          reject(new Error(`SSH failed: ${stderr || error.message}`));
        } else {
          const token = stdout.trim();
          if (!token) {
            reject(new Error('Discord token is empty'));
          } else {
            resolve(token);
          }
        }
      }
    );
  });
}

// Query Supabase for unrouted replies
async function getUnroutedReplies(client) {
  const query = `
    SELECT id, customer_name, customer_phone, message_content, classification, received_at
    FROM hh_campaign_replies
    WHERE routed_to_discord = false
      AND classification != 'opt_out'
      AND received_at > NOW() - INTERVAL '48 hours'
    ORDER BY received_at DESC
    LIMIT 50
  `;
  const result = await client.query(query);
  return result.rows;
}

// Post message to Discord
async function postToDiscord(token, channelId, message, mention = null) {
  return new Promise((resolve, reject) => {
    const content = mention ? `<@&${mention}>\n${message}` : message;
    const payload = JSON.stringify({ content });

    const options = {
      hostname: 'discord.com',
      port: 443,
      path: `/api/v10/channels/${channelId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bot ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, statusCode: res.statusCode });
        } else {
          reject(new Error(`Discord API ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Discord API request timeout'));
    });
    req.setTimeout(5000);
    req.write(payload);
    req.end();
  });
}

// Update reply as routed
async function markAsRouted(client, replyId) {
  await client.query(
    'UPDATE hh_campaign_replies SET routed_to_discord = true, routed_at = NOW() WHERE id = $1',
    [replyId]
  );
}

// Format message based on classification
function formatMessage(reply) {
  const timestamp = new Date(reply.received_at).toLocaleString();
  return `**New Campaign Reply**\n` +
    `Customer: ${reply.customer_name}\n` +
    `Phone: ${reply.customer_phone}\n` +
    `Classification: ${reply.classification}\n` +
    `Received: ${timestamp}\n\n` +
    `> ${reply.message_content}`;
}

// Determine channel for reply
function getChannelId(classification) {
  if (classification === 'customer_issue' || classification === 'manager_request') {
    return CHANNEL_MAP['customer_issue'];
  } else if (classification === 'reactivation') {
    return CHANNEL_MAP['reactivation'];
  }
  return CHANNEL_MAP['default'];
}

// Main reconciliation function
async function reconcile() {
  const client = new Client(dbConfig);
  let routed = 0;
  let errors = [];

  try {
    // Connect to database
    console.log('Connecting to Supabase...');
    await client.connect();
    console.log('✓ Connected to Supabase database');

    // Get Discord token
    console.log('Retrieving Discord bot token via SSH...');
    let discordToken;
    try {
      discordToken = await getDiscordToken();
      console.log('✓ Retrieved Discord bot token');
    } catch (error) {
      throw new Error(`Token retrieval failed: ${error.message}`);
    }

    // Get unrouted replies
    console.log('Querying unrouted replies...');
    const replies = await getUnroutedReplies(client);
    console.log(`✓ Found ${replies.length} unrouted replies`);

    if (replies.length === 0) {
      console.log('No unrouted replies to process');
      return 'NO_REPLY';
    }

    // Process each reply
    for (const reply of replies) {
      try {
        const channelId = getChannelId(reply.classification);
        const message = formatMessage(reply);
        const mention = (reply.classification === 'customer_issue' || reply.classification === 'manager_request') 
          ? MENTION_ROLE 
          : null;

        await postToDiscord(discordToken, channelId, message, mention);
        await markAsRouted(client, reply.id);
        routed++;
        console.log(`✓ Routed reply ${reply.id}`);
      } catch (error) {
        errors.push(`Reply ${reply.id}: ${error.message}`);
        console.error(`✗ Error with reply ${reply.id}: ${error.message}`);
      }
    }

    // Return summary
    const summary = `Reconciliation complete: ${routed}/${replies.length} replies routed`;
    if (errors.length > 0) {
      console.error(`\nErrors: ${errors.length} failures`);
      errors.forEach(e => console.error(`  - ${e}`));
      return summary + ` (${errors.length} errors)`;
    }
    return summary;

  } catch (error) {
    console.error(`✗ Reconciliation failed: ${error.message}`);
    throw error;
  } finally {
    if (client) {
      try {
        await client.end();
      } catch (e) {
        console.error('Error closing database connection:', e.message);
      }
    }
  }
}

// Execute
reconcile()
  .then(result => {
    console.log(`\n${result}`);
    process.exit(0);
  })
  .catch(error => {
    console.error(`FATAL: ${error.message}`);
    process.exit(1);
  });
