#!/usr/bin/env node

const { Client } = require('pg');
const { exec } = require('child_process');
const { promisify } = require('util');
const https = require('https');

const execAsync = promisify(exec);

const CHANNEL_CONFIG = {
  'customer_issue': { id: '1502363455779504198', mention: '<@1390089142087717087>' },
  'manager_request': { id: '1502363455779504198', mention: '<@1390089142087717087>' },
  'reactivation': { id: '1502357456452587612' },
  'default': { id: '1439375021586911285' }
};

async function getDiscordBotToken() {
  try {
    const { stdout } = await execAsync(
      'ssh -i ~/.ssh/replit_wolfpackwash -p 22 01616f2b-facf-41fc-a607-25a0ebe18b96@01616f2b-facf-41fc-a607-25a0ebe18b96-00-3gcvfx18qfig3.riker.replit.dev \'printf "%s" "$DISCORD_BOT_TOKEN"\''
    );
    return stdout.trim();
  } catch (error) {
    throw new Error(`Failed to retrieve Discord bot token: ${error.message}`);
  }
}

async function queryUnroutedReplies() {
  const client = new Client({
    host: 'db.hclpovktywijfnswthpm.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: 'Eaglesfan1998$',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    const query = `
      SELECT id, from_address, body, channel, classification, received_at
      FROM hh_campaign_replies
      WHERE routed_to_discord = false
      AND classification != 'opt_out'
      AND received_at > NOW() - INTERVAL '48 hours'
      ORDER BY received_at DESC
    `;
    
    const result = await client.query(query);
    return result.rows;
  } finally {
    await client.end();
  }
}

async function postToDiscord(botToken, channelId, mention, reply) {
  const payload = {
    content: mention ? `${mention}\n**${reply.from_address}**\n\n${reply.body}` : `**${reply.from_address}**\n\n${reply.body}`,
    embeds: [{
      title: `${reply.classification.toUpperCase()} - ${reply.from_address}`,
      description: reply.body.substring(0, 2048),
      fields: [
        { name: 'Channel', value: reply.channel || 'unknown', inline: true },
        { name: 'Received', value: new Date(reply.received_at).toLocaleString(), inline: true }
      ],
      color: 0x0099ff
    }]
  };

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'discordapp.com',
      port: 443,
      path: `/api/v10/channels/${channelId}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(JSON.stringify(payload))
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, messageId: JSON.parse(data).id });
        } else {
          reject(new Error(`Discord API error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(payload));
    req.end();
  });
}

async function markAsRouted(replyId) {
  const client = new Client({
    host: 'db.hclpovktywijfnswthpm.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: 'Eaglesfan1998$',
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    await client.query(
      'UPDATE hh_campaign_replies SET routed_to_discord = true WHERE id = $1',
      [replyId]
    );
  } finally {
    await client.end();
  }
}

async function reconcile() {
  try {
    console.log('Starting Discord notification reconciliation...');
    
    // Get unrouted replies
    const replies = await queryUnroutedReplies();
    
    if (replies.length === 0) {
      console.log('NO_REPLY');
      return;
    }
    
    console.log(`Found ${replies.length} unrouted replies`);
    
    // Get Discord bot token
    const botToken = await getDiscordBotToken();
    console.log('Discord bot token retrieved');
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    // Route each reply
    for (const reply of replies) {
      try {
        const channelConfig = CHANNEL_CONFIG[reply.classification] || CHANNEL_CONFIG.default;
        const mention = ['customer_issue', 'manager_request'].includes(reply.classification) 
          ? channelConfig.mention 
          : '';
        
        console.log(`Posting ${reply.classification} from ${reply.from_address}...`);
        
        await postToDiscord(botToken, channelConfig.id, mention, reply);
        await markAsRouted(reply.id);
        
        successCount++;
        console.log(`✓ Routed reply ${reply.id}`);
      } catch (error) {
        errorCount++;
        const errMsg = `Failed to route reply ${reply.id} (${reply.from_address}): ${error.message}`;
        console.error(errMsg);
        errors.push(errMsg);
      }
    }
    
    console.log(`\nReconciliation complete: ${successCount} posted, ${errorCount} failed`);
    
    if (errorCount > 0) {
      console.error('ERRORS OCCURRED:');
      errors.forEach(e => console.error(`  - ${e}`));
      process.exit(1);
    }
  } catch (error) {
    console.error(`CRITICAL ERROR: ${error.message}`);
    process.exit(1);
  }
}

reconcile();
