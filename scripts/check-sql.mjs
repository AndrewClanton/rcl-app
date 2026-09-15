// Quick sanity-check query runner against the live Supabase Postgres DB.
// Usage: node scripts/check-sql.mjs "select count(*) from menu_items"
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const client = new Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user: process.env.SUPABASE_DB_USER || "postgres",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  const res = await client.query(process.argv[2]);
  console.table(res.rows);
} finally {
  await client.end();
}
