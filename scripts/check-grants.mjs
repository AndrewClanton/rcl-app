// Supabase's Oct 30, 2026 change: tables, views, sequences and functions
// created in the public schema no longer get automatic grants for anon,
// authenticated or service_role. Until a migration grants them, the app can't
// reach them through supabase-js -- not even with the service role key, which
// skips row level security but still needs a grant. supabase/README.md has
// the rules and a copy-paste block.
//
// This checks the migrations themselves, so it needs no database:
//
//   node scripts/check-grants.mjs                  migrations from 2026-10-03 on
//   node scripts/check-grants.mjs <file.sql> ...   just these files
//   node scripts/check-grants.mjs --all            every migration (older ones
//                                                  relied on the automatic
//                                                  grants, so expect a list)
//
// For each file it wants:
//   - a table or view       a grant on it to service_role
//   - a sequence, or a      a grant on the sequence (identity and serial
//     serial/identity column  columns make one: <table>_<column>_seq)
//   - a function            a grant or a revoke on it, so who may call it was
//                           decided (trigger functions are skipped: nobody
//                           calls those directly)
// A table only plain SQL touches (a backup, say) can opt out with a comment
// in its migration:   -- no-grants: <name>
//
// With database credentials (.env.local, like check-sql.mjs), --db checks the
// live database instead: anything in public that service_role can't reach,
// and tables with an anon-read policy that anon can't read.
//
//   node scripts/check-grants.mjs --db
//
// apply-sql.mjs runs the same check on a migration before applying it.
import { readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = "supabase/migrations";
// Migrations named from this timestamp on are checked by default.
export const CUTOFF = "20261003000000";

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--db")) {
    process.exitCode = await checkDatabase();
  } else {
    const files = args.filter((a) => !a.startsWith("--"));
    const all = args.includes("--all");
    const targets = files.length
      ? files
      : readdirSync(MIGRATIONS)
          .filter((f) => f.endsWith(".sql") && (all || f >= CUTOFF))
          .sort()
          .map((f) => join(MIGRATIONS, f));
    process.exitCode = checkFiles(targets);
  }
}

function checkFiles(paths) {
  if (!paths.length) {
    console.log(`No migrations from ${CUTOFF} on yet. Pass file names, or --all.`);
    return 0;
  }
  let missing = 0;
  for (const path of paths) {
    const problems = checkSql(readFileSync(path, "utf8"));
    if (!problems.length) {
      console.log(`ok       ${basename(path)}`);
      continue;
    }
    missing += problems.length;
    console.log(`MISSING  ${basename(path)}`);
    for (const p of problems) console.log(`           ${p}`);
  }
  if (missing) console.log(`\n${missing} missing. See supabase/README.md ("Grants") for what to add.`);
  return missing ? 1 : 0;
}

