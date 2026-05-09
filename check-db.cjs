const { Client } = require('pg');

const client = new Client({
  host: 'db.hclpovktywijfnswthpm.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Eaglesfan1998$',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    await client.connect();
    
    // Check data in wpw_stripe_receipts
    const result = await client.query(`
      SELECT 
        customer_name,
        amount_dollars,
        charge_date,
        stripe_charge_id,
        raw_snippet
      FROM wpw_stripe_receipts
      ORDER BY charge_date DESC
      LIMIT 5
    `);

    console.log('Sample Stripe Receipts:');
    console.log('='.repeat(80));
    result.rows.forEach((row, i) => {
      console.log(`\n${i + 1}. Customer: ${row.customer_name}`);
      console.log(`   Amount: $${row.amount_dollars}`);
      console.log(`   Date: ${row.charge_date}`);
      console.log(`   Charge ID: ${row.stripe_charge_id}`);
      console.log(`   Snippet: ${row.raw_snippet.substring(0, 100)}...`);
    });

    // Check campaign_sends table structure
    console.log('\n\nCampaign Sends Sample:');
    console.log('='.repeat(80));
    
    const campaignResult = await client.query(`
      SELECT 
        id,
        to_name,
        to_address,
        service_amount,
        campaign_id
      FROM hh_campaign_sends
      WHERE campaign_id = 2
      LIMIT 5
    `);

    campaignResult.rows.forEach((row, i) => {
      console.log(`\n${i + 1}. Name: ${row.to_name}`);
      console.log(`   Email: ${row.to_address}`);
      console.log(`   Service Amount: ${row.service_amount}`);
      console.log(`   Campaign ID: ${row.campaign_id}`);
    });

    await client.end();
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
