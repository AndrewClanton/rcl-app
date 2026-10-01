// Loads Indy's customer export (Indy was the ticketing system before this
// app) into indy_accounts, sorted into fill / new / conflict / skip by the
// rules in src/lib/indy-rules.ts. Reads members, never writes them: nothing
// reaches members until an admin presses Import at /admin/members/indy.
// The export is kept outside the repo (it holds ~1,500 people's personal
// info), and this prints counts only: never a name, email or phone.
//
// Safe to re-run (a fresher export, say): rows are written by Indy id. Rows
// nobody has touched are sorted afresh; a row someone decided at
// /admin/members/indy keeps its decision and link; a row already imported,
// or removed at the person's request, is left alone (also if that happens
// while this runs: each row is written only if it's still as it was read).
//
// Stops, printing counts only, if a row has more or fewer fields than the
// header, or a yes/no column holds anything but true, false or blank.
//
// Usage (from the repo root, with .env.local):
//   node scripts/load-indy-accounts.mjs <indy-users.csv> [--dry]
// Offline, for scripts/check-indy-import.mjs (no database at all):
//   node scripts/load-indy-accounts.mjs <csv> --dry --members-file <members.json> [--staging-file <rows.json>]
// (Node 23.6+ runs the .ts rules directly.)
import { readFileSync } from "node:fs";
import { centralToday, classifyIndy, cleanIndyRecord, mergeIndyRow, oddIndyValues, readIndyCsv, summarizeIndy } from "../src/lib/indy-rules.ts";

const args = process.argv.slice(2);
const flagValue = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : null;
};
const DRY = args.includes("--dry");
const MEMBERS_FILE = flagValue("--members-file");
const STAGING_FILE = flagValue("--staging-file");
const csvPath = args.find((a, i) => !a.startsWith("--") && !["--members-file", "--staging-file"].includes(args[i - 1]));
if (!csvPath) {
  console.error("Usage: node scripts/load-indy-accounts.mjs <indy-users.csv> [--dry] [--members-file <json> --staging-file <json>]");
  process.exit(1);
}
if ((MEMBERS_FILE || STAGING_FILE) && !DRY) {
  console.error("--members-file and --staging-file only work with --dry.");
  process.exit(1);
}
if (STAGING_FILE && !MEMBERS_FILE) {
  console.error("--staging-file needs --members-file (offline runs never touch the database).");
  process.exit(1);
}

// ---- The export ------------------------------------------------------------
const { columns, records, missing, ragged } = readIndyCsv(readFileSync(csvPath, "utf8"));
if (missing.length) {
  console.error(`Stopped: the export is missing these columns: ${missing.join(", ")}. Nothing was written.`);
  process.exit(1);
}
// A stray quote shifts every column after it, so the rest would be read from
// the wrong columns.
if (ragged) {
  console.error(`Stopped: ${ragged} row(s) have more or fewer fields than the header (a stray quote?). Nothing was written.`);
  process.exit(1);
}
// Only "true" reads as yes: 1/0 or yes/no would turn every answer into a no
// and stop staff accounts being skipped.
const odd = oddIndyValues(records);
if (Object.keys(odd).length) {
  const list = Object.entries(odd)
    .map(([col, n]) => `${col}: ${n}`)
    .join(", ");
  console.error(`Stopped: yes/no columns with values other than true, false or blank (rows per column): ${list}. Nothing was written.`);
  process.exit(1);
}
const today = centralToday();
const seen = new Set();
let noId = 0;
let repeatedId = 0;
const people = [];
for (const r of records) {
  const person = cleanIndyRecord(r, today);
  if (!person.indy_user_id) {
    noId++;
    continue;
  }
  if (seen.has(person.indy_user_id)) {
    repeatedId++;
    continue;
  }
  seen.add(person.indy_user_id);
  people.push(person);
}

// ---- Members and what's already staged (read only) --------------------------
const MEMBER_COLUMNS = ["id", "name", "email", "phone", "birthday", "email_opt_in", "email_opt_in_changed_at", "indy_user_id", "erased_at"];
const STAGING_COLUMNS =
  "indy_user_id, email, classification, reasons, email_member_id, phone_member_id, target_member_id, import_as, decision, said_no_decision, decided_by, decided_at, imported_member_id, imported_at, erased_at";
const asMember = (m) => Object.fromEntries(MEMBER_COLUMNS.map((c) => [c, m[c] ?? null]));
const isMissingTable = (e) => e?.code === "PGRST205" || e?.code === "42P01";

let supabase = null;
let members;
let existingRows;
let stagingMissing = false;
if (MEMBERS_FILE) {
  members = JSON.parse(readFileSync(MEMBERS_FILE, "utf8")).map(asMember);
  existingRows = STAGING_FILE ? JSON.parse(readFileSync(STAGING_FILE, "utf8")) : [];
} else {
  const { config } = await import("dotenv");
  config({ path: ".env.local", quiet: true });
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.");
    process.exit(1);
  }
  const { createClient } = await import("@supabase/supabase-js");
  supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const readAll = async (table, select, order) => {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from(table).select(select).order(order).range(from, from + 999);
      if (error) return { error };
      out.push(...data);
      if (data.length < 1000) return { data: out };
    }
  };
  // Erased members are read too, only to recognise their Indy link.
  let read = await readAll("members", MEMBER_COLUMNS.join(", "), "id");
  if (read.error?.code === "42703" && DRY) {
    // members.indy_user_id comes with the migration; a dry run before it
    // still works, with nobody linked yet.
    console.log("(members.indy_user_id isn't there yet: the migration isn't applied. Counting with no Indy links.)");
    read = await readAll("members", MEMBER_COLUMNS.filter((c) => c !== "indy_user_id").join(", "), "id");
  }
  if (read.error) {
    console.error(`Couldn't read members (${read.error.message}). Nothing was written.`);
    process.exit(1);
  }
  members = read.data.map(asMember);
  const staged = await readAll("indy_accounts", STAGING_COLUMNS, "indy_user_id");
  if (staged.error && isMissingTable(staged.error)) {
    if (!DRY) {
      console.error("indy_accounts isn't there: apply supabase/migrations/20261001140000_indy_accounts.sql first. Nothing was written.");
      process.exit(1);
    }
    stagingMissing = true;
    existingRows = [];
  } else if (staged.error) {
    console.error(`Couldn't read indy_accounts (${staged.error.message}). Nothing was written.`);
    process.exit(1);
  } else existingRows = staged.data;
}

