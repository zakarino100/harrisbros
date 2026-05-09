#!/usr/bin/env node

const { Client } = require('pg');
const https = require('https');
const { execSync } = require('child_process');

const SUPABASE_CONFIG = {
  host: 'db.hclpovktywijfnswthpm.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: process.env.SUPABASE_PASSWORD || 'Eaglesfan1998$',
  ssl: { rejectUnauthorized: false }
};

const DISCORD_CHANNELS = {
  updates: '1502363455779504198',
  reactivation: '1502357456452587612',
  leads: '1439375021586911285'
};

const MANAGER_MENTION = '1390089142087717087';

async function getDiscordBotToken() {
  try {
    console.log('[INFO] Fetching Discord bot token from SSH...');
    const token = execSync(
      'ssh -i ~/.ssh/replit_wolfpackwash -p 22 01616f2b-facf-41fc-a607-25a0ebe18b96@01616f2b-facf-41fc-a607-25a0ebe18b96-00-3gcvfx18qfig3.riker.replit.dev \'printf "%s" "$DISCORD_BOT_TOKEN"\'',
      { encoding: 'utf-8', timeout: 10000 }
    ).trim();
    
    if (!token) {
      throw new Error('Discord bot token is empty');
    }
    console.log('[OK] Discord bot token retrieved');
    return token;
  } catch (error) {
    console.error('[ERROR] Failed to fetch Discord bot token:', error.message);
    throw error;
  }
}

async function queryUnroutedReplies(client) {
  try {
    console.log('[INFO] Querying unrouted campaign replies...');
    const query = `
      SELECT id, from_address, body, classification, received_at
      FROM hh_campaign_replies
      WHERE routed_to_discord = false
        AND classification != 'opt_out'
        AND received_at > NOW() - INTERVAL '48 hours'
      ORDER BY received_at DESC
    `;
    
    const result = await client.query(query);
    console.log(`[OK] Found ${result.rows.length} unrouted replies`);
    return result.rows;
  } catch (error) {
    console.error('[ERROR] Database query failed:', error.message);
    throw error;
  }
}

async function postToDiscord(token, channelId, content) {
  return new Promise((resolve, reject) => {
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
          const json = JSON.parse(data);
          resolve(json.id);
        } else {
          reject(new Error(`Discord API error: ${res.statusCode} - ${data}`));
        }
      });
    });
    
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function markAsRouted(client, replyId) {
  try {
    const query = `
      UPDATE hh_campaign_replies
      SET routed_to_discord = true, routed_at = NOW()
      WHERE id = $1
    `;
    await client.query(query, [replyId]);
  } catch (error) {
    console.error(`[ERROR] Failed to mark reply ${replyId} as routed:`, error.message);
    throw error;
  }
}

async function main() {
  const client = new Client(SUPABASE_CONFIG);
  let discordToken;
  let routed = 0;
  let failed = 0;
  
  try {
    // Connect to database
    console.log('[INFO] Connecting to Supabase...');
    await client.connect();
    console.log('[OK] Connected to Supabase');
    
    // Get Discord token
    discordToken = await getDiscordBotToken();
    
    // Query unrouted replies
    const replies = await queryUnroutedReplies(client);
    
    if (replies.length === 0) {
      console.log('[RESULT] NO_REPLY');
      return;
    }
    
    // Route each reply
    for (const reply of replies) {
      try {
        let channelId;
        let message;
        
        if (reply.classification === 'customer_issue' || reply.classification === 'manager_request') {
          channelId = DISCORD_CHANNELS.updates;
          message = `<@${MANAGER_MENTION}> **Customer Issue/Manager Request**\n` +
                   `From: ${reply.from_address}\n` +
                   `Message: ${reply.body}\n` +
                   `Received: ${new Date(reply.received_at).toISOString()}`;
        } else if (reply.classification === 'reactivation') {
          channelId = DISCORD_CHANNELS.reactivation;
          message = `**Reactivation Reply**\n` +
                   `From: ${reply.from_address}\n` +
                   `Message: ${reply.body}\n` +
                   `Received: ${new Date(reply.received_at).toISOString()}`;
        } else {
          channelId = DISCORD_CHANNELS.leads;
          message = `**Lead Reply** (${reply.classification})\n` +
                   `From: ${reply.from_address}\n` +
                   `Message: ${reply.body}\n` +
                   `Received: ${new Date(reply.received_at).toISOString()}`;
        }
        
        // Post to Discord
        const messageId = await postToDiscord(discordToken, channelId, message);
        console.log(`[OK] Posted reply ${reply.id} to Discord (message: ${messageId})`);
        
        // Mark as routed
        await markAsRouted(client, reply.id);
        routed++;
        
      } catch (error) {
        console.error(`[ERROR] Failed to route reply ${reply.id}:`, error.message);
        failed++;
      }
    }
    
    // Summary
    console.log(`\n[RESULT] Routed: ${routed}, Failed: ${failed}, Total: ${replies.length}`);
    
  } catch (error) {
    console.error('[CRITICAL] Reconciliation failed:', error.message);
    console.log('[ALERT] Alerting Zak of critical error...');
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('[FATAL]', error);
  process.exit(1);
});
