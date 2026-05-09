#!/usr/bin/env node

const { Pool } = require('pg');

const pool = new Pool({
  host: 'db.hclpovktywijfnswthpm.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Eaglesfan1998$',
  ssl: { rejectUnauthorized: false }
});

async function verify() {
  try {
    // Get detailed conversion data
    console.log('\n🎯 DETAILED CONVERSION ANALYSIS\n');
    
    const converted = await pool.query(`
      SELECT phone, quoted_price, service_type, service_address, first_contact, was_serviced, review_left
      FROM wpw_voice_conversations
      WHERE converted = true
      ORDER BY first_contact DESC
    `);
    
    console.log(`TRULY CONVERTED (quoted_price > 0 AND was_serviced): ${converted.rows.length}\n`);
    
    for (const row of converted.rows.slice(0, 15)) {
      console.log(`📞 ${row.phone}`);
      console.log(`   Quoted: $${row.quoted_price} | Service: ${row.service_type || 'N/A'}`);
      console.log(`   Address: ${row.service_address || 'N/A'}`);
      console.log(`   Review: ${row.review_left ? '✓ Left' : '✗ Not left'}\n`);
    }
    
    if (converted.rows.length > 15) {
      console.log(`... and ${converted.rows.length - 15} more\n`);
    }
    
    // Get all serviced for campaign tracking
    console.log('\n💼 ALL SERVICED CUSTOMERS (For campaign tracking)\n');
    const serviced = await pool.query(`
      SELECT phone, service_address, quoted_price, service_type, first_contact, matched_campaign_send_id
      FROM wpw_voice_conversations
      WHERE was_serviced = true
      ORDER BY first_contact DESC
      LIMIT 10
    `);
    
    const totalServiced = await pool.query('SELECT COUNT(*) as count FROM wpw_voice_conversations WHERE was_serviced = true');
    console.log(`Total serviced: ${totalServiced.rows[0].count}\n`);
    
    for (const row of serviced.rows) {
      const campaign = row.matched_campaign_send_id ? `✓ Matched (ID: ${row.matched_campaign_send_id})` : '✗ Not matched';
      console.log(`📞 ${row.phone}`);
      console.log(`   Price: ${row.quoted_price ? '$' + row.quoted_price : 'N/A'} | Service: ${row.service_type || 'N/A'}`);
      console.log(`   Campaign: ${campaign}\n`);
    }
    
    // Check for data quality issues
    console.log('\n📋 DATA QUALITY CHECK\n');
    
    const noPriceServiced = await pool.query(`
      SELECT COUNT(*) as count FROM wpw_voice_conversations
      WHERE was_serviced = true AND quoted_price IS NULL
    `);
    
    const noAddressServiced = await pool.query(`
      SELECT COUNT(*) as count FROM wpw_voice_conversations
      WHERE was_serviced = true AND service_address IS NULL
    `);
    
    const priceButNotServiced = await pool.query(`
      SELECT COUNT(*) as count FROM wpw_voice_conversations
      WHERE quoted_price > 0 AND was_serviced = false
    `);
    
    const totalConv = await pool.query(`SELECT COUNT(*) as count FROM wpw_voice_conversations`);
    
    console.log(`Total conversations loaded: ${totalConv.rows[0].count}`);
    console.log(`Serviced but no price quoted: ${noPriceServiced.rows[0].count}`);
    console.log(`Serviced but no address captured: ${noAddressServiced.rows[0].count}`);
    console.log(`Price quoted but not serviced: ${priceButNotServiced.rows[0].count}\n`);
    
  } finally {
    await pool.end();
  }
}

verify();
