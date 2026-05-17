#!/usr/bin/env node
// MackWash New Lead Alert Cron
// Queries Swell Supabase for new unalerted leads, sends SMS via Twilio, marks as sent.

const { Client } = require('/opt/homebrew/lib/node_modules/pg');
const https = require('https');

const TWILIO_SID   = 'AC0b9f60b9b4915f0e5dc728fcf1a913aa';
const TWILIO_TOKEN = '253218d7f0d336ed62c28a70be43b08c';
const MACK_NUMBER  = '+14708741267';

function twilioSend(from, to, body) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ To: to, From: from, Body: body }).toString();
    const auth   = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
    const opts = {
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(params),
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const parsed = JSON.parse(data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(parsed);
        } else {
          reject(new Error(`Twilio ${res.statusCode}: ${parsed.message || data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(params);
    req.end();
  });
}

async function main() {
  const db = new Client({
    host: 'aws-1-us-east-1.pooler.supabase.com',
    port: 5432,
    user: 'postgres.yrwuxcgvnzrzufcimrxl',
    password: 'BlueOcean2026',
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  await db.connect();

  // Get MackWash tenant info (includes twilio_from)
  const { rows: tenants } = await db.query(
    "SELECT id, twilio_from FROM swell_tenants WHERE id = 'mackwash' LIMIT 1"
  );

  if (!tenants.length) {
    console.error('MackWash tenant not found in swell_tenants');
    await db.end();
    process.exit(1);
  }

  const { id: tenantId, twilio_from: twilioFrom } = tenants[0];

  if (!twilioFrom) {
    console.error('MackWash has no twilio_from number configured');
    await db.end();
    process.exit(1);
  }

  // Query new leads in the last 60 minutes that haven't been alerted
  const { rows: leads } = await db.query(`
    SELECT id, full_name, phone, created_at
    FROM swell_leads
    WHERE tenant_id = $1
      AND sms_alert_sent = false
      AND created_at > NOW() - INTERVAL '1 hour'
    ORDER BY created_at ASC
  `, [tenantId]); // tenantId is 'mackwash' (text PK)

  if (leads.length === 0) {
    console.log('NO_REPLY');
    await db.end();
    return;
  }

  console.log(`Found ${leads.length} new lead(s) for MackWash. Sending alerts...`);

  let sent = 0;
  let errors = 0;

  for (const lead of leads) {
    try {
      const name  = lead.full_name || 'Unknown';
      const phone = lead.phone     || 'No phone';
      const msg   = `New lead: ${name} ${phone} - check Swell dashboard`;

      await twilioSend(twilioFrom, MACK_NUMBER, msg);

      await db.query(
        'UPDATE swell_leads SET sms_alert_sent = true, sms_alert_sent_at = NOW() WHERE id = $1',
        [lead.id]
      );

      console.log(`✓ Alerted lead ${lead.id} (${name})`);
      sent++;

      // Avoid Twilio rate limits
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`✗ Failed to alert lead ${lead.id}: ${err.message}`);
      errors++;
    }
  }

  await db.end();
  console.log(`Done. Sent: ${sent}, Errors: ${errors}`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
