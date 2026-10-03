// Runs one or more .sql files directly against the project's Supabase
// Postgres database. Used for applying migrations/seed data until we adopt
// the full Supabase CLI workflow (supabase link / db push).
//
// Usage: node scripts/apply-sql.mjs supabase/migrations/xxx.sql [more.sql ...]
// Requires SUPABASE_DB_PASSWORD and NEXT_PUBLIC_SUPABASE_URL in .env.local.
//
// A migration from 2026-10-03 on that creates a table, view, sequence or
// function without granting it is refused before anything runs: since
// Supabase's Oct 30, 2026 change the app can't reach it otherwise (see
// scripts/check-grants.mjs and supabase/README.md). --skip-grant-check runs
// it anyway.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Client } from "pg";
import { config } from "dotenv";
import { CUTOFF, checkSql } from "./check-grants.mjs";

config({ path: ".env.local", quiet: true });

const password = process.env.SUPABASE_DB_PASSWORD;
const host = process.env.SUPABASE_DB_HOST;
const port = Number(process.env.SUPABASE_DB_PORT || 5432);
const user = process.env.SUPABASE_DB_USER || "postgres";
if (!password || !host) {
  console.error("SUPABASE_DB_HOST and SUPABASE_DB_PASSWORD must be set in .env.local");
  process.exit(1);
}

const skipGrantCheck = process.argv.includes("--skip-grant-check");
const files = process.argv.slice(2).filter((a) => a !== "--skip-grant-check");
if (files.length === 0) {
  console.error("Usage: node scripts/apply-sql.mjs <file.sql> [more.sql ...]");
  process.exit(1);
}

if (!skipGrantCheck) {
  let refused = false;
  for (const file of files) {
    if (basename(file) < CUTOFF) continue;
    const problems = checkSql(readFileSync(file, "utf8"));
    if (!problems.length) continue;
    refused = true;
    console.error(`${file} creates things it doesn't grant:`);
    for (const p of problems) console.error(`  ${p}`);
  }
  if (refused) {
    console.error("\nNothing was run. Add the grants (supabase/README.md, \"Grants\"), or pass --skip-grant-check.");
    process.exit(1);
  }
}

const client = new Client({
  host,
  port,
  user,
  password,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

// A migration's `raise notice` lines (what a data fix created or skipped).
client.on("notice", (n) => console.log(`  notice: ${n.message}`));

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
