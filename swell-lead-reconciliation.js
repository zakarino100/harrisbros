const { Client } = require('pg');
const twilio = require('twilio');

// Database connection
const dbClient = new Client({
  host: 'aws-1-us-east-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.yrwuxcgvnzrzufcimrxl',
  password: 'BlueOcean2026',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});

// Twilio client
const twilioClient = twilio('AC0b9f60b9b4915f0e5dc728fcf1a913aa', '253218d7f0d336ed62c28a70be43b08c');

async function processLeads() {
  try {
    await dbClient.connect();
    
    // Query for unalerted leads
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
      await dbClient.end();
      console.log('NO_REPLY');
      process.exit(0);
    }
    
    let processed = 0;
    const errors = [];
    
    for (const lead of leads) {
      try {
        // Send SMS
        const message = `New lead: ${lead.full_name} ${lead.phone} - check your Swell dashboard`;
        
        await twilioClient.messages.create({
          body: message,
          from: lead.twilio_from,
          to: lead.owner_phone
        });
        
        // Mark as sent
        await dbClient.query(
          'UPDATE swell_leads SET sms_alert_sent=true WHERE id=$1',
          [lead.id]
        );
        
        console.log(`✓ Sent alert for lead: ${lead.full_name} (ID: ${lead.id})`);
        processed++;
      } catch (err) {
        errors.push({
          leadId: lead.id,
          leadName: lead.full_name,
          error: err.message
        });
        console.error(`✗ Error processing lead ${lead.full_name}:`, err.message);
      }
    }
    
    await dbClient.end();
    
    if (errors.length > 0) {
      console.error(`\n⚠️ ERRORS OCCURRED: ${errors.length}/${leads.length} failed`);
      console.error(JSON.stringify(errors, null, 2));
      process.exit(1);
    }
    
    console.log(`\n✅ Successfully processed ${processed}/${leads.length} leads`);
    process.exit(0);
    
  } catch (err) {
    console.error('CRITICAL ERROR:', err.message);
    console.error(err);
    process.exit(1);
  }
}

processLeads();
