const pg = require('pg');

const dbConfig = {
  host: 'db.hclpovktywijfnswthpm.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Eaglesfan1998$',
  ssl: { rejectUnauthorized: false }
};

async function main() {
  const client = new pg.Client(dbConfig);
  
  try {
    await client.connect();
    
    // Get table schema
    const schema = await client.query(
      `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_name = 'hh_campaign_replies'
       ORDER BY ordinal_position`
    );

    console.log('Columns in hh_campaign_replies:');
    schema.rows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type}`);
    });

    // Also show a sample row
    const sample = await client.query(
      `SELECT * FROM hh_campaign_replies LIMIT 1`
    );
    
    if (sample.rows.length > 0) {
      console.log('\nSample row keys:', Object.keys(sample.rows[0]));
    }

    await client.end();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
