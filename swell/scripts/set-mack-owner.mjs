import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require" });
await sql`UPDATE swell_tenants SET owner_discord_user_id = '1327340335675736125', owner_name = 'Mack' WHERE id = 'mackwash'`;
console.log("Done — Mack is now the MackWash owner in Discord");
await sql.end();
process.exit(0);
