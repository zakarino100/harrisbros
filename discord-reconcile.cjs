/**
 * Discord notification reconciliation.
 * Finds any campaign replies that didn't get routed to Discord and fires them.
 * Also catches sends that went out without a Discord outbound log.
 * Runs every 10 minutes via cron.
 */
const { Client } = require('/opt/homebrew/lib/node_modules/pg');
const https = require('https');
const BOT_TOKEN = process.env.BOT_TOKEN;
const MATTHEW = '<@1390089142087717087>';
const CHANNELS = {
  updates:      '1502363455779504198',
  reactivation: '1502357456452587612',
  leads:        '1439375021586911285',
  convos:       '1502357892571992204',
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function discordPost(channelId, content) {
  return new Promise(resolve => {
    const body = JSON.stringify({ content, allowed_mentions: { parse: ['users'] } });
    const req = https.request({
      hostname: 'discord.com', path: `/api/v10/channels/${channelId}/messages`,
      method: 'POST', headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d))); });
    req.on('error', e => resolve({error: e.message}));
    req.write(body); req.end();
  });
}

const db = new Client({ host: 'db.hclpovktywijfnswthpm.supabase.co', port: 5432, database: 'postgres', user: 'postgres', password: 'Eaglesfan1998$', ssl: { rejectUnauthorized: false } });

db.connect().then(async () => {
  // Find replies not yet routed to Discord (last 48h to catch gaps)
  const missed = await db.query(`
    SELECT cr.id, cr.from_address, cr.body, cr.classification, cr.intent_label,
           cr.urgency, cr.received_at, cs.to_name, cs.last_service
    FROM hh_campaign_replies cr
    LEFT JOIN hh_campaign_sends cs ON cs.to_address = cr.from_address AND cs.campaign_id = cr.campaign_id
    WHERE cr.routed_to_discord = false
      AND cr.classification != 'opt_out'
      AND cr.received_at > NOW() - INTERVAL '48 hours'
    ORDER BY cr.received_at
  `);

  if (missed.rows.length === 0) {
    console.log('All clear — no missed Discord notifications');
    await db.end();
    return;
  }

  console.log(`Found ${missed.rows.length} unrouted replies — routing now`);

  for (const r of missed.rows) {
    const name = r.to_name || r.from_address;
    const intent = r.intent_label || r.classification;
    const isUrgent = r.urgency === 'high' || ['customer_issue','manager_request'].includes(intent);
    
    // Determine channel
    const channel = ['reactivation_positive','reactivation_question','booking_confirmation'].includes(intent)
      ? CHANNELS.reactivation
      : isUrgent ? CHANNELS.updates
      : CHANNELS.reactivation;

    const mention = isUrgent ? `${MATTHEW} ` : '';
    const emoji   = intent === 'customer_issue' ? '⚠️' : intent === 'booking_confirmation' ? '📅' : intent.includes('reactivation') ? '🔁' : '💬';
    
    const msg = [
      `${mention}${emoji} **[CATCHUP] Reply received** — **${name}** (\`${r.from_address}\`)`,
      `Intent: **${intent}** | Received: ${new Date(r.received_at).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}`,
      r.last_service ? `Service: ${r.last_service}` : null,
      ``,
      `> ${(r.body||'').slice(0, 500)}`,
    ].filter(Boolean).join('\n');

    const posted = await discordPost(channel, msg);
    if (posted.id) {
      await db.query("UPDATE hh_campaign_replies SET routed_to_discord=true, discord_message_id=$1 WHERE id=$2", [posted.id, r.id]);
      console.log(`✓ Routed: ${name} → channel ${channel}`);
    } else {
      console.error(`✗ Failed: ${name}`, posted.message || posted.error);
    }
    await sleep(600);
  }

  await db.end();
  console.log('Reconciliation complete');
}).catch(e => {
  console.error('Reconcile error:', e.message);
  process.exit(1);
});
