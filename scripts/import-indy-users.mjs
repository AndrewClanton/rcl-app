// Imports the Indy ticketing system's customer export (2022-2025) for email
// marketing: who said yes to Royale email in their own words, their
// birthday (month and day only), and the Indy-era people who never had an
// account with us. Prints counts only: never a name, email or phone.
//
// Members stay opted in. This never turns anyone's email off:
//   - matched to a member, said yes: consent source 'indy_yes' (their own
//     words), with the date they joined Indy;
//   - matched to a member, said no: recorded as 'indy_no' (it only moves
//     them to the back of the warm-up order); their email setting is NOT
//     changed. Whether to honor these "no"s is Andrew's call (plan A10 #1);
//   - not a member yet: added as a free Insider, with email on if they said
//     yes and off if they said no (a new account, nobody switched off).
// Staff and owner rows, and rows with no email, are skipped.
//
// Idempotent on members.indy_user_id (Indy's id): run it again and nothing
// changes twice. Never reads the old-site holding table.
//
// Usage:
//   node scripts/import-indy-users.mjs <indy-users.csv> [--dry]
//   node scripts/import-indy-users.mjs <csv> --dry --members-file <json>   (offline: members from a file, for the check script)
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const membersFileAt = args.indexOf("--members-file");
const MEMBERS_FILE = membersFileAt >= 0 ? args[membersFileAt + 1] : null;
const csvPath = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--members-file");
if (!csvPath) {
  console.error("Usage: node scripts/import-indy-users.mjs <indy-users.csv> [--dry]");
  process.exit(1);
}
if (MEMBERS_FILE && !DRY) {
  console.error("--members-file only works with --dry.");
  process.exit(1);
}

// ---------- CSV (quoted fields, commas and newlines inside quotes) ----------
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const lc = (s) => (s ?? "").trim().toLowerCase();
const truthy = (s) => lc(s) === "true" || lc(s) === "1" || lc(s) === "yes";
const FLAGS = ["email_showtimes", "email_last_chance", "email_promotions", "email_newsletter"];

// Month and day of a date of birth, stored as year 2000 (the app's way).
function birthdayOf(s) {
  const t = (s ?? "").trim();
  let m;
  let mm;
  let dd;
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) [mm, dd] = [m[2], m[3]];
  else if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) [mm, dd] = [m[1], m[2]];
  else return null;
  const month = Number(mm);
  const day = Number(dd);
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  const d = new Date(Date.UTC(2000, month - 1, day));
  if (d.getUTCMonth() !== month - 1) return null;
  return `2000-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatPhone(raw) {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function isoOrNull(s) {
  const t = Date.parse(s ?? "");
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// ---------- read ----------
const rows = parseCsv(readFileSync(csvPath, "utf8"));
const counts = {
  rows: rows.length,
  skipped_staff: 0,
  skipped_no_email: 0,
  skipped_duplicate_in_file: 0,
  matched_yes: 0,
  matched_no: 0,
  new_yes: 0,
  new_no: 0,
  birthdays_filled: 0,
  already_imported: 0,
};

// All four email switches must agree (they did in the 2026-09-29 export).
for (const r of rows) {
  const vals = FLAGS.map((f) => truthy(r[f]));
  if (vals.some((v) => v !== vals[0])) {
    console.error(`Stopped: a row's four email switches disagree (Indy id ${String(r.id).slice(0, 12)}). Nothing was changed.`);
    process.exit(1);
  }
}

let members;
let supabase = null;
if (MEMBERS_FILE) {
  members = JSON.parse(readFileSync(MEMBERS_FILE, "utf8"));
} else {
  const { config } = await import("dotenv");
  config({ path: ".env.local", quiet: true });
  const { createClient } = await import("@supabase/supabase-js");
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.");
    process.exit(1);
  }
  supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  members = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("members").select("id, email, indy_user_id, birthday, erased_at").is("erased_at", null).not("email", "is", null).order("id").range(from, from + 999);
    if (error) {
      console.error(`Couldn't read members (${error.message}). Is the email migration (20261001090000) applied?`);
      process.exit(1);
    }
    members.push(...data);
    if (data.length < 1000) break;
  }
}
const byEmail = new Map(members.filter((m) => m.email).map((m) => [lc(m.email), m]));
const byIndy = new Map(members.filter((m) => m.indy_user_id).map((m) => [String(m.indy_user_id), m]));

