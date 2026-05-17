#!/usr/bin/env node
// MackWash New Lead Alert — checks Swell DB for new leads and SMS Mack

import pkg from '/opt/homebrew/lib/node_modules/pg/lib/index.js';
const { Client } = pkg;

const SWELL_URL    = 'postgresql://postgres.yrwuxcgvnzrzufcimrxl:BlueOcean2026@aws-1-us-east-1.pooler.supabase.com:5432/postgres';
const TWILIO_SID   = 'AC0b9f60b9b4915f0e5dc728fcf1a913aa';
const TWILIO_TOKEN = '253218d7f0d336ed62c28a70be43b08c';
const FROM_NUMBER  = '+17704158392'; // MackWash Twilio from (confirmed from Swell DB)
const MACK_NUMBER  = '+14708741267';

async function sendSms(to, body) {
  const creds = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: FROM_NUMBER, Body: body }).toString(),
  });
  return res.ok;
}

async function main() {
  const client = new Client({ connectionString: SWELL_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    // Check if sms_alert_sent column exists
    const { rows: cols } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'swell_leads' AND column_name = 'sms_alert_sent'
    `);

    let leads;
    if (cols.length > 0) {
      const { rows } = await client.query(`
        SELECT id, full_name, phone, created_at
        FROM swell_leads
        WHERE tenant_id = (SELECT id FROM swell_tenants WHERE name = 'MACKWASH')
          AND sms_alert_sent = false
          AND created_at > NOW() - INTERVAL '60 minutes'
        ORDER BY created_at DESC
        LIMIT 10
      `);
      leads = rows;
    } else {
      // Fallback: check for leads in last 60 min regardless of flag
      const { rows } = await client.query(`
        SELECT id, full_name, phone, created_at
        FROM swell_leads
        WHERE tenant_id = (SELECT id FROM swell_tenants WHERE name = 'MACKWASH')
          AND created_at > NOW() - INTERVAL '60 minutes'
        ORDER BY created_at DESC
        LIMIT 10
      `);
      leads = rows;
    }

    if (leads.length === 0) {
      process.stdout.write('NO_REPLY');
      return;
    }

    for (const lead of leads) {
      const msg = `New MackWash lead: ${lead.full_name || 'Unknown'} ${lead.phone || ''} — check Swell dashboard`;
      await sendSms(MACK_NUMBER, msg);

      if (cols.length > 0) {
        await client.query(`UPDATE swell_leads SET sms_alert_sent = true WHERE id = $1`, [lead.id]);
      }
    }

    console.log(`Alerted Mack: ${leads.length} new lead(s)`);
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
