#!/usr/bin/env node

const { Client } = require('pg');
const twilio = require('twilio');

// Supabase credentials
const pgClient = new Client({
  host: 'aws-1-us-east-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.yrwuxcgvnzrzufcimrxl',
  password: 'BlueOcean2026',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});

// Twilio credentials
const twilioClient = twilio('AC0b9f60b9b4915f0e5dc728fcf1a913aa', '253218d7f0d336ed62c28a70be43b08c');

async function main() {
  try {
    console.log('[Swell Lead Alert Check] Starting...');
    
    // Connect to database
    await pgClient.connect();
    console.log('[DB] Connected to Supabase');
    
    // Query for unsent alerts
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
    const leads = result.rows;
    
    console.log(`[Query] Found ${leads.length} leads to notify`);
    
    if (leads.length === 0) {
      console.log('[Result] NO_REPLY - No unsent alerts');
      await pgClient.end();
      process.exit(0);
    }
    
    let successCount = 0;
    let errorCount = 0;
    const errors = [];
    
    // Process each lead
    for (const lead of leads) {
      try {
        const message = `New lead: ${lead.full_name} ${lead.phone} - check your Swell dashboard`;
        
        console.log(`[SMS] Sending to ${lead.owner_phone} for lead ${lead.full_name}`);
        
        // Send SMS via Twilio
        const smsResult = await twilioClient.messages.create({
          body: message,
          from: lead.twilio_from,
          to: lead.owner_phone
        });
        
        console.log(`[SMS] Sent: ${smsResult.sid}`);
        
        // Update database
        const updateQuery = 'UPDATE swell_leads SET sms_alert_sent = true WHERE id = $1';
        await pgClient.query(updateQuery, [lead.id]);
        console.log(`[DB] Updated lead ${lead.id}`);
        
        successCount++;
      } catch (err) {
        console.error(`[Error] Lead ${lead.id}: ${err.message}`);
        errorCount++;
        errors.push({
          leadId: lead.id,
          leadName: lead.full_name,
          error: err.message
        });
      }
    }
    
    // Summary
    console.log(`\n[Summary] Sent: ${successCount}, Errors: ${errorCount}`);
    
    if (errorCount > 0) {
      console.error('[ERROR] Some alerts failed:');
      errors.forEach(e => {
        console.error(`  - Lead ${e.leadId} (${e.leadName}): ${e.error}`);
      });
      console.log('\nAlerting Zak of errors...');
      process.exit(1);
    }
    
    await pgClient.end();
    process.exit(0);
    
  } catch (err) {
    console.error('[Fatal Error]', err);
    await pgClient.end();
    process.exit(1);
  }
}

main();
