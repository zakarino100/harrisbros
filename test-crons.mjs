#!/usr/bin/env node
// test-crons.mjs — Validates credentials for both cron jobs.
// Does NOT send SMS or Discord messages. Read-only checks only.

import { createRequire } from 'module';
import https from 'https';
import { URL } from 'url';

const require = createRequire(import.meta.url);
const { Client } = require('/opt/homebrew/lib/node_modules/pg');

const TWILIO_SID   = 'AC0b9f60b9b4915f0e5dc728fcf1a913aa';
const TWILIO_TOKEN = '253218d7f0d336ed62c28a70be43b08c';
const DISCORD_TOKEN = 'MTQ4OTY3MzYwNjk2NjI4MDQ0Mw.Gj4Wj_.N3vRyL6ufA2ffP4rBUxoc5RQYZfHHN9ykS395w';

const results = [];

function pass(label, detail = '') {
  results.push({ label, status: 'PASS', detail });
  console.log(`  ✅ PASS: ${label}${detail ? ' — ' + detail : ''}`);
}

function fail(label, detail = '') {
  results.push({ label, status: 'FAIL', detail });
  console.log(`  ❌ FAIL: ${label}${detail ? ' — ' + detail : ''}`);
}

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('Timeout')); });
    req.end();
  });
}

// ─── Test 1: HH Supabase ───────────────────────────────────────────────────
async function testHHSupabase() {
  console.log('\n[1] HH Supabase (hh_campaign_replies)');
  const db = new Client({
    host: 'aws-1-us-east-1.pooler.supabase.com',
    port: 5432,
    user: 'postgres.hclpovktywijfnswthpm',
    password: 'Eaglesfan1998$',
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
  try {
    await db.connect();
    const r = await db.query('SELECT COUNT(*) AS cnt FROM hh_campaign_replies LIMIT 1');
    const cnt = r.rows[0]?.cnt ?? '?';
    pass('HH Supabase connect', `hh_campaign_replies has ${cnt} rows`);
  } catch (e) {
    fail('HH Supabase connect', e.message);
  } finally {
    await db.end().catch(() => {});
  }
}

// ─── Test 2: Swell Supabase ────────────────────────────────────────────────
async function testSwellSupabase() {
  console.log('\n[2] Swell Supabase (swell_leads)');
  const db = new Client({
    host: 'aws-1-us-east-1.pooler.supabase.com',
    port: 5432,
    user: 'postgres.yrwuxcgvnzrzufcimrxl',
    password: 'BlueOcean2026',
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
  try {
    await db.connect();
    const r = await db.query(`
      SELECT t.name, t.twilio_from, COUNT(l.id) AS lead_count
      FROM swell_tenants t
      LEFT JOIN swell_leads l ON l.tenant_id = t.id
      WHERE t.id = 'mackwash'
      GROUP BY t.name, t.twilio_from
    `);
    const row = r.rows[0];
    if (!row) {
      fail('Swell Supabase — MackWash tenant', 'Tenant not found');
    } else {
      pass('Swell Supabase connect', `MackWash found, twilio_from=${row.twilio_from}, total leads=${row.lead_count}`);
    }
  } catch (e) {
    fail('Swell Supabase connect', e.message);
  } finally {
    await db.end().catch(() => {});
  }
}

// ─── Test 3: Discord Bot Token ─────────────────────────────────────────────
async function testDiscordToken() {
  console.log('\n[3] Discord Bot Token');
  try {
    const res = await httpsGet('https://discord.com/api/v10/users/@me', {
      'Authorization': `Bot ${DISCORD_TOKEN}`,
    });
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      pass('Discord bot token', `Logged in as ${data.username}#${data.discriminator} (id: ${data.id})`);
    } else {
      fail('Discord bot token', `HTTP ${res.status}: ${res.body.substring(0, 200)}`);
    }
  } catch (e) {
    fail('Discord bot token', e.message);
  }
}

// ─── Test 4: Twilio Credentials ────────────────────────────────────────────
async function testTwilio() {
  console.log('\n[4] Twilio Credentials');
  try {
    const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64');
    const res = await httpsGet(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}.json`,
      { 'Authorization': `Basic ${auth}` }
    );
    if (res.status === 200) {
      const data = JSON.parse(res.body);
      pass('Twilio credentials', `Account: ${data.friendly_name} (${data.status})`);
    } else {
      fail('Twilio credentials', `HTTP ${res.status}: ${res.body.substring(0, 200)}`);
    }
  } catch (e) {
    fail('Twilio credentials', e.message);
  }
}

// ─── Run all tests ─────────────────────────────────────────────────────────
console.log('=== Cron Credential Test Suite ===');

await testHHSupabase();
await testSwellSupabase();
await testDiscordToken();
await testTwilio();

console.log('\n=== Summary ===');
for (const r of results) {
  const icon = r.status === 'PASS' ? '✅' : '❌';
  console.log(`  ${icon} ${r.status}: ${r.label}`);
}

const failCount = results.filter(r => r.status === 'FAIL').length;
console.log(`\n${results.length - failCount}/${results.length} passed.`);
if (failCount > 0) process.exit(1);
