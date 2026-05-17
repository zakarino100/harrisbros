#!/usr/bin/env node

const { Client } = require('pg');
const https = require('https');
const { execSync } = require('child_process');

// Configuration
const DB_CONFIG = {
  host: 'db.hclpovktywijfnswthpm.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Eaglesfan1998$',
  ssl: {
    rejectUnauthorized: false,
  },
};

const DISCORD_CHANNELS = {
  customer_issue: { id: '1502363455779504198', mention: '@1390089142087717087' },
  manager_request: { id: '1502363455779504198', mention: '@1390089142087717087' },
  reactivation: { id: '1502357456452587612' },
  default: { id: '1439375021586911285' },
};

const SSH_COMMAND = 'ssh -i ~/.ssh/replit_wolfpackwash -p 22 01616f2b-facf-41fc-a607-25a0ebe18b96@01616f2b-facf-41fc-a607-25a0ebe18b96-00-3gcvfx18qfig3.riker.replit.dev \'printf "%s" "$DISCORD_BOT_TOKEN"\'';

// Get Discord bot token
async function getDiscordToken() {
  try {
    const token = execSync(SSH_COMMAND, { encoding: 'utf-8' }).trim();
    if (!token) throw new Error('Empty token received');
    return token;
  } catch (error) {
    console.error('Failed to retrieve Discord token:', error.message);
    throw new Error('Unable to fetch Discord bot token');
  }
}

// Query Supabase for unrouted replies
async function getUnroutedReplies(client) {
  const query = `
    SELECT id, from_address, customer_id, body, classification, received_at, channel
    FROM hh_campaign_replies
    WHERE routed_to_discord = false
      AND classification != 'opt_out'
      AND received_at > NOW() - INTERVAL '48 hours'
    ORDER BY received_at ASC
  `;
  
  try {
    const result = await client.query(query);
    return result.rows;
  } catch (error) {
    console.error('Database query failed:', error.message);
    throw new Error('Failed to query unrouted replies');
  }
}

// Determine Discord channel based on classification
function getDiscordChannel(classification) {
  if (classification === 'customer_issue' || classification === 'manager_request') {
    return DISCORD_CHANNELS.customer_issue;
  }
  if (classification === 'reactivation') {
    return DISCORD_CHANNELS.reactivation;
  }
  return DISCORD_CHANNELS.default;
}

// Post to Discord
async function postToDiscord(botToken, channelId, content) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ content });
    
    const options = {
      hostname: 'discord.com',
      path: `/api/v10/channels/${channelId}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
        'Authorization': `Bot ${botToken}`,
      },
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, statusCode: res.statusCode });
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

// Update database to mark reply as routed
async function markAsRouted(client, replyId) {
  const query = 'UPDATE hh_campaign_replies SET routed_to_discord = true WHERE id = $1';
  try {
    await client.query(query, [replyId]);
  } catch (error) {
    console.error(`Failed to mark reply ${replyId} as routed:`, error.message);
    throw error;
  }
}

// Main function
async function reconcileNotifications() {
  const client = new Client(DB_CONFIG);
  
  try {
    // Connect to database
    await client.connect();
    console.log('Connected to Supabase');
    
    // Get unrouted replies
    const replies = await getUnroutedReplies(client);
    
    if (replies.length === 0) {
      console.log('No unrouted replies found');
      process.stdout.write('NO_REPLY');
      await client.end();
      process.exit(0);
    }
    
    console.log(`Found ${replies.length} unrouted replies`);
    
    // Get Discord token
    const discordToken = await getDiscordToken();
    console.log('Discord token retrieved');
    
    let successCount = 0;
    let errorCount = 0;
    
    // Process each reply
    for (const reply of replies) {
      try {
        const channel = getDiscordChannel(reply.classification);
        
        // Format message
        let message = `📞 **${reply.from_address || 'Unknown'}** (ID: ${reply.customer_id})\n`;
        message += `Classification: ${reply.classification}\n`;
        message += `Channel: ${reply.channel}\n`;
        message += `Message: ${reply.body}\n`;
        message += `Received: ${reply.received_at}`;
        
        // Add mention for customer issues/manager requests
        if (reply.classification === 'customer_issue' || reply.classification === 'manager_request') {
          message = `${channel.mention}\n\n${message}`;
        }
        
        // Post to Discord
        await postToDiscord(discordToken, channel.id, message);
        console.log(`✓ Posted reply ${reply.id} to channel ${channel.id}`);
        
        // Mark as routed
        await markAsRouted(client, reply.id);
        successCount++;
      } catch (error) {
        console.error(`✗ Error processing reply ${reply.id}:`, error.message);
        errorCount++;
      }
    }
    
    await client.end();
    
    // Summary
    console.log(`\n=== RECONCILIATION COMPLETE ===`);
    console.log(`Success: ${successCount}`);
    console.log(`Errors: ${errorCount}`);
    
    if (errorCount > 0) {
      process.stdout.write(`PARTIAL_ERROR: ${successCount}/${replies.length} routed`);
      process.exit(1);
    } else {
      process.stdout.write(`SUCCESS: ${successCount} replies routed`);
      process.exit(0);
    }
    
  } catch (error) {
    console.error('Fatal error:', error.message);
    await client.end().catch(() => {});
    process.stdout.write(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

// Run the reconciliation
reconcileNotifications();
