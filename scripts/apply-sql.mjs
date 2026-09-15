// Runs one or more .sql files directly against the project's Supabase
// Postgres database. Used for applying migrations/seed data until we adopt
// the full Supabase CLI workflow (supabase link / db push).
//
// Usage: node scripts/apply-sql.mjs supabase/migrations/xxx.sql [more.sql ...]
// Requires SUPABASE_DB_PASSWORD and NEXT_PUBLIC_SUPABASE_URL in .env.local.

import { readFileSync } from "node:fs";
import { Client } from "pg";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const password = process.env.SUPABASE_DB_PASSWORD;
const host = process.env.SUPABASE_DB_HOST;
const port = Number(process.env.SUPABASE_DB_PORT || 5432);
const user = process.env.SUPABASE_DB_USER || "postgres";
if (!password || !host) {
  console.error("SUPABASE_DB_HOST and SUPABASE_DB_PASSWORD must be set in .env.local");
  process.exit(1);
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node scripts/apply-sql.mjs <file.sql> [more.sql ...]");
  process.exit(1);
}

const client = new Client({
  host,
  port,
  user,
  password,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  for (const file of files) {
    console.log(`\n--- running ${file} ---`);
    const sql = readFileSync(file, "utf8");
    await client.query(sql);
    console.log(`--- ok: ${file} ---`);
  }
} finally {
  await client.end();
}
