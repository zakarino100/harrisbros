#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATA_DIR = '/Users/zak/.openclaw/workspace/voice-data/Takeout/Voice/Calls/';

const pool = new Pool({
  host: 'db.hclpovktywijfnswthpm.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Eaglesfan1998$',
  ssl: { rejectUnauthorized: false }
});

// Parse HTML to extract text content
function parseHTML(html) {
  // Extract messages between divs
  const messageRegex = /<div class="message">[\s\S]*?<\/div>/g;
  const messages = [];
  
  let match;
  while ((match = messageRegex.exec(html)) !== null) {
    const messageHtml = match[0];
    
    // Extract timestamp
    const timeMatch = messageHtml.match(/<abbr class="dt" title="([^"]+)">/);
    if (!timeMatch) continue;
    
    const timestamp = timeMatch[1];
    
    // Extract sender
    let sender = 'unknown';
    const senderMatch = messageHtml.match(/<cite class="sender vcard">[\s\S]*?<abbr class="fn" title="">([^<]*)<\/abbr>/);
    if (senderMatch) {
      sender = senderMatch[1].trim();
    } else {
      const phoneMatch = messageHtml.match(/<a class="tel" href="tel:(\+?\d+)">/);
      if (phoneMatch) {
        const phoneOrName = messageHtml.match(/<span class="fn">([^<]*)<\/span>/);
        sender = phoneOrName ? phoneOrName[1].trim() || phoneMatch[1] : phoneMatch[1];
      }
    }
    
    // Extract body
    const bodyMatch = messageHtml.match(/<q>([\s\S]*?)<\/q>/);
    const body = bodyMatch ? bodyMatch[1].replace(/<br>/g, '\n').replace(/<[^>]+>/g, '').trim() : '';
    
    messages.push({
      timestamp,
      sender: sender.trim() || 'unknown',
      body
    });
  }
  
  return messages;
}

// Extract entities from text
function extractEntities(text) {
  const entities = {
    prices: [],
    addresses: [],
    serviceTypes: [],
    dates: [],
    hasReviewRequest: false,
    hasReviewConfirmed: false,
    hasScheduled: false
  };
  
  // Extract prices
  const priceRegex = /\$[\d,]+(?:\.\d{2})?|\b\d+\s*(?:dollars?|bucks)\b/gi;
  let priceMatch;
  while ((priceMatch = priceRegex.exec(text)) !== null) {
    entities.prices.push(priceMatch[0]);
  }
  
  // Extract addresses
  const addrRegex = /\d+\s+\w+(?:\s+\w+)*\s+(?:St|Ave|Dr|Rd|Ln|Way|Blvd|Ct|Pl)(?:eet)?(?:\s*\w+)*/gi;
  let addrMatch;
  while ((addrMatch = addrRegex.exec(text)) !== null) {
    const addr = addrMatch[0].trim();
    if (addr.length > 5) entities.addresses.push(addr);
  }
  
  // Service types
  const serviceKeywords = ['house wash', 'soft wash', 'roof wash', 'driveway', 'concrete', 'gutter', 'window', 'deck', 'fence', 'pressure wash', 'exterior', 'siding'];
  const lowerText = text.toLowerCase();
  for (const keyword of serviceKeywords) {
    if (lowerText.includes(keyword)) {
      if (!entities.serviceTypes.includes(keyword)) {
        entities.serviceTypes.push(keyword);
      }
    }
  }
  
  // Check for schedule/confirm keywords
  const scheduleKeywords = ['confirmed', 'done', 'completed', 'finished', 'scheduled', 'tomorrow', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  for (const keyword of scheduleKeywords) {
    if (lowerText.includes(keyword)) {
      entities.hasScheduled = true;
      break;
    }
  }
  
  // Review requests
  const reviewReqKeywords = ['google review', 'leave a review', 'review link', 'star review', '5 star'];
  for (const keyword of reviewReqKeywords) {
    if (lowerText.includes(keyword)) {
      entities.hasReviewRequest = true;
      break;
    }
  }
  
  // Review confirmed
  const reviewConfKeywords = ['left a review', 'posted review', '5 stars', 'reviewed'];
  for (const keyword of reviewConfKeywords) {
    if (lowerText.includes(keyword)) {
      entities.hasReviewConfirmed = true;
      break;
    }
  }
  
  return entities;
}

// Parse voicemail HTML
function parseVoicemail(html, phone) {
  // Extract phone from filename
  const timeMatch = html.match(/<abbr class="published" title="([^"]+)">/);
  const timestamp = timeMatch ? timeMatch[1] : new Date().toISOString();
  
  // Extract transcript from full-text span
  const fullTextMatch = html.match(/<span class="full-text">([^<]+)<\/span>/);
  const transcript = fullTextMatch ? fullTextMatch[1].trim() : '';
  
  if (!transcript) return null;
  
  return {
    timestamp,
    sender: phone,
    body: transcript,
    direction: 'voicemail'
  };
}

