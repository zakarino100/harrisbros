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
    
    // Get all columns in hh_campaign_sends
    const result = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'hh_campaign_sends'
      ORDER BY ordinal_position
    `);

    console.log('hh_campaign_sends columns:');
    console.log('='.repeat(50));
    result.rows.forEach(row => {
      console.log(`${row.column_name.padEnd(25)} ${row.data_type}`);
    });

    // Look for any stripe or receipt related fields
    console.log('\n\nSearching for Stripe/receipt data...');
    const allResult = await client.query(`
      SELECT * FROM hh_campaign_sends
      WHERE campaign_id = 2
      LIMIT 1
    `);

    if (allResult.rows.length > 0) {
      console.log('\nFull record sample:');
      console.log(JSON.stringify(allResult.rows[0], null, 2));
    }

    await client.end();
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
