#!/usr/bin/env node

const { Client } = require('pg');
const https = require('https');
const querystring = require('querystring');

// Database config
const dbConfig = {
  host: 'db.yrwuxcgvnzrzufcimrxl.pooler.supabase.com',
  port: 5432,
  user: 'postgres.yrwuxcgvnzrzufcimrxl',
  password: 'BlueOcean2026',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
};

// Twilio config
const TWILIO_SID = 'AC0b9f60b9b4915f0e5dc728fcf1a913aa';
const TWILIO_TOKEN = '253218d7f0d336ed62c28a70be43b08c';
const TWILIO_AUTH = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');

// Query for unsent SMS alerts
const query = `
  SELECT l.id, l.tenant_id, l.full_name, l.phone, l.email, l.created_at, t.owner_phone, t.twilio_from 
  FROM swell_leads l 
  JOIN swell_tenants t ON t.id = l.tenant_id 
  WHERE l.sms_alert_sent = false 
  AND l.created_at > NOW() - INTERVAL '48 hours' 
  AND l.full_name NOT LIKE '%test%' 
  AND l.full_name NOT LIKE '%dummy%' 
  AND l.full_name NOT LIKE '%Test%'
`;

async function sendTwilioSMS(fromNumber, toNumber, message) {
  return new Promise((resolve, reject) => {
    const data = querystring.stringify({
      From: fromNumber,
      To: toNumber,
      Body: message
    });

    const options = {
      hostname: 'api.twilio.com',
      port: 443,
      path: `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${TWILIO_AUTH}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Twilio error: ${res.statusCode} ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function markAlertSent(client, leadId) {
  await client.query('UPDATE swell_leads SET sms_alert_sent = true WHERE id = $1', [leadId]);
}

async function main() {
  const client = new Client(dbConfig);
  let errorOccurred = false;
  let sentCount = 0;

  try {
    await client.connect();
    console.log('Connected to Supabase');

    // Fetch unsent alerts
    const result = await client.query(query);
    
    if (result.rows.length === 0) {
      console.log('NO_REPLY');
      await client.end();
      process.exit(0);
    }

    console.log(`Found ${result.rows.length} unsent alerts`);

    // Process each lead
    for (const row of result.rows) {
      try {
        const message = `New lead: ${row.full_name} ${row.phone} - check your Swell dashboard`;
        
        console.log(`Sending SMS to ${row.owner_phone} from ${row.twilio_from}`);
        await sendTwilioSMS(row.twilio_from, row.owner_phone, message);
        
        // Mark as sent
        await markAlertSent(client, row.id);
        sentCount++;
        console.log(`✓ Alert sent for lead ${row.id}`);
      } catch (err) {
        console.error(`✗ Error processing lead ${row.id}: ${err.message}`);
        errorOccurred = true;
      }
    }

    console.log(`\nCompleted: ${sentCount}/${result.rows.length} alerts sent`);

    if (errorOccurred) {
      console.error('Some errors occurred during processing');
      process.exit(1);
    }

  } catch (err) {
    console.error(`Database/Connection error: ${err.message}`);
    errorOccurred = true;
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