// Main processing function
async function main() {
  console.log('Starting Wolf Pack Wash voice data import...\n');
  
  try {
    // Create tables
    console.log('Creating tables in Supabase...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wpw_voice_conversations (
        id              BIGSERIAL PRIMARY KEY,
        phone           TEXT NOT NULL UNIQUE,
        customer_name   TEXT,
        first_contact   TIMESTAMPTZ,
        last_contact    TIMESTAMPTZ,
        message_count   INTEGER DEFAULT 0,
        service_address TEXT,
        service_type    TEXT,
        quoted_price    NUMERIC(10,2),
        was_serviced    BOOLEAN DEFAULT false,
        service_date    TEXT,
        review_requested BOOLEAN DEFAULT false,
        review_left     BOOLEAN DEFAULT false,
        converted       BOOLEAN DEFAULT false,
        matched_campaign_send_id BIGINT,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wpw_voice_messages (
        id              BIGSERIAL PRIMARY KEY,
        conversation_id BIGINT REFERENCES wpw_voice_conversations(id),
        phone           TEXT NOT NULL,
        direction       TEXT NOT NULL,
        body            TEXT,
        sent_at         TIMESTAMPTZ,
        contains_price  BOOLEAN DEFAULT false,
        contains_address BOOLEAN DEFAULT false,
        contains_date   BOOLEAN DEFAULT false,
        raw_file        TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_voice_conv_phone ON wpw_voice_conversations(phone)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_voice_msg_conv ON wpw_voice_messages(conversation_id)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_voice_msg_sent ON wpw_voice_messages(sent_at)
    `);
    
    console.log('✓ Tables created\n');
    
    // Read all files
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.html'));
    console.log(`Found ${files.length} HTML files\n`);
    
    // Group by phone number
    const conversations = {};
    let parsedCount = 0;
    let errorCount = 0;
    
    for (const file of files) {
      try {
        const filePath = path.join(DATA_DIR, file);
        const html = fs.readFileSync(filePath, 'utf8');
        
        // Extract phone from filename
        const phoneMatch = file.match(/^\+(\d+)/);
        if (!phoneMatch) {
          errorCount++;
          continue;
        }
        
        const phone = '+' + phoneMatch[1];
        
        // Check if voicemail
        if (file.includes('Voicemail')) {
          const voicemail = parseVoicemail(html, phone);
          if (voicemail) {
            if (!conversations[phone]) {
              conversations[phone] = {
                phone,
                messages: [],
                files: []
              };
            }
            conversations[phone].messages.push(voicemail);
            conversations[phone].files.push(file);
            parsedCount++;
          }
        } else if (file.includes('Text')) {
          // Text conversation
          const messages = parseHTML(html);
          
          if (messages.length > 0) {
            if (!conversations[phone]) {
              conversations[phone] = {
                phone,
                messages: [],
                files: []
              };
            }
            conversations[phone].messages.push(...messages);
            conversations[phone].files.push(file);
            parsedCount++;
          }
        }
      } catch (err) {
        console.error(`Error parsing ${file}:`, err.message);
        errorCount++;
      }
    }
    
    console.log(`✓ Parsed ${parsedCount} files (${errorCount} errors)\n`);
    
    // Process conversations
    console.log(`Processing ${Object.keys(conversations).length} conversations...\n`);
    
    const conversationData = [];
    let messageCount = 0;
    
    for (const [phone, convData] of Object.entries(conversations)) {
      // Sort messages by timestamp
      convData.messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      // Calculate conversation metrics
      let firstContact = null;
      let lastContact = null;
      let quotedPrice = null;
      let wasServiced = false;
      let reviewRequested = false;
      let reviewLeft = false;
      let serviceAddress = null;
      let serviceType = null;
      let serviceDateStr = null;
      
      // Analyze outbound messages for entities
      let foundSchedule = false;
      for (const msg of convData.messages) {
        const isOutbound = msg.sender === 'Me' || msg.sender.includes('Matthew') || msg.sender.includes('Zack');
        const direction = isOutbound ? 'outbound' : 'inbound';
        
        const entities = extractEntities(msg.body);
        
        // Get first contact
        if (!firstContact) {
          firstContact = msg.timestamp;
        }
        lastContact = msg.timestamp;
        
        // Extract quoted price from outbound messages
        if (isOutbound && !quotedPrice && entities.prices.length > 0) {
          const priceStr = entities.prices[0].replace(/[$,]/g, '');
          quotedPrice = parseFloat(priceStr) || null;
        }
        
        // Detect if serviced
        if (isOutbound && entities.hasScheduled) {
          foundSchedule = true;
        }
        if (foundSchedule && !isOutbound && convData.messages.length > 2) {
          wasServiced = true;
        }
        
        // Review tracking
        if (isOutbound && entities.hasReviewRequest) {
          reviewRequested = true;
        }
        if (!isOutbound && entities.hasReviewConfirmed) {
          reviewLeft = true;
        }
        
        // Service address and type
        if (entities.addresses.length > 0 && !serviceAddress) {
          serviceAddress = entities.addresses[0];
        }
        if (entities.serviceTypes.length > 0 && !serviceType) {
          serviceType = entities.serviceTypes.join(', ');
        }
      }
      
      const converted = quotedPrice && wasServiced;
      
      conversationData.push({
        phone,
        firstContact,
        lastContact,
        messageCount: convData.messages.length,
        quotedPrice,
        wasServiced,
        reviewRequested,
        reviewLeft,
        serviceAddress,
        serviceType,
        converted,
        messages: convData.messages
      });
      
      messageCount += convData.messages.length;
    }
    
    console.log(`Processing ${messageCount} total messages...\n`);
    
    // Insert conversations and messages into Supabase
    console.log('Inserting into Supabase...');
    
    for (const conv of conversationData) {
      try {
        // Insert conversation
        const convResult = await pool.query(
          `INSERT INTO wpw_voice_conversations 
           (phone, first_contact, last_contact, message_count, quoted_price, was_serviced, review_requested, review_left, service_address, service_type, converted)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (phone) DO UPDATE SET 
             last_contact = EXCLUDED.last_contact,
             message_count = EXCLUDED.message_count,
             quoted_price = COALESCE(wpw_voice_conversations.quoted_price, EXCLUDED.quoted_price),
             was_serviced = wpw_voice_conversations.was_serviced OR EXCLUDED.was_serviced,
             review_requested = wpw_voice_conversations.review_requested OR EXCLUDED.review_requested,
             review_left = wpw_voice_conversations.review_left OR EXCLUDED.review_left,
             service_address = COALESCE(wpw_voice_conversations.service_address, EXCLUDED.service_address),
             service_type = COALESCE(wpw_voice_conversations.service_type, EXCLUDED.service_type),
             converted = wpw_voice_conversations.converted OR EXCLUDED.converted
           RETURNING id`,
          [conv.phone, conv.firstContact, conv.lastContact, conv.messageCount, conv.quotedPrice,
           conv.wasServiced, conv.reviewRequested, conv.reviewLeft, conv.serviceAddress, conv.serviceType, conv.converted]
        );
        
        const convId = convResult.rows[0].id;
        
        // Insert messages
        for (const msg of conv.messages) {
          const isOutbound = msg.sender === 'Me' || msg.sender.includes('Matthew') || msg.sender.includes('Zack');
          const direction = msg.direction || (isOutbound ? 'outbound' : 'inbound');
          
          const entities = extractEntities(msg.body);
          const hasPrice = entities.prices.length > 0;
          const hasAddr = entities.addresses.length > 0;
          
          await pool.query(
            `INSERT INTO wpw_voice_messages
             (conversation_id, phone, direction, body, sent_at, contains_price, contains_address, raw_file)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [convId, conv.phone, direction, msg.body, msg.timestamp, hasPrice, hasAddr, '']
          );
        }
      } catch (err) {
        console.error(`Error inserting conversation for ${conv.phone}:`, err.message);
      }
    }
    
    console.log('✓ Data inserted\n');
    
    // Match to campaign sends
    console.log('Matching to campaign sends...');
    try {
      const result = await pool.query(`
        UPDATE wpw_voice_conversations vc
        SET matched_campaign_send_id = cs.id
        FROM hh_campaign_sends cs
        WHERE cs.to_address = vc.phone
          AND cs.campaign_id = 2
      `);
      console.log(`✓ Matched ${result.rowCount} records\n`);
    } catch (err) {
      console.log('⚠ Note: hh_campaign_sends table not found (expected if on different schema)\n');
    }
    
    // Generate conversion report
    console.log('Generating conversion report...\n');
    
    const conversionData = await pool.query(`
      SELECT vc.id, vc.phone, vc.service_address, vc.quoted_price, vc.service_type,
             vc.first_contact, vc.was_serviced, vc.converted, vc.review_requested, vc.review_left,
             vc.matched_campaign_send_id
      FROM wpw_voice_conversations vc
      WHERE vc.converted = true OR vc.was_serviced = true
      ORDER BY vc.first_contact DESC
    `);
    
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_conversations,
        SUM(message_count) as total_messages,
        COUNT(CASE WHEN converted = true THEN 1 END) as converted_count,
        COUNT(CASE WHEN service_address IS NOT NULL THEN 1 END) as with_address,
        COUNT(CASE WHEN review_requested = true THEN 1 END) as review_requested,
        COUNT(CASE WHEN review_left = true THEN 1 END) as review_left,
        COUNT(CASE WHEN was_serviced = true THEN 1 END) as serviced_count
      FROM wpw_voice_conversations
    `);
    
    const statsRow = stats.rows[0];
    
    console.log('═══════════════════════════════════════════════════════');
    console.log('           WOLF PACK WASH VOICE DATA IMPORT REPORT       ');
    console.log('═══════════════════════════════════════════════════════\n');
    
    console.log('📊 SUMMARY');
    console.log('─────────────────────────────────────────────────────');
    console.log(`Total Conversations:        ${statsRow.total_conversations}`);
    console.log(`Total Messages:             ${statsRow.total_messages}`);
    console.log(`Converted Customers:        ${statsRow.converted_count}`);
    console.log(`  (price quoted + serviced)`);
    console.log(`Serviced Customers:         ${statsRow.serviced_count}`);
    console.log(`With Service Addresses:     ${statsRow.with_address}`);
    console.log(`Review Requested:           ${statsRow.review_requested}`);
    console.log(`Reviews Received:           ${statsRow.review_left}`);
    console.log(`Review Conversion Rate:     ${statsRow.review_requested > 0 ? (statsRow.review_left / statsRow.review_requested * 100).toFixed(1) : 0}%\n`);
    
    console.log('🔥 CONVERTED CUSTOMERS (FOR META CAPI)');
    console.log('─────────────────────────────────────────────────────');
    console.log(`Count: ${conversionData.rows.length}\n`);
    
    for (const row of conversionData.rows.slice(0, 20)) {
      const addr = row.service_address || 'N/A';
      const price = row.quoted_price ? `$${row.quoted_price}` : 'N/A';
      const date = row.first_contact ? new Date(row.first_contact).toLocaleDateString() : 'N/A';
      console.log(`📱 ${row.phone}`);
      console.log(`   Price: ${price} | Service: ${row.service_type || 'N/A'}`);
      console.log(`   Address: ${addr}`);
      console.log(`   Date: ${date}`);
      console.log(`   Serviced: ${row.was_serviced ? '✓' : '✗'} | Review: ${row.review_left ? '✓' : '✗'}\n`);
    }
    
    if (conversionData.rows.length > 20) {
      console.log(`... and ${conversionData.rows.length - 20} more converted customers\n`);
    }
    
    console.log('═══════════════════════════════════════════════════════');
    console.log('✅ Import complete!\n');
    
  } catch (err) {
    console.error('Fatal error:', err);
  } finally {
    await pool.end();
  }
}

main();
