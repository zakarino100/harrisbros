#!/usr/bin/env node

const { Client } = require('pg');
const twilio = require('twilio');

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
const twilioClient = twilio('AC0b9f60b9b4915f0e5dc728fcf1a913aa', '253218d7f0d336ed62c28a70be43b08c');

async function main() {
  try {
    await dbClient.connect();
    console.log('[INFO] Connected to Supabase');

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
      console.log('[INFO] No unsent leads found');
      await dbClient.end();
      process.stdout.write('NO_REPLY');
      process.exit(0);
    }

    console.log(`[INFO] Found ${leads.length} unsent lead(s)`);

    let successCount = 0;
    let failureCount = 0;

    // Process each lead
    for (const lead of leads) {
      try {
        const smsMessage = `New lead: ${lead.full_name} ${lead.phone} - check your Swell dashboard`;
        
        // Send SMS via Twilio
        const message = await twilioClient.messages.create({
          from: lead.twilio_from,
          to: lead.owner_phone,
          body: smsMessage
        });

        console.log(`[SENT] SMS to ${lead.owner_phone} for lead ${lead.full_name} (ID: ${lead.id})`);

        // Update database to mark as sent
        const updateQuery = 'UPDATE swell_leads SET sms_alert_sent = true WHERE id = $1';
        await dbClient.query(updateQuery, [lead.id]);
        console.log(`[UPDATE] Marked lead ${lead.id} as alert_sent`);

        successCount++;
      } catch (error) {
        console.error(`[ERROR] Failed to process lead ${lead.id}:`, error.message);
        failureCount++;
      }
    }

    await dbClient.end();

    // Report results
    console.log(`\n[SUMMARY] Processed ${successCount} successfully, ${failureCount} failed`);
    
    if (failureCount > 0) {
      process.stdout.write(`ERROR: ${failureCount} leads failed to send alerts`);
      process.exit(1);
    }

    process.stdout.write(`SUCCESS: Sent ${successCount} SMS alert(s)`);
    process.exit(0);

  } catch (error) {
    console.error('[FATAL ERROR]:', error.message);
    await dbClient.end().catch(() => {});
    process.stdout.write(`ALERT_ZAK: Database or Twilio error - ${error.message}`);
    process.exit(1);
  }
}

main();
