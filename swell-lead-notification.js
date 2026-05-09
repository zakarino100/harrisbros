#!/usr/bin/env node

const { Client } = require('pg');
const https = require('https');

// Database config
const dbConfig = {
  host: 'db.yrwuxcgvnzrzufcimrxl.pooler.supabase.com',
  port: 5432,
  user: 'postgres.yrwuxcgvnzrzufcimrxl',
  password: 'BlueOcean2026',
  database: 'postgres',
  ssl: {
    rejectUnauthorized: false
  }
};

// Twilio config
const TWILIO_SID = 'AC0b9f60b9b4915f0e5dc728fcf1a913aa';
const TWILIO_TOKEN = '253218d7f0d336ed62c28a70be43b08c';

// Send SMS via Twilio
async function sendTwilioSMS(fromNumber, toNumber, message) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
    
    const postData = new URLSearchParams({
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
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Twilio error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  const client = new Client(dbConfig);
  const alerts = [];
  const errors = [];

  try {
    await client.connect();
    console.log('Connected to Supabase');

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
    console.log(`Found ${result.rows.length} unsent leads`);

    if (result.rows.length === 0) {
      await client.end();
      console.log('NO_REPLY');
      process.exit(0);
    }

    // Process each lead
    for (const lead of result.rows) {
      try {
        const message = `New lead: ${lead.full_name} ${lead.phone} - check your Swell dashboard`;
        
        console.log(`Sending SMS to ${lead.owner_phone} for lead ${lead.id}...`);
        await sendTwilioSMS(lead.twilio_from, lead.owner_phone, message);
        
        // Mark as sent
        await client.query(
          'UPDATE swell_leads SET sms_alert_sent = true WHERE id = $1',
          [lead.id]
        );
        
        alerts.push({
          leadId: lead.id,
          leadName: lead.full_name,
          leadPhone: lead.phone,
          ownerPhone: lead.owner_phone,
          sent: true
        });
        
        console.log(`✓ Alert sent for lead ${lead.id}`);
      } catch (err) {
        errors.push({
          leadId: lead.id,
          leadName: lead.full_name,
          error: err.message
        });
        console.error(`✗ Error processing lead ${lead.id}: ${err.message}`);
      }
    }

    await client.end();

    // Summary
    console.log(`\n=== SUMMARY ===`);
    console.log(`Alerts sent: ${alerts.length}`);
    console.log(`Errors: ${errors.length}`);

    if (errors.length > 0) {
      console.error('\n=== ERRORS ===');
      errors.forEach(e => {
        console.error(`Lead ${e.leadId} (${e.leadName}): ${e.error}`);
      });
      console.log('\n⚠️ ALERT ZAK: Errors occurred during SMS notifications');
      process.exit(1);
    }

  } catch (err) {
    console.error('Fatal error:', err.message);
    console.log('\n⚠️ ALERT ZAK: Fatal error in Swell lead notification process');
    process.exit(1);
  }
}

main();
