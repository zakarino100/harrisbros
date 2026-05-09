#!/usr/bin/env node

const { Client } = require('pg');
const { exec } = require('child_process');
const https = require('https');
const util = require('util');

const execPromise = util.promisify(exec);

// Supabase connection config
const supabaseClient = new Client({
  host: 'db.hclpovktywijfnswthpm.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Eaglesfan1998$',
  ssl: {
    rejectUnauthorized: false
  }
});

// Discord API constants
const DISCORD_CHANNELS = {
  updates: '1502363455779504198',
  reactivation: '1502357456452587612',
  leads: '1439375021586911285'
};

const DISCORD_MENTION_ROLE = '1390089142087717087'; // Manager role

async function getDiscordBotToken() {
  try {
    const { stdout } = await execPromise(
      'ssh -i ~/.ssh/replit_wolfpackwash -p 22 01616f2b-facf-41fc-a607-25a0ebe18b96@01616f2b-facf-41fc-a607-25a0ebe18b96-00-3gcvfx18qfig3.riker.replit.dev \'printf "%s" "$DISCORD_BOT_TOKEN"\''
    );
    return stdout.trim();
  } catch (error) {
    throw new Error(`Failed to retrieve Discord bot token: ${error.message}`);
  }
}

async function queryUnroutedReplies() {
  const query = `
    SELECT id, customer_name, message, classification, received_at, channel
    FROM hh_campaign_replies
    WHERE routed_to_discord = false
      AND classification != 'opt_out'
      AND received_at > NOW() - INTERVAL '48 hours'
    ORDER BY received_at DESC
  `;
  
  const result = await supabaseClient.query(query);
  return result.rows;
}

async function postToDiscord(botToken, channelId, content) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ content });
    
    const options = {
      hostname: 'discord.com',
      path: `/api/v10/channels/${channelId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve(JSON.parse(data));
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

async function markAsRouted(replyId) {
  const query = `
    UPDATE hh_campaign_replies
    SET routed_to_discord = true, routed_at = NOW()
    WHERE id = $1
  `;
  
  await supabaseClient.query(query, [replyId]);
}

async function getDeterminedChannel(classification) {
  switch (classification) {
    case 'customer_issue':
    case 'manager_request':
      return DISCORD_CHANNELS.updates;
    case 'reactivation':
      return DISCORD_CHANNELS.reactivation;
    default:
      return DISCORD_CHANNELS.leads;
  }
}

async function main() {
  try {
    console.log('[WPW Discord Reconciliation] Starting at', new Date().toISOString());
    
    // Connect to Supabase
    await supabaseClient.connect();
    console.log('[DB] Connected to Supabase');
    
    // Get unrouted replies
    const replies = await queryUnroutedReplies();
    console.log(`[DB] Found ${replies.length} unrouted replies`);
    
    if (replies.length === 0) {
      console.log('[Result] NO_REPLY');
      await supabaseClient.end();
      process.exit(0);
    }
    
    // Get Discord bot token
    const botToken = await getDiscordBotToken();
    console.log('[Discord] Retrieved bot token');
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    // Route each reply
    for (const reply of replies) {
      try {
        const channelId = await getDeterminedChannel(reply.classification);
        
        // Format message
        let message = `**${reply.customer_name}** (${reply.classification})\n`;
        if (reply.classification === 'customer_issue' || reply.classification === 'manager_request') {
          message += `<@&${DISCORD_MENTION_ROLE}>\n`;
        }
        message += `> ${reply.message}\n`;
        message += `_Received: <t:${Math.floor(new Date(reply.received_at).getTime() / 1000)}:R>_`;
        
        // Post to Discord
        await postToDiscord(botToken, channelId, message);
        console.log(`[Discord] Posted reply ${reply.id} to channel ${channelId}`);
        
        // Mark as routed
        await markAsRouted(reply.id);
        console.log(`[DB] Marked reply ${reply.id} as routed`);
        
        successCount++;
      } catch (error) {
        errorCount++;
        errors.push({ replyId: reply.id, error: error.message });
        console.error(`[Error] Failed to route reply ${reply.id}: ${error.message}`);
      }
    }
    
    // Disconnect
    await supabaseClient.end();
    
    // Summary
    const summary = `[WPW Discord Reconciliation] Complete\n- Routed: ${successCount}\n- Errors: ${errorCount}`;
    console.log(summary);
    
    if (errorCount > 0) {
      console.error('[Alert] Errors occurred:');
      console.error(JSON.stringify(errors, null, 2));
      process.exit(1);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('[Fatal Error]', error);
    process.exit(1);
  }
}

main();