// Names are compared without "public.", quotes or case.
function bare(name) {
  return name.replace(/"/g, "").replace(/^public\./i, "").toLowerCase();
}

// What a migration's SQL creates without granting, one line each.
export function checkSql(raw) {
  const optOut = new Set([...raw.matchAll(/--\s*no-grants:\s*([\w".]+)/gi)].map((m) => bare(m[1])));
  // Function bodies and comments say all sorts of things; only statements count.
  const sql = raw
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "");

  const grantsTo = (kind, role) => {
    const names = new Set();
    let everything = false;
    const re = new RegExp(`\\bgrant\\s+[^;]*?\\bon\\s+(all\\s+${kind}s\\s+in\\s+schema\\s+public|${kind === "table" ? "(?:table\\s+)?" : `${kind}\\s+`}([^;]*?))\\s+to\\s+([^;]*)`, "gi");
    for (const m of sql.matchAll(re)) {
      if (role && !new RegExp(`\\b${role}\\b`, "i").test(m[3])) continue;
      if (/^all\s/i.test(m[1])) everything = true;
      else for (const n of m[2].split(",")) names.add(bare(n.trim().replace(/\(.*$/s, "")));
    }
    return { has: (n) => everything || names.has(bare(n)) };
  };
  const tableGrants = grantsTo("table", "service_role");
  const sequenceGrants = grantsTo("sequence", null);
  const decidedFunctions = new Set(
    [...sql.matchAll(/\b(?:grant|revoke)\s+[^;]*?\bon\s+function\s+([\w".]+)/gi)].map((m) => bare(m[1])),
  );

  const problems = [];
  const need = (name, what) => {
    if (!optOut.has(bare(name))) problems.push(`${what}`);
  };

  // Tables, and the sequences their identity/serial columns make.
  for (const m of sql.matchAll(/\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w".]+)\s*(\(|as\b)/gi)) {
    const table = m[1];
    if (/^(?!public\.)\w+\./i.test(table.replace(/"/g, ""))) continue; // another schema
    if (!tableGrants.has(table)) need(table, `table ${bare(table)}: grant ... on ${bare(table)} to service_role`);
    if (m[2] !== "(") continue;
    for (const col of columnsOf(sql, m.index + m[0].length - 1)) {
      const seq = `${bare(table)}_${col}_seq`;
      if (!sequenceGrants.has(seq)) need(table, `sequence ${seq} (identity/serial column ${col}): grant usage, select on sequence ${seq} to ...`);
    }
  }
  for (const m of sql.matchAll(/\bcreate\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?([\w".]+)/gi)) {
    if (!tableGrants.has(m[1])) need(m[1], `view ${bare(m[1])}: grant select on ${bare(m[1])} to service_role`);
  }
  for (const m of sql.matchAll(/\bcreate\s+sequence\s+(?:if\s+not\s+exists\s+)?([\w".]+)/gi)) {
    if (!sequenceGrants.has(m[1])) need(m[1], `sequence ${bare(m[1])}: grant usage, select on sequence ${bare(m[1])} to ...`);
  }
  for (const m of sql.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+([\w".]+)\s*\(([^)]*)\)\s*returns\s+(\w+)/gi)) {
    if (m[3].toLowerCase() === "trigger" || /^(?!public\.)\w+\./i.test(m[1].replace(/"/g, ""))) continue;
    if (!decidedFunctions.has(bare(m[1]))) need(m[1], `function ${bare(m[1])}(${m[2].trim()}): grant execute ... to service_role (or revoke, if nothing calls it directly)`);
  }
  return problems;
}

// The identity and serial columns in a create table's column list, which
// starts at sql[open] === "(".
function columnsOf(sql, open) {
  let depth = 0;
  let end = open;
  for (; end < sql.length; end++) {
    if (sql[end] === "(") depth++;
    else if (sql[end] === ")" && --depth === 0) break;
  }
  const body = sql.slice(open + 1, end);
  const cols = [];
  for (const line of splitTopLevel(body)) {
    const m = line.trim().match(/^"?(\w+)"?\s+(\w+)/);
    if (!m) continue;
    if (/^(small|big)?serial$/i.test(m[2]) || /\bgenerated\s+(always|by\s+default)\s+as\s+identity\b/i.test(line)) cols.push(m[1].toLowerCase());
  }
  return cols;
}

function splitTopLevel(s) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

async function checkDatabase() {
  const { config } = await import("dotenv");
  const { Client } = await import("pg");
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
    const kinds = { r: "table", p: "table", v: "view", m: "view", S: "sequence" };
    const unreachable = await client.query(`
      select c.relname as name, c.relkind as kind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')
        and case when c.relkind = 'S' then not has_sequence_privilege('service_role', c.oid, 'USAGE')
                 else not has_table_privilege('service_role', c.oid, 'SELECT') end
      order by 1`);
    const functions = await client.query(`
      select p.oid::regprocedure::text as name
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
        and not has_function_privilege('service_role', p.oid, 'EXECUTE')
      order by 1`);
    const anonRead = await client.query(`
      select distinct pol.tablename as name
      from pg_policies pol
      where pol.schemaname = 'public' and pol.cmd in ('SELECT', 'ALL')
        and (pol.roles @> array['public']::name[] or pol.roles @> array['anon']::name[])
        and not has_table_privilege('anon', format('public.%I', pol.tablename), 'SELECT')
      order by 1`);
    const defaults = await client.query(`
      select pg_get_userbyid(d.defaclrole) as owner, d.defaclobjtype as kind, d.defaclacl::text as acl
      from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
      where n.nspname = 'public' order by 1, 2`);

    console.log("Default privileges in public (after Oct 30, new objects no longer list anon/authenticated/service_role here):");
    for (const d of defaults.rows) console.log(`  ${d.owner} ${{ r: "tables", S: "sequences", f: "functions", T: "types" }[d.kind] ?? d.kind}: ${d.acl}`);
    console.log();
    const report = (title, rows, fmt) => {
      console.log(rows.length ? `${title}:` : `${title}: none`);
      for (const r of rows) console.log(`  ${fmt(r)}`);
    };
    report("Tables, views and sequences service_role can't reach", unreachable.rows, (r) => `${kinds[r.kind] ?? r.kind} ${r.name}`);
    report("Functions service_role can't call (fine if only triggers or other functions use them)", functions.rows, (r) => r.name);
    report("Tables with an anon-read policy that anon can't read", anonRead.rows, (r) => r.name);
    return unreachable.rows.length || anonRead.rows.length ? 1 : 0;
  } finally {
    await client.end();
  }
}
