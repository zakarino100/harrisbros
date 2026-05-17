#!/usr/bin/env node
const { Client } = require('pg');
const https = require('https');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Supabase connection
const supabaseClient = new Client({
  host: 'db.hclpovktywijfnswthpm.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Eaglesfan1998$',
  ssl: { rejectUnauthorized: false }
});

// Discord channel mapping
const DISCORD_CHANNELS = {
  'customer_issue': '1502363455779504198',
  'manager_request': '1502363455779504198',
  'reactivation': '1502357456452587612',
  'default': '1439375021586911285'
};

const DISCORD_MENTION = '1390089142087717087'; // Manager mention ID
const REPLIT_HOST = '01616f2b-facf-41fc-a607-25a0ebe18b96@01616f2b-facf-41fc-a607-25a0ebe18b96-00-3gcvfx18qfig3.riker.replit.dev';
const SSH_KEY = '~/.ssh/replit_wolfpackwash';

// Helper: Get Discord token from Replit
async function getDiscordToken() {
  try {
    const { stdout } = await execAsync(
      `ssh -i ${SSH_KEY} -p 22 ${REPLIT_HOST} 'printf "%s" "$DISCORD_BOT_TOKEN"'`
    );
    return stdout.trim();
  } catch (error) {
    console.error('Failed to fetch Discord token from Replit:', error.message);
    throw error;
  }
}

// Helper: Post to Discord
async function postToDiscord(token, channelId, message) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ content: message });
    
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
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          resolve({ success: true, messageId: JSON.parse(data).id });
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

// Main reconciliation
async function reconcile() {
  try {
    await supabaseClient.connect();
    console.log('Connected to Supabase');

    // Query unrouted replies from last 48 hours
    const query = `
      SELECT id, from_address, body, subject, classification, received_at, channel
      FROM hh_campaign_replies
      WHERE routed_to_discord = false
        AND classification IS NOT NULL
        AND classification != 'opt_out'
        AND received_at > NOW() - INTERVAL '48 hours'
      ORDER BY received_at ASC
    `;

    const result = await supabaseClient.query(query);
    const replies = result.rows;

    if (replies.length === 0) {
      console.log('NO_REPLY - No unrouted replies found');
      await supabaseClient.end();
      return { status: 'NO_REPLY', count: 0 };
    }

    console.log(`Found ${replies.length} unrouted replies`);

    // Get Discord token
    const discordToken = await getDiscordToken();
    console.log('Discord token retrieved');

    // Process each reply
    let successCount = 0;
    let errorCount = 0;

    for (const reply of replies) {
      try {
        // Determine channel based on classification
        let channelId = DISCORD_CHANNELS.default;
        let mention = '';

        if (reply.classification === 'customer_issue' || reply.classification === 'manager_request') {
          channelId = DISCORD_CHANNELS['customer_issue'];
          mention = `<@${DISCORD_MENTION}> `;
        } else if (reply.classification === 'reactivation') {
          channelId = DISCORD_CHANNELS.reactivation;
        }

        // Format message
        const displayName = reply.from_address || 'Unknown';
        const messageContent = reply.body || reply.subject || 'No message';
        const message = `${mention}**${displayName}** (${reply.channel})\n${messageContent}\n_Classification: ${reply.classification}_`;

        // Post to Discord
        await postToDiscord(discordToken, channelId, message);
        console.log(`✓ Posted reply ${reply.id} to channel ${channelId}`);

        // Update database
        await supabaseClient.query(
          'UPDATE hh_campaign_replies SET routed_to_discord = true WHERE id = $1',
          [reply.id]
        );
        successCount++;

      } catch (error) {
        console.error(`✗ Error processing reply ${reply.id}:`, error.message);
        errorCount++;
      }
    }

    await supabaseClient.end();
    
    const summary = `Reconciliation complete: ${successCount} routed, ${errorCount} errors`;
    console.log(summary);
    
    if (errorCount > 0) {
      throw new Error(summary);
    }

    return { status: 'success', routed: successCount, errors: errorCount };

  } catch (error) {
    console.error('RECONCILIATION ERROR:', error.message);
    // In production, alert Zak here
    await supabaseClient.end().catch(() => {});
    throw error;
  }
}

// Run
reconcile()
  .then((result) => {
    console.log(JSON.stringify(result));
    process.exit(0);
  })
  .catch((error) => {
    console.error('FATAL:', error.message);
    process.exit(1);
  });
