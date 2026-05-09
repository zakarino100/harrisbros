const pg = require('pg');
const https = require('https');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const dbConfig = {
  host: 'db.hclpovktywijfnswthpm.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Eaglesfan1998$',
  ssl: { rejectUnauthorized: false }
};

const MANAGER_ROLE_ID = '1390089142087717087';
const DEFAULT_CHANNEL = '1439375021586911285';
const REACTIVATION_CHANNEL = '1502357456452587612';
const UPDATES_CHANNEL = '1502363455779504198';

async function getDiscordToken() {
  try {
    const { stdout } = await execAsync('ssh -i ~/.ssh/replit_wolfpackwash -p 22 01616f2b-facf-41fc-a607-25a0ebe18b96@01616f2b-facf-41fc-a607-25a0ebe18b96-00-3gcvfx18qfig3.riker.replit.dev \'printf "%s" "$DISCORD_BOT_TOKEN"\'');
    return stdout.trim();
  } catch (error) {
    throw new Error(`SSH error: ${error.message}`);
  }
}

async function postToDiscord(token, channelId, message, mentionRoleId) {
  return new Promise((resolve, reject) => {
    const content = mentionRoleId ? `<@&${mentionRoleId}>\n${message}` : message;
    
    const payload = JSON.stringify({
      content: content,
      allowed_mentions: { roles: mentionRoleId ? [mentionRoleId] : [] }
    });

    const options = {
      hostname: 'discord.com',
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
          resolve({ success: true });
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

async function main() {
  const client = new pg.Client(dbConfig);
  
  try {
    await client.connect();
    
    // Query unrouted replies
    const result = await client.query(
      `SELECT id, from_address, body, classification, intent_label, urgency, discord_channel_id
       FROM hh_campaign_replies 
       WHERE routed_to_discord = false 
       AND classification != 'opt_out' 
       AND received_at > NOW() - INTERVAL '48 hours'
       ORDER BY received_at DESC`
    );

    if (result.rows.length === 0) {
      console.log('NO_REPLY');
      await client.end();
      return;
    }

    let discordToken;
    try {
      discordToken = await getDiscordToken();
    } catch (error) {
      console.error(`ALERT_ZAK: Failed to get Discord token: ${error.message}`);
      await client.end();
      return;
    }

    let successCount = 0;
    let failedIds = [];

    for (const reply of result.rows) {
      try {
        const message = `**From:** ${reply.from_address}\n${reply.body}`;
        
        // Determine channel and mention role
        let channelId = DEFAULT_CHANNEL;
        let mentionRole = null;

        if (reply.classification === 'customer_issue' || reply.classification === 'manager_request') {
          channelId = UPDATES_CHANNEL;
          mentionRole = MANAGER_ROLE_ID;
        } else if (reply.classification === 'reactivation') {
          channelId = REACTIVATION_CHANNEL;
        }

        // Override with explicitly set channel if present
        if (reply.discord_channel_id) {
          channelId = reply.discord_channel_id;
        }

        await postToDiscord(discordToken, channelId, message, mentionRole);

        // Mark as routed
        await client.query(
          'UPDATE hh_campaign_replies SET routed_to_discord = true WHERE id = $1',
          [reply.id]
        );

        successCount++;
      } catch (error) {
        console.error(`Failed to route reply ${reply.id}: ${error.message}`);
        failedIds.push(reply.id);
      }
    }

    console.log(`Routed ${successCount}/${result.rows.length} replies`);
    
    if (failedIds.length > 0) {
      console.error(`ALERT_ZAK: Failed to route ${failedIds.length} replies: ${failedIds.join(', ')}`);
    }

    await client.end();
  } catch (error) {
    console.error(`ALERT_ZAK: Database error: ${error.message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`ALERT_ZAK: Fatal error: ${err.message}`);
  process.exit(1);
});
