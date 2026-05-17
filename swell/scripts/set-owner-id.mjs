import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });

// Set Zak's Discord ID for testing — Mack's real ID stays in owner_name context
// We'll support multiple IDs properly later; for now link Zak to MackWash for the test
const r = await sql`
  UPDATE swell_tenants
  SET owner_discord_user_id = '1385472518978011266',
      owner_name = 'Zak'
  WHERE id = 'mackwash'
  RETURNING id, owner_name, owner_discord_user_id
`;
console.log("Updated:", r[0]);

// Mack's ID for later: 1327340335675736125
// After test, run: UPDATE swell_tenants SET owner_discord_user_id='1327340335675736125', owner_name='Mack' WHERE id='mackwash'

await sql.end();
process.exit(0);
