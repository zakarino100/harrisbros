#!/usr/bin/env node

const { Client } = require('pg');
const https = require('https');

// Supabase config
const pgClient = new Client({
  host: 'db.yrwuxcgvnzrzufcimrxl.aws-1-us-east-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.yrwuxcgvnzrzufcimrxl',
  password: 'BlueOcean2026',
  database: 'postgres',
  ssl: {
    rejectUnauthorized: false
  }
});

// Twilio config
const TWILIO_SID = 'AC0b9f60b9b4915f0e5dc728fcf1a913aa';
const TWILIO_TOKEN = '253218d7f0d336ed62c28a70be43b08c';
const TWILIO_AUTH = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');

async function sendSMSViatwilio(fromNumber, toNumber, message) {
  return new Promise((resolve, reject) => {
    const bodyData = new URLSearchParams({
      From: fromNumber,
      To: toNumber,
      Body: message
    }).toString();

    const options = {
      hostname: 'api.twilio.com',
      port: 443,
      path: `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${TWILIO_AUTH}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(bodyData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`Twilio error ${res.statusCode}: ${data}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse Twilio response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(bodyData);
    req.end();
  });
}

async function main() {
  let sentCount = 0;
  let errors = [];

  try {
    await pgClient.connect();

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

    const result = await pgClient.query(query);

    if (result.rows.length === 0) {
      console.log('NO_REPLY');
      await pgClient.end();
      process.exit(0);
    }

    // Process each lead
    for (const lead of result.rows) {
      try {
        const message = `New lead: ${lead.full_name} ${lead.phone} - check your Swell dashboard`;
        
        // Send SMS
        await sendSMSViatwilio(lead.twilio_from, lead.owner_phone, message);
        console.log(`✓ SMS sent to ${lead.owner_phone} for lead ${lead.id}`);

        // Update database
        await pgClient.query(
          'UPDATE swell_leads SET sms_alert_sent = true WHERE id = $1',
          [lead.id]
        );
        sentCount++;

      } catch (err) {
        const errMsg = `Lead ${lead.id}: ${err.message}`;
        console.error(`✗ ${errMsg}`);
        errors.push(errMsg);
      }
    }

    console.log(`\nProcessed ${sentCount} leads successfully.`);

    if (errors.length > 0) {
      console.error(`\n⚠️  ${errors.length} errors occurred:`);
      errors.forEach(e => console.error(`  - ${e}`));
      process.exit(1);
    }

    await pgClient.end();

  } catch (err) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  }
}

main();
