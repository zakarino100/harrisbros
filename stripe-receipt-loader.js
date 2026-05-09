#!/usr/bin/env node

const https = require('https');
const http = require('http');
const { Client } = require('pg');

// Configuration
const GMAIL_CLIENT_ID = '1047926513258-kjiga648ngbo4bo40b6uuvomv4k47s45.apps.googleusercontent.com';
const GMAIL_CLIENT_SECRET = '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';
const GMAIL_REFRESH_TOKEN = '1//01z7uSvI04bSKCgYIARAAGAESNwF-L9IrCsBTA42ukJHQqzdaPvp6t1ExYMxxU0TalXFf26wMnFkrHwZ4CcpWw8a_SwxXvaDU5uo';

const SUPABASE_HOST = 'db.hclpovktywijfnswthpm.supabase.co';
const SUPABASE_PORT = 5432;
const SUPABASE_DB = 'postgres';
const SUPABASE_USER = 'postgres';
const SUPABASE_PASSWORD = 'Eaglesfan1998$';

// Helper: Make HTTPS POST request
function httpsPost(hostname, path, data) {
  return new Promise((resolve, reject) => {
    // Convert data to URL-encoded format
    const postData = Object.keys(data)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
      .join('&');
    
    const options = {
      hostname,
      port: 443,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body });
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Helper: Make HTTPS GET request
function httpsGet(hostname, path, accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      port: 443,
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body });
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// Helper: Decode base64url
function decodeBase64Url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(str, 'base64').toString('utf8');
}

// Task 1: Get fresh access token
async function getAccessToken() {
  console.log('📧 Task 1: Getting fresh Gmail access token...');
  try {
    const response = await httpsPost('oauth2.googleapis.com', '/token', {
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    });

    if (response.status !== 200) {
      throw new Error(`Failed to get token: ${response.status} ${JSON.stringify(response.body)}`);
    }

    console.log('✓ Access token obtained');
    return response.body.access_token;
  } catch (error) {
    console.error('❌ Error getting access token:', error.message);
    throw error;
  }
}

// Task 2: Pull all Stripe receipt emails
async function getStripeReceipts(accessToken) {
  console.log('\n📧 Task 2: Pulling Stripe receipt emails...');
  try {
    const searchQuery = encodeURIComponent('from:receipts@stripe.com OR from:no-reply@stripe.com subject:receipt');
    const response = await httpsGet(
      'gmail.googleapis.com',
      `/gmail/v1/users/me/messages?q=${searchQuery}&maxResults=500`,
      accessToken
    );

    if (response.status !== 200) {
      throw new Error(`Failed to search messages: ${response.status}`);
    }

    const messages = response.body.messages || [];
    console.log(`✓ Found ${messages.length} Stripe receipt emails`);
    return messages;
  } catch (error) {
    console.error('❌ Error searching emails:', error.message);
    throw error;
  }
}

