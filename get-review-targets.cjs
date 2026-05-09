const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  host: 'db.hclpovktywijfnswthpm.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Eaglesfan1998$',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    // Get all serviced customers without reviews
    const result = await pool.query(`
      SELECT phone, service_type, first_contact
      FROM wpw_voice_conversations
      WHERE was_serviced = true AND review_left = false
      ORDER BY first_contact DESC
    `);

    console.log(`\n📱 REVIEW CAMPAIGN TARGETS\n`);
    console.log(`Total targets: ${result.rows.length}\n`);
    console.log(`Phone,Service Type,Service Date`);
    
    const csvLines = [];
    for (const row of result.rows) {
      const date = new Date(row.first_contact).toLocaleDateString();
      console.log(`${row.phone},${row.service_type || 'N/A'},${date}`);
      csvLines.push(`${row.phone},${row.service_type || 'N/A'},${date}`);
    }

    // Write to CSV
    const csv = `Phone,Service Type,Service Date\n${csvLines.join('\n')}`;
    fs.writeFileSync('/Users/zak/.openclaw/workspace/WPW_REVIEW_TARGETS.csv', csv);
    console.log(`\n✅ Exported to WPW_REVIEW_TARGETS.csv`);

  } finally {
    await pool.end();
  }
}

main();
