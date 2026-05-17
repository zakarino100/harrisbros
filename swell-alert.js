const { Client } = require('pg');
const https = require('https');

// Database config
const dbClient = new Client({
  host: 'db.yrwuxcgvnzrzufcimrxl.pooler.supabase.com',
  port: 5432,
  user: 'postgres.yrwuxcgvnzrzufcimrxl',
  password: 'BlueOcean2026',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});

// Twilio config
const TWILIO_SID = 'AC0b9f60b9b4915f0e5dc728fcf1a913aa';
const TWILIO_TOKEN = '253218d7f0d336ed62c28a70be43b08c';
const TWILIO_AUTH = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');

async function sendTwilioSMS(from, to, message) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      From: from,
      To: to,
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
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
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
  try {
    await dbClient.connect();
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

    const result = await dbClient.query(query);
    const leads = result.rows;

    if (leads.length === 0) {
      console.log('NO_REPLY');
      await dbClient.end();
      process.exit(0);
    }

    console.log(`Found ${leads.length} leads to notify`);
    let successCount = 0;
    let errorCount = 0;

    for (const lead of leads) {
      try {
        const message = `New lead: ${lead.full_name} ${lead.phone} - check your Swell dashboard`;
        console.log(`Sending SMS to ${lead.owner_phone} from ${lead.twilio_from}`);
        
        await sendTwilioSMS(lead.twilio_from, lead.owner_phone, message);
        
        // Mark as sent in database
        await dbClient.query('UPDATE swell_leads SET sms_alert_sent = true WHERE id = $1', [lead.id]);
        successCount++;
        console.log(`✓ Lead ${lead.id} processed`);
      } catch (err) {
        errorCount++;
        console.error(`✗ Error processing lead ${lead.id}: ${err.message}`);
      }
    }

    console.log(`\nResults: ${successCount} sent, ${errorCount} errors`);
    
    if (errorCount > 0) {
      console.log('ALERT: Some leads failed to process');
      process.exit(1);
    }

    await dbClient.end();
    process.exit(0);
  } catch (err) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  }
}

main();
