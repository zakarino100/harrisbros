/**
 * Hides all AI nurture-refusal messages from the CRM UI.
 * These are the "I appreciate the instruction..." messages that were
 * incorrectly sent to customers when the nurture loop fired on a receptionist tenant.
 *
 * Strategy: set error='_hidden' on those messages so the API route filters them out.
 * (Non-destructive — data stays in DB for audit but won't appear in UI.)
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(resolve(__dirname, "../.env"), "utf8");
for (const line of envText.split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] = m[2];
}
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL);

// Find all assistant messages that are nurture refusals:
// They come right after a role='system' nurture prompt message,
// and contain the telltale "I appreciate the instruction" / "I appreciate the direction" phrase.
const refusals = await sql`
  SELECT id, LEFT(body, 80) as preview, created_at
  FROM swell_conversation_messages
  WHERE tenant_id = 'mackwash'
    AND role = 'assistant'
    AND (
      body ILIKE '%I appreciate the instruction%'
      OR body ILIKE '%I appreciate the direction%'
      OR body ILIKE '%I appreciate the request%'
      OR body ILIKE '%I appreciate the clarification%'
      OR body ILIKE '%stay true to my role%'
      OR body ILIKE '%stay in my lane%'
      OR body ILIKE '%intake coordinator%who responds%incoming%'
      OR body ILIKE '%outside my scope%intake%'
    )
`;

console.log(`Found ${refusals.length} refusal messages to hide:`);
refusals.forEach(r => console.log(`  [${r.id}] ${r.preview}`));

if (refusals.length === 0) {
  console.log("Nothing to hide.");
  await sql.end();
  process.exit(0);
}

const ids = refusals.map(r => r.id);
const result = await sql`
  UPDATE swell_conversation_messages
  SET error = '_hidden'
  WHERE id = ANY(${ids})
`;

console.log(`\nHidden ${result.count} messages.`);
await sql.end();
