#!/usr/bin/env node

import pg from 'pg';
const { Client } = pg;

const DISCORD_BOT_TOKEN = 'MTQ4OTY3MzYwNjk2NjI4MDQ0Mw.G58v_p.7lBun9kPJ2n994CdTaO2-_bQmeT6yFqg9HeZNI';
const DISCORD_API_BASE = 'https://discord.com/api/v10';

const CHANNEL_CONFIG = {
  'customer_issue': { channel_id: '1502363455779504198', mention_id: '1390089142087717087' },
  'manager_request': { channel_id: '1502363455779504198', mention_id: '1390089142087717087' },
  'reactivation': { channel_id: '1502357456452587612', mention_id: null },
  'lead': { channel_id: '1439375021586911285', mention_id: null }
};

const DB_CONFIG = {
  host: 'db.hclpovktywijfnswthpm.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Eaglesfan1998$'
};

async function queryDatabase() {
  const client = new Client(DB_CONFIG);
  
  try {
    await client.connect();
    
    const query = `
      SELECT id, from_address, body, classification, received_at 
      FROM hh_campaign_replies 
      WHERE routed_to_discord = false 
      AND classification != 'opt_out' 
      AND received_at > NOW() - INTERVAL '48 hours'
      ORDER BY received_at DESC
    `;
    
    const result = await client.query(query);
    return result.rows;
  } catch (error) {
    console.error('Database query error:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

async function postToDiscord(channelId, message, mentionId = null) {
  const content = mentionId ? `<@${mentionId}> ${message}` : message;
  
  try {
    const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content })
    });
    
    if (!response.ok) {
      throw new Error(`Discord API error: ${response.status} ${await response.text()}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Discord post error:', error.message);
    throw error;
  }
}

async function updateDatabase(replyId) {
  const client = new Client(DB_CONFIG);
  
  try {
    await client.connect();
    
    const query = `
      UPDATE hh_campaign_replies 
      SET routed_to_discord = true, updated_at = NOW()
      WHERE id = $1
    `;
    
    await client.query(query, [replyId]);
  } catch (error) {
    console.error('Database update error:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

async function classifyReply(classification) {
  if (classification === 'reactivation') return 'reactivation';
  if (classification === 'customer_issue' || classification === 'manager_request') {
    return classification;
  }
  return 'lead';
}

async function main() {
  let routedCount = 0;
  let errorCount = 0;
  const errors = [];
  
  try {
    console.log('Querying Supabase for unrouted replies...');
    const replies = await queryDatabase();
    console.log(`Found ${replies.length} unrouted replies`);
    
    for (const reply of replies) {
      try {
        const replyClass = await classifyReply(reply.classification);
        const config = CHANNEL_CONFIG[replyClass];
        
        if (!config) {
          throw new Error(`Unknown classification: ${replyClass}`);
        }
        
        const message = `**${reply.from_address}** (${reply.classification}): ${reply.body}`;
        
        console.log(`Posting to Discord: ${config.channel_id}`);
        await postToDiscord(config.channel_id, message, config.mention_id);
        
        console.log(`Updating database for reply ${reply.id}`);
        await updateDatabase(reply.id);
        
        routedCount++;
      } catch (error) {
        errorCount++;
        errors.push({ reply_id: reply.id, error: error.message });
        console.error(`Failed to process reply ${reply.id}:`, error.message);
      }
    }
    
    console.log('\n=== RECONCILIATION COMPLETE ===');
    console.log(`Routed: ${routedCount}`);
    console.log(`Errors: ${errorCount}`);
    
    if (errors.length > 0) {
      console.log('\nError details:');
      errors.forEach(e => console.log(`  - Reply ${e.reply_id}: ${e.error}`));
    }
    
    if (errorCount > 0) {
      console.log('\nALERT: Some replies failed to route. Check errors above.');
    }
    
  } catch (error) {
    console.error('Fatal error:', error.message);
    console.log('\nRECONCILIATION FAILED');
    process.exit(1);
  }
}

main();
