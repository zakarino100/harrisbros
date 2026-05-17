const { Client } = require('pg');
const https = require('https');
const http = require('http');

// Database config
const dbConfig = {
  host: 'db.hclpovktywijfnswthpm.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Eaglesfan1998$',
  ssl: { rejectUnauthorized: false }
};

// Discord channel mappings
const CHANNELS = {
  updates: '1502363455779504198',
  reactivation: '1502357456452587612',
  leads: '1439375021586911285'
};

const MENTION = '<@1390089142087717087>';

async function getDiscordToken() {
  return new Promise((resolve, reject) => {
    const cmd = `ssh -i ~/.ssh/replit_wolfpackwash -p 22 01616f2b-facf-41fc-a607-25a0ebe18b96@01616f2b-facf-41fc-a607-25a0ebe18b96-00-3gcvfx18qfig3.riker.replit.dev 'printf "%s" "$DISCORD_BOT_TOKEN"'`;
    require('child_process').exec(cmd, (err, stdout, stderr) => {
      if (err) reject(new Error(`SSH failed: ${stderr}`));
      resolve(stdout.trim());
    });
  });
}

async function postToDiscord(token, channelId, content) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ content });
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
        if (res.statusCode === 201) resolve({ success: true });
        else reject(new Error(`Discord API error: ${res.statusCode} - ${data}`));
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const client = new Client(dbConfig);
  let routed = 0;
  let errors = [];

  try {
    await client.connect();
    console.log('Connected to Supabase');

    // Get Discord token
    const botToken = await getDiscordToken();
    if (!botToken) throw new Error('Failed to retrieve Discord bot token');

    // Query unrouted replies
    const result = await client.query(`
      SELECT id, phone_number, message, classification, created_at
      FROM hh_campaign_replies
      WHERE routed_to_discord = false
        AND classification != 'opt_out'
        AND received_at > NOW() - INTERVAL '48 hours'
      ORDER BY received_at DESC
    `);

    if (result.rows.length === 0) {
      console.log('NO_REPLY');
      return;
    }

    // Process each reply
    for (const row of result.rows) {
      try {
        let channelId = CHANNELS.leads;
        let content = `📱 New reply from ${row.phone_number}:\n"${row.message}"\n\nClassification: ${row.classification}`;

        if (row.classification === 'customer_issue' || row.classification === 'manager_request') {
          channelId = CHANNELS.updates;
          content = `${MENTION} ${content}`;
        } else if (row.classification === 'reactivation') {
          channelId = CHANNELS.reactivation;
        }

        // Post to Discord
        await postToDiscord(botToken, channelId, content);

        // Mark as routed
        await client.query(
          'UPDATE hh_campaign_replies SET routed_to_discord = true, routed_at = NOW() WHERE id = $1',
          [row.id]
        );

        routed++;
      } catch (err) {
        errors.push(`Reply ${row.id}: ${err.message}`);
      }
    }

    console.log(`✓ Routed ${routed} replies`);
    if (errors.length > 0) {
      console.log(`⚠ Errors: ${errors.join('; ')}`);
    }
  } catch (err) {
    console.error(`FATAL: ${err.message}`);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
