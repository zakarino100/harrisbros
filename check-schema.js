#!/usr/bin/env node

import pg from 'pg';
const { Client } = pg;

const DB_CONFIG = {
  host: 'db.hclpovktywijfnswthpm.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Eaglesfan1998$'
};

async function main() {
  const client = new Client(DB_CONFIG);
  
  try {
    await client.connect();
    
    // Check if table exists
    const tableQuery = `
      SELECT table_name FROM information_schema.tables 
      WHERE table_name LIKE '%campaign%' OR table_name LIKE '%reply%'
    `;
    
    const tableResult = await client.query(tableQuery);
    console.log('Tables found:');
    console.log(tableResult.rows);
    
    // Get columns for first matching table
    if (tableResult.rows.length > 0) {
      const tableName = tableResult.rows[0].table_name;
      console.log(`\nColumns in ${tableName}:`);
      
      const columnsQuery = `
        SELECT column_name, data_type FROM information_schema.columns 
        WHERE table_name = $1
      `;
      
      const columnsResult = await client.query(columnsQuery, [tableName]);
      columnsResult.rows.forEach(col => {
        console.log(`  - ${col.column_name}: ${col.data_type}`);
      });
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.end();
  }
}

main();