// Task 2b: Fetch and parse individual messages
async function fetchAndParseMessages(messageIds, accessToken) {
  console.log(`\n📧 Fetching and parsing ${messageIds.length} messages...`);
  const receipts = [];
  
  for (let i = 0; i < messageIds.length; i++) {
    const msgId = messageIds[i].id;
    
    try {
      const response = await httpsGet(
        'gmail.googleapis.com',
        `/gmail/v1/users/me/messages/${msgId}?format=full`,
        accessToken
      );

      if (response.status === 200) {
        const receipt = parseEmailMessage(msgId, response.body);
        if (receipt) {
          receipts.push(receipt);
          console.log(`  ✓ [${i + 1}/${messageIds.length}] ${receipt.customer_name} - $${receipt.amount_dollars}`);
        }
      }
    } catch (error) {
      console.error(`  ⚠ Error fetching message ${msgId}:`, error.message);
    }

    // Rate limiting: 100ms between requests
    if (i < messageIds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`✓ Parsed ${receipts.length} receipts`);
  return receipts;
}

// Parse email message to extract receipt data
function parseEmailMessage(msgId, message) {
  try {
    const headers = message.payload.headers || [];
    const headerMap = {};
    headers.forEach(h => {
      headerMap[h.name.toLowerCase()] = h.value;
    });

    // Get email body
    let body = '';
    if (message.payload.parts) {
      const textPart = message.payload.parts.find(p => p.mimeType === 'text/plain');
      if (textPart && textPart.body && textPart.body.data) {
        body = decodeBase64Url(textPart.body.data);
      }
    } else if (message.payload.body && message.payload.body.data) {
      body = decodeBase64Url(message.payload.body.data);
    }

    // Extract snippet
    const snippet = message.snippet || '';
    const fullText = body + '\n' + snippet;

    // Parse receipt data
    const receipt = {
      gmail_message_id: msgId,
      customer_name: extractCustomerName(fullText, headerMap),
      amount_cents: extractAmount(fullText),
      description: extractDescription(fullText),
      stripe_charge_id: extractChargeId(fullText),
      card_last4: extractCardLast4(fullText),
      charge_date: extractChargeDate(fullText),
      raw_snippet: snippet
    };

    // Calculate amount_dollars
    receipt.amount_dollars = receipt.amount_cents ? (receipt.amount_cents / 100).toFixed(2) : null;

    // Only return if we have essential data
    if (receipt.customer_name && receipt.amount_dollars) {
      return receipt;
    }

    return null;
  } catch (error) {
    console.error(`  ⚠ Error parsing message ${msgId}:`, error.message);
    return null;
  }
}

function extractCustomerName(text, headerMap) {
  // Try to extract from "To" header
  const toHeader = headerMap.to || '';
  const match = toHeader.match(/(.+?)\s*</);
  if (match) return match[1].trim();

  // Try patterns in body
  const patterns = [
    /Dear\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
    /Hi\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
    /Hello\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return 'Unknown Customer';
}

function extractAmount(text) {
  // Look for dollar amounts
  const patterns = [
    /\$(\d+\.\d{2})/,
    /amount[:\s]*\$?(\d+\.\d{2})/i,
    /charged.*?\$(\d+\.\d{2})/i,
    /total[:\s]*\$?(\d+\.\d{2})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return Math.round(parseFloat(match[1]) * 100);
    }
  }

  return null;
}

function extractDescription(text) {
  // Look for service/product description
  const patterns = [
    /service[:\s]+([^\n]+)/i,
    /description[:\s]+([^\n]+)/i,
    /item[:\s]+([^\n]+)/i,
    /product[:\s]+([^\n]+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim().substring(0, 255);
    }
  }

  return null;
}

function extractChargeId(text) {
  // Look for Stripe charge ID pattern (usually "ch_" prefix)
  const match = text.match(/ch_[a-zA-Z0-9]{24,}/);
  return match ? match[0] : null;
}

function extractCardLast4(text) {
  // Look for card last 4 digits
  const match = text.match(/(?:card|ending in|••••\s*)(\d{4})/i);
  return match ? match[1] : null;
}

function extractChargeDate(text) {
  // Look for date pattern
  const patterns = [
    /(\d{4})-(\d{2})-(\d{2})/,
    /([A-Z][a-z]{2})\s+(\d{1,2}),?\s+(\d{4})/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      if (match[0].includes('-')) {
        return match[0]; // Already in YYYY-MM-DD format
      } else {
        // Parse month name
        const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
        const monthNum = months[match[1].toLowerCase().substring(0, 3)];
        const day = String(match[2]).padStart(2, '0');
        const year = match[3];
        return `${year}-${String(monthNum).padStart(2, '0')}-${day}`;
      }
    }
  }

  return null;
}

