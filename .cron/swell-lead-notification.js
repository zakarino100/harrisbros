#!/usr/bin/env node

const { Client } = require('pg');
const https = require('https');
const querystring = require('querystring');

const DB_CONFIG = {
  host: 'db.yrwuxcgvnzrzufcimrxl.aws-1-us-east-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.yrwuxcgvnzrzufcimrxl',
  password: 'BlueOcean2026',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
};

const TWILIO_CONFIG = {
  sid: 'AC0b9f60b9b4915f0e5dc728fcf1a913aa',
  token: '253218d7f0d336ed62c28a70be43b08c'
};

const client = new Client(DB_CONFIG);

async function sendSMS(from, to, message) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${TWILIO_CONFIG.sid}:${TWILIO_CONFIG.token}`).toString('base64');
    
    const postData = querystring.stringify({
      From: from,
      To: to,
      Body: message
    });

    const options = {
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${TWILIO_CONFIG.sid}/Messages.json`,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (res.statusCode === 201) {
            resolve(result);
          } else {
            reject(new Error(`Twilio error: ${result.message || data}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function run() {
  const errors = [];
  let alertCount = 0;

  try {
    await client.connect();

    // Query for unsent leads
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

    const result = await client.query(query);
    const leads = result.rows;

    if (leads.length === 0) {
      console.log('NO_REPLY');
      await client.end();
      process.exit(0);
    }

    // Process each lead
    for (const lead of leads) {
      try {
        const message = `New lead: ${lead.full_name} ${lead.phone} - check your Swell dashboard`;
        
        // Send SMS
        await sendSMS(lead.twilio_from, lead.owner_phone, message);
        
        // Mark as sent
        await client.query(
          'UPDATE swell_leads SET sms_alert_sent = true WHERE id = $1',
          [lead.id]
        );
        
        alertCount++;
      } catch (err) {
        errors.push(`Lead ${lead.id}: ${err.message}`);
      }
    }

    // Report results
    if (errors.length > 0) {
      throw new Error(`Alerts sent: ${alertCount}, Errors: ${errors.join(' | ')}`);
    }

    console.log(`Sent ${alertCount} SMS alert(s)`);

  } catch (err) {
    // Alert Zak on error
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
