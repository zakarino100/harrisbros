#!/usr/bin/env node

const { Client } = require('pg');
const twilio = require('twilio');

// Configuration
const DB_HOST = 'db.yrwuxcgvnzrzufcimrxl.aws-1-us-east-1.pooler.supabase.com';
const DB_PORT = 5432;
const DB_NAME = 'postgres';
const DB_USER = process.env.SUPABASE_DB_USER;
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;

const TWILIO_SID = process.env.TWILIO_SID || 'AC0b9f60b9b4915f0e5dc728fcf1a913aa';
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;

const CURRENT_TIME = new Date('2026-05-14T12:43:00Z');
const CUTOFF_TIME = new Date(CURRENT_TIME.getTime() - 48 * 60 * 60 * 1000);

async function main() {
  let client;
  let sent = 0;
  let errors = [];

  try {
    // Validate credentials
    if (!DB_USER || !DB_PASSWORD) {
      throw new Error('Missing SUPABASE_DB_USER or SUPABASE_DB_PASSWORD environment variables');
    }
    if (!TWILIO_TOKEN) {
      throw new Error('Missing TWILIO_AUTH_TOKEN environment variable');
    }
    if (!TWILIO_FROM) {
      throw new Error('Missing TWILIO_PHONE_NUMBER environment variable');
    }

    // Connect to Supabase PostgreSQL
    client = new Client({
      host: DB_HOST,
      port: DB_PORT,
      database: DB_NAME,
      user: DB_USER,
      password: DB_PASSWORD,
      ssl: 'require'
    });

    await client.connect();
    console.log('✓ Connected to Supabase');

    // Initialize Twilio
    const twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);
    console.log('✓ Twilio client initialized');

    // Query unsent SMS alerts from last 48h, excluding test/dummy leads
    const query = `
      SELECT 
        sl.id,
        sl.lead_id,
        sl.phone_number,
        sl.tenant_owner_phone,
        sl.created_at,
        sl.lead_name
      FROM swell_leads sl
      WHERE sl.sms_alert_sent = false
        AND sl.created_at >= $1
        AND sl.created_at <= $2
        AND sl.lead_name NOT ILIKE '%test%'
        AND sl.lead_name NOT ILIKE '%dummy%'
      ORDER BY sl.created_at DESC
    `;

    const result = await client.query(query, [CUTOFF_TIME, CURRENT_TIME]);
    const leads = result.rows;

    console.log(`Found ${leads.length} unsent SMS alerts`);

    if (leads.length === 0) {
      console.log('NO_REPLY');
      await client.end();
      process.exit(0);
    }

    // Process each lead
    for (const lead of leads) {
      try {
        const phoneNumber = lead.tenant_owner_phone || lead.phone_number;
        if (!phoneNumber) {
          errors.push(`Lead ${lead.id}: No phone number found`);
          continue;
        }

        // Send SMS via Twilio
        await twilioClient.messages.create({
          body: `New Swell lead: ${lead.lead_name}. Lead ID: ${lead.lead_id}`,
          from: TWILIO_FROM,
          to: phoneNumber
        });

        // Update database to mark as sent
        await client.query(
          'UPDATE swell_leads SET sms_alert_sent = true, sms_alert_sent_at = $1 WHERE id = $2',
          [new Date(), lead.id]
        );

        sent++;
        console.log(`✓ Lead ${lead.id}: SMS sent to ${phoneNumber}`);
      } catch (err) {
        const errorMsg = `Lead ${lead.id}: ${err.message}`;
        errors.push(errorMsg);
        console.error(`✗ ${errorMsg}`);
      }
    }

    // Final report
    console.log('\n--- RECONCILIATION REPORT ---');
    console.log(`Total leads processed: ${leads.length}`);
    console.log(`SMS sent: ${sent}`);
    console.log(`Errors: ${errors.length}`);
    
    if (errors.length > 0) {
      console.log('\nError details:');
      errors.forEach(err => console.log(`  - ${err}`));
    }

    await client.end();
    process.exit(sent > 0 ? 0 : 1);
  } catch (err) {
    console.error('Fatal error:', err.message);
    if (client) await client.end();
    process.exit(1);
  }
}

main();