// ---------- plan ----------
const seen = new Set();
const updates = []; // matched members
const inserts = []; // new members
for (const r of rows) {
  const staff = truthy(r.employee) || ["staff", "owner"].includes(lc(r["membership_type.name"]));
  if (staff) {
    counts.skipped_staff++;
    continue;
  }
  const email = lc(r.email);
  if (!email || !email.includes("@")) {
    counts.skipped_no_email++;
    continue;
  }
  if (seen.has(email)) {
    counts.skipped_duplicate_in_file++;
    continue;
  }
  seen.add(email);
  const yes = truthy(r.email_newsletter);
  const indyId = String(r.id ?? "").trim();
  const birthday = birthdayOf(r.date_of_birth);
  const createdAt = isoOrNull(r.created_at);
  const m = byIndy.get(indyId) ?? byEmail.get(email);
  if (m) {
    if (m.indy_user_id && String(m.indy_user_id) === indyId) counts.already_imported++;
    counts[yes ? "matched_yes" : "matched_no"]++;
    const fillBirthday = !m.birthday && birthday;
    if (fillBirthday) counts.birthdays_filled++;
    updates.push({ memberId: m.id, indyId, yes, birthday: fillBirthday ? birthday : null, createdAt, setIndy: !m.indy_user_id });
  } else {
    counts[yes ? "new_yes" : "new_no"]++;
    if (birthday) counts.birthdays_filled++;
    const name = [r.first_name, r.last_name].map((s) => (s ?? "").trim()).filter(Boolean).join(" ") || "Indy guest";
    inserts.push({ indyId, yes, birthday, createdAt, row: { name, email: r.email.trim(), phone: formatPhone(r.phone), tier: "Insiders", points: 0, email_opt_in: yes, email_opt_in_changed_at: yes ? new Date().toISOString() : null, indy_user_id: indyId, birthday } });
  }
}

function report(prefix) {
  console.log(`${prefix}Indy rows: ${counts.rows}`);
  console.log(`  skipped: ${counts.skipped_staff} staff/owner, ${counts.skipped_no_email} with no email, ${counts.skipped_duplicate_in_file} repeated emails`);
  console.log(`  already members: ${counts.matched_yes} said yes, ${counts.matched_no} said no (email left as it is)`);
  console.log(`  new to us: ${counts.new_yes} said yes, ${counts.new_no} said no`);
  console.log(`  birthdays filled (month and day): ${counts.birthdays_filled}`);
  console.log(`  already imported before: ${counts.already_imported}`);
}

if (DRY) {
  report("DRY RUN. Nothing was changed.\n");
  process.exit(0);
}

// ---------- write ----------
let failed = 0;
const logRows = [];
for (const u of updates) {
  const patch = { ...(u.setIndy ? { indy_user_id: u.indyId } : {}), ...(u.birthday ? { birthday: u.birthday } : {}) };
  if (Object.keys(patch).length) {
    const { error } = await supabase.from("members").update(patch).eq("id", u.memberId);
    if (error) {
      failed++;
      continue;
    }
  }
  const { data: had } = await supabase.from("email_consent_log").select("id").eq("member_id", u.memberId).eq("source", "indy_import").limit(1);
  if (had?.length) continue;
  const { error: pErr } = await supabase
    .from("member_email_prefs")
    .upsert({ member_id: u.memberId, consent_source: u.yes ? "indy_yes" : "indy_no", consent_at: u.createdAt, updated_at: new Date().toISOString() }, { onConflict: "member_id" });
  if (pErr) {
    failed++;
    continue;
  }
  logRows.push({ member_id: u.memberId, action: "import", source: "indy_import", detail: { indy: u.yes ? "yes" : "no" } });
}
for (const n of inserts) {
  const { data, error } = await supabase.from("members").insert(n.row).select("id").single();
  if (error) {
    // Already there (a re-run, or someone joined meanwhile): leave it.
    if (error.code !== "23505") failed++;
    continue;
  }
  await supabase.from("member_email_prefs").upsert({ member_id: data.id, consent_source: n.yes ? "indy_yes" : "indy_no", consent_at: n.createdAt }, { onConflict: "member_id" });
  logRows.push({ member_id: data.id, action: n.yes ? "opt_in" : "import", source: "indy_import", detail: { indy: n.yes ? "yes" : "no", new_member: true } });
}
for (let i = 0; i < logRows.length; i += 500) {
  const { error } = await supabase.from("email_consent_log").insert(logRows.slice(i, i + 500));
  if (error) failed++;
}
report("Done.\n");
if (failed) {
  console.log(`  ${failed} writes failed; run it again to finish (it skips what's done).`);
  process.exit(1);
}