// Task 3: Create table and load data
async function loadDataToSupabase(receipts) {
  console.log('\n💾 Task 3: Loading data to Supabase...');
  
  const client = new Client({
    host: SUPABASE_HOST,
    port: SUPABASE_PORT,
    database: SUPABASE_DB,
    user: SUPABASE_USER,
    password: SUPABASE_PASSWORD,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('✓ Connected to Supabase');

    // Create table
    await client.query(`
      CREATE TABLE IF NOT EXISTS wpw_stripe_receipts (
        id              BIGSERIAL PRIMARY KEY,
        gmail_message_id TEXT UNIQUE NOT NULL,
        charge_date     DATE,
        customer_name   TEXT,
        amount_cents    INTEGER,
        amount_dollars  NUMERIC(10,2),
        description     TEXT,
        stripe_charge_id TEXT,
        card_last4      TEXT,
        raw_snippet     TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('✓ Table created/verified');

    // Insert receipts
    let inserted = 0;
    let skipped = 0;

    for (const receipt of receipts) {
      try {
        await client.query(
          `INSERT INTO wpw_stripe_receipts 
           (gmail_message_id, charge_date, customer_name, amount_cents, amount_dollars, description, stripe_charge_id, card_last4, raw_snippet)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (gmail_message_id) DO NOTHING`,
          [
            receipt.gmail_message_id,
            receipt.charge_date,
            receipt.customer_name,
            receipt.amount_cents,
            receipt.amount_dollars,
            receipt.description,
            receipt.stripe_charge_id,
            receipt.card_last4,
            receipt.raw_snippet
          ]
        );
        inserted++;
      } catch (error) {
        if (error.code === '23505') {
          skipped++;
        } else {
          console.error(`  ⚠ Error inserting receipt:`, error.message);
        }
      }
    }

    console.log(`✓ Inserted ${inserted} receipts, skipped ${skipped} duplicates`);

    return { inserted, skipped, total: receipts.length };
  } catch (error) {
    console.error('❌ Supabase error:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

// Task 4: Match to campaign sends
async function matchToCampaignSends() {
  console.log('\n🔗 Task 4: Matching receipts to campaign sends...');

  const client = new Client({
    host: SUPABASE_HOST,
    port: SUPABASE_PORT,
    database: SUPABASE_DB,
    user: SUPABASE_USER,
    password: SUPABASE_PASSWORD,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const result = await client.query(`
      SELECT r.customer_name, r.amount_dollars, r.charge_date,
             cs.to_name, cs.to_address
      FROM wpw_stripe_receipts r
      JOIN hh_campaign_sends cs ON LOWER(cs.to_name) = LOWER(r.customer_name)
      ORDER BY r.charge_date DESC
      LIMIT 20
    `);

    console.log(`✓ Found ${result.rows.length} matches:`);
    result.rows.forEach((row, i) => {
      console.log(`  ${i + 1}. ${row.customer_name} ($${row.amount_dollars}) - ${row.to_address}`);
    });

    return result.rows.length;
  } catch (error) {
    console.error('⚠ Matching error:', error.message);
    return 0;
  } finally {
    await client.end();
  }
}

// Task 5: Update service_amount
async function updateServiceAmount() {
  console.log('\n✏️ Task 5: Updating service_amount for matched sends...');

  const client = new Client({
    host: SUPABASE_HOST,
    port: SUPABASE_PORT,
    database: SUPABASE_DB,
    user: SUPABASE_USER,
    password: SUPABASE_PASSWORD,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const result = await client.query(`
      UPDATE hh_campaign_sends cs
      SET service_amount = r.amount_dollars::text
      FROM wpw_stripe_receipts r
      WHERE LOWER(cs.to_name) = LOWER(r.customer_name)
        AND cs.service_amount IS NULL
        AND cs.campaign_id = 2
      RETURNING cs.id
    `);

    console.log(`✓ Updated ${result.rows.length} campaign sends`);
    return result.rows.length;
  } catch (error) {
    console.error('⚠ Update error:', error.message);
    return 0;
  } finally {
    await client.end();
  }
}

// Main execution
async function main() {
  try {
    console.log('🚀 Starting Stripe Receipt Loader\n');

    // Task 1
    const accessToken = await getAccessToken();

    // Task 2
    const messageIds = await getStripeReceipts(accessToken);

    // Task 2b
    const receipts = await fetchAndParseMessages(messageIds, accessToken);

    if (receipts.length === 0) {
      console.log('\n❌ No receipts found. Exiting.');
      process.exit(1);
    }

    // Task 3
    const loadResult = await loadDataToSupabase(receipts);

    // Task 4
    const matchCount = await matchToCampaignSends();

    // Task 5
    const updateCount = await updateServiceAmount();

    // Calculate stats
    const totalAmount = receipts.reduce((sum, r) => sum + (parseFloat(r.amount_dollars) || 0), 0);
    const dates = receipts
      .map(r => r.charge_date)
      .filter(d => d)
      .sort();
    const dateRange = dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'Unknown';

    // Report
    console.log('\n📊 FINAL REPORT');
    console.log('═'.repeat(50));
    console.log(`Total receipts pulled:        ${receipts.length}`);
    console.log(`Date range:                   ${dateRange}`);
    console.log(`Total amount across receipts: $${totalAmount.toFixed(2)}`);
    console.log(`Matched to campaign sends:    ${matchCount}`);
    console.log(`Campaign sends updated:       ${updateCount}`);
    console.log('═'.repeat(50));

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();