// ---- Sort -------------------------------------------------------------------
const existing = new Map(existingRows.map((r) => [r.indy_user_id, r]));
const membersById = new Map(members.map((m) => [m.id, m]));
// Emails of Indy accounts already imported: one imported by phone into a
// member with no email leaves its email on no member, so another account
// with that email mustn't look new.
const importedEmails = new Map(
  existingRows.filter((r) => (r.imported_member_id || r.imported_at) && !r.erased_at && r.email).map((r) => [r.email.trim().toLowerCase(), r.indy_user_id])
);
const fresh = classifyIndy(people, members, importedEmails);
const rows = [];
let keptDecision = 0;
let leftAlone = 0;
for (const row of fresh) {
  const merged = mergeIndyRow(row, existing.get(row.indy_user_id), membersById);
  if (!merged) leftAlone++;
  else {
    if (existing.get(row.indy_user_id)?.decided_by) keptDecision++;
    rows.push(merged);
  }
}

// ---- Counts only ------------------------------------------------------------
const s = summarizeIndy(rows);
const sorted = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
console.log(`${records.length} rows, ${columns.length} columns; ${people.length} Indy accounts${noId ? `, ${noId} with no id (dropped)` : ""}${repeatedId ? `, ${repeatedId} repeated ids (dropped)` : ""}`);
console.log(`members read: ${members.filter((m) => !m.erased_at).length} (plus ${members.filter((m) => m.erased_at).length} erased, only for their Indy links)`);
console.log("groups:", s.byClass);
console.log("reasons:", sorted(s.byReason));
console.log("decisions:", s.decisions);
console.log(`said yes to Indy email: ${s.saidYes}; said no: ${s.saidNo}`);
console.log(`new members: ${s.newSaidYes} said yes (email on), ${s.newSaidNo} said no (email off)`);
console.log(`said no on Indy but opted in here by the old default (for Andrew to honor or leave): ${s.saidNoReview}`);
console.log("fills by field:", s.fillsByField);
console.log(`to write: ${rows.length} (${keptDecision} keep a decision made by hand); left alone: ${leftAlone} (already imported or removed)`);
if (stagingMissing) console.log("(indy_accounts isn't there yet, so this counted as a first load.)");
if (DRY) {
  console.log("Dry run: nothing was written.");
  process.exit(0);
}

// ---- Write indy_accounts only -----------------------------------------------
// A row that's new to the table is inserted (unless one appeared meanwhile).
// A row already there is updated only if it's still as it was read above:
// not removed at the person's request (the erase trigger blanks it), not
// imported, and not decided again. So nobody's details come back, and no
// pick is written over, because of something that happened while this ran.
const loadedAt = new Date().toISOString();
const inserts = rows.filter((r) => !existing.has(r.indy_user_id)).map((r) => ({ ...r, loaded_at: loadedAt }));
const updates = rows.filter((r) => existing.has(r.indy_user_id));
let written = 0;
let changedMeanwhile = 0;
const stop = (message) => {
  console.error(`Stopped after ${written} rows (${message}). Run it again to finish; it's safe to repeat.`);
  process.exit(1);
};
for (let i = 0; i < inserts.length; i += 500) {
  const batch = inserts.slice(i, i + 500);
  const { data, error } = await supabase.from("indy_accounts").upsert(batch, { onConflict: "indy_user_id", ignoreDuplicates: true }).select("indy_user_id");
  if (error) stop(error.message);
  written += data.length;
  changedMeanwhile += batch.length - data.length;
}
let failed = null;
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(8, updates.length) }, async () => {
    while (!failed && next < updates.length) {
      const { indy_user_id, ...patch } = updates[next++];
      const before = existing.get(indy_user_id);
      let q = supabase
        .from("indy_accounts")
        .update({ ...patch, loaded_at: loadedAt })
        .eq("indy_user_id", indy_user_id)
        .is("erased_at", null)
        .is("imported_member_id", null)
        .is("imported_at", null);
      q = before.decided_at ? q.eq("decided_at", before.decided_at) : q.is("decided_at", null);
      q = before.decided_by ? q.eq("decided_by", before.decided_by) : q.is("decided_by", null);
      const { data, error } = await q.select("indy_user_id");
      if (error) failed = error.message;
      else if (data.length) written++;
      else changedMeanwhile++;
    }
  })
);
if (failed) stop(failed);
console.log(
  `loaded ${written} into indy_accounts${changedMeanwhile ? ` (${changedMeanwhile} changed while this ran and were left as they are)` : ""}. Review and import at /admin/members/indy.`
);
