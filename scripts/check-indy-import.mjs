// Checks the Indy import's rules (src/lib/indy-rules.ts) and its loader
// (scripts/load-indy-accounts.mjs) without touching the database, using
// made-up people only: the CSV reader with quotes, commas and line breaks
// inside fields; cleaning up names, emails, phones and birthdays; each sort
// (fill / new / conflict / skip); that a fill never overwrites anything or
// sets an email; the "said no on Indy" rule; and that a re-run keeps
// decisions and leaves imported rows alone. Also runs the loader offline
// and checks it prints counts, never a person.
//
// Usage: node scripts/check-indy-import.mjs   (Node 23.6+ runs the .ts directly)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as rules from "../src/lib/indy-rules.ts";
import { birthdayValue as appBirthdayValue } from "../src/lib/visits.ts";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- the CSV ----------
{
  const text =
    "﻿id,first_name,address,email\r\n" +
    '1,Avery,"12 Elm St, Apt 4",avery@quillmail.net\r\n' +
    '2,"Rowan ""Ro""","Line one\nLine two",\n' +
    "\r\n" +
    "3,Sage,,sage@quillmail.net";
  const rows = rules.parseCsv(text);
  check("CSV: a byte-order mark and blank lines are ignored", rows.length === 4 && rows[0][0] === "id");
  check("CSV: a quoted comma stays in its field", rows[1][2] === "12 Elm St, Apt 4" && rows[1].length === 4);
  check('CSV: "" inside quotes is one quote', rows[2][1] === 'Rowan "Ro"');
  check("CSV: a line break inside quotes stays in its field", rows[2][2] === "Line one\nLine two" && rows[2].length === 4);
  check("CSV: last line without a newline is kept", same(rows[3], ["3", "Sage", "", "sage@quillmail.net"]));
  const { records, missing } = rules.readIndyCsv(text);
  check("CSV: records are keyed by column", records[0].address === "12 Elm St, Apt 4" && records[2].email === "sage@quillmail.net");
  check("CSV: missing columns are reported", missing.includes("date_of_birth") && missing.includes("employee"));
}

// ---------- cleaning up ----------
check("name: ALL CAPS is Title Cased", rules.cleanName("MARY-JANE O'NEIL") === "Mary-Jane O'Neil");
check("name: all lowercase is Title Cased, spaces collapsed", rules.cleanName("  avery   quill ") === "Avery Quill");
check("name: mixed case is left as typed", rules.cleanName("McAllister") === "McAllister" && rules.cleanName("DeAngelo") === "DeAngelo");
check("name: blank, N/A, digits and emails are no name", [" ", "N/A", "none", "123", "a@b.co"].every((n) => rules.cleanName(n) === null));
check("email: trimmed and lowercased", rules.cleanEmail("  Avery.Quill@QuillMail.NET ").email === "avery.quill@quillmail.net");
check("email: unusable or placeholder is left off with a note", !rules.cleanEmail("not-an-email").email && !!rules.cleanEmail("noemail@quillmail.net").note);
{
  const a = rules.cleanPhone("417-555-0142");
  check("phone: 999-999-9999 is formatted like the app", a.digits === "4175550142" && a.formatted === "(417) 555-0142");
  check("phone: a leading 1 is dropped", rules.cleanPhone("+1 (417) 555-0142").digits === "4175550142");
  const short = rules.cleanPhone("417-555-014");
  check("phone: 9 digits is left off with a reason", short.digits === null && short.formatted === null && /10 digits/.test(short.note));
  check("phone: made-up numbers are left off", rules.cleanPhone("000-000-0000").digits === null && rules.cleanPhone("123-555-0142").digits === null);
  check("phone: blank is simply none", same(rules.cleanPhone(""), { digits: null, formatted: null }));
}
{
  const today = "2026-09-30";
  const b = (raw, joined = "2023-05-01") => rules.cleanBirthday(raw, joined, today);
  check("birthday: month and day in 2000, birth year dropped", b("1987-03-14").birthday === "2000-03-14");
  check("birthday: Feb 29 fits", b("1992-02-29").birthday === "2000-02-29");
  check("birthday: impossible dates are left off", b("1990-02-30").birthday === null && b("1990-13-01").birthday === null && b("03/14/1987").birthday === null);
  check("birthday: before 1900 or 1900-01-01 is a placeholder", b("1899-05-01").birthday === null && b("1900-01-01").birthday === null);
  check("birthday: in the future is left off", b("2027-01-01", null).birthday === null);
  check("birthday: on or after the day they joined Indy is the form's default", b("2023-05-01").birthday === null && b("2024-01-01").birthday === null);
  check("birthday: same rule as the app's birthdayValue", [[2, 29], [4, 31], [12, 31], [0, 1], [1, 0], [6, 15]].every(([m, d]) => rules.birthdayValue(m, d) === appBirthdayValue(m, d)));
}
check("Indy times are Central: summer is UTC-5", rules.centralToIso("2024-06-01 19:42:10") === "2024-06-02T00:42:10.000Z");
check("Indy times are Central: winter is UTC-6", rules.centralToIso("2024-01-15 12:00:00") === "2024-01-15T18:00:00.000Z");

// ---------- one person ----------
const TODAY = "2026-09-30";
let nextId = 1000;
function indyRow(over = {}) {
  const yes = over.yes ?? true;
  const r = {
    id: String(nextId++),
    type: "standard",
    first_name: "Avery",
    last_name: "Quill",
    email: "",
    "membership_type.name": "Royale Insiders",
    created_at: "2023-05-01 18:30:00",
    phone: "",
    points_preloaded: "40",
    date_of_last_visit: "",
    employee: "false",
    email_showtimes: String(yes),
    email_last_chance: String(yes),
    email_promotions: String(yes),
    email_newsletter: String(yes),
    date_of_birth: "",
    ...over,
  };
  delete r.yes;
  return r;
}
{
  const p = rules.cleanIndyRecord(indyRow({ email: "Avery@QuillMail.net", phone: "417-555-0101", date_of_birth: "1985-07-04" }), TODAY);
  check("record: said yes when all four switches are true", p.said_yes === true && p.notes.length === 0);
  check("record: fields cleaned", p.email === "avery@quillmail.net" && p.phone === "(417) 555-0101" && p.birthday === "2000-07-04" && p.indy_points === 40);
  const mixed = rules.cleanIndyRecord(indyRow({ email: "m@quillmail.net", email_newsletter: "false" }), TODAY);
  check("record: a mixed answer counts as no, with a reason", mixed.said_yes === false && mixed.notes.some((n) => /mixed/.test(n)));
  const no = rules.cleanIndyRecord(indyRow({ email: "n@quillmail.net", yes: false }), TODAY);
  check("record: all four false is a plain no", no.said_yes === false && !no.notes.some((n) => /mixed/.test(n)));
  const paid = rules.cleanIndyRecord(indyRow({ email: "p@quillmail.net", "membership_type.name": "Royale Insiders+" }), TODAY);
  check("record: a paid Indy plan is noted, not a skip", paid.skip.length === 0 && paid.notes.some((n) => /paid Indy plan/.test(n)));
  check("record: staff, Staff and Owner plans are skipped", [
    indyRow({ email: "s1@quillmail.net", employee: "true" }),
    indyRow({ email: "s2@quillmail.net", "membership_type.name": "Staff" }),
    indyRow({ email: "s3@quillmail.net", "membership_type.name": "Owner" }),
  ].every((r) => rules.cleanIndyRecord(r, TODAY).skip.length > 0));
  check("record: test accounts are skipped", rules.cleanIndyRecord(indyRow({ email: "test1@quillmail.net" }), TODAY).skip.some((s) => /test/.test(s)));
  check("record: no email and no phone is skipped", rules.cleanIndyRecord(indyRow({}), TODAY).skip.includes("no email or phone"));
}

// ---------- sorting ----------
const M = (id, over = {}) => ({
  id,
  name: "Member " + id,
  email: null,
  phone: null,
  birthday: null,
  email_opt_in: true,
  email_opt_in_changed_at: null,
  indy_user_id: null,
  erased_at: null,
  ...over,
});
const members = [
  M("m-email", { name: "blake.fenn", email: "Blake.Fenn@quillmail.net", phone: "(417) 555-0110" }), // old-site placeholder name
  M("m-phone-only", { name: "Casey Moor", phone: "(417) 555-0111" }), // no email
  M("m-a", { name: "Drew Pike", email: "drew@quillmail.net", phone: null }),
  M("m-b", { name: "Drew P", email: "other@quillmail.net", phone: "(417) 555-0112" }),
  M("m-diff", { name: "Ellis Park", email: "ellis@quillmail.net", phone: "(417) 555-0113" }),
  M("m-shared", { name: "Finley Oak", email: "finley@quillmail.net" }),
  M("m-dup1", { name: "Gray One", phone: "(417) 555-0114" }),
  M("m-dup2", { name: "Gray Two", phone: "+1 417 555 0114" }),
  M("m-linked", { name: "Harper Vale", email: "harper@quillmail.net", indy_user_id: "9001" }),
  M("m-erased", { name: "Removed member", email: null, erased_at: "2026-09-20T00:00:00Z", indy_user_id: "9002" }),
  M("m-erased-email", { name: "Removed member", email: "gone@quillmail.net", erased_at: "2026-09-20T00:00:00Z" }),
  M("m-full", { name: "Jordan Reed", email: "jordan@quillmail.net", phone: "(417) 555-0199", birthday: "2000-01-02", email_opt_in: true, email_opt_in_changed_at: "2026-09-01T00:00:00Z" }),
];
const people = [
  indyRow({ id: "1", first_name: "BLAKE", last_name: "FENN", email: "blake.fenn@quillmail.net", phone: "417-555-0110", date_of_birth: "1980-10-10", yes: false }),
  indyRow({ id: "2", first_name: "Casey", last_name: "Moor", email: "casey@quillmail.net", phone: "417-555-0111" }),
  indyRow({ id: "3", email: "drew@quillmail.net", phone: "417-555-0112" }),
  indyRow({ id: "4", email: "someone.else@quillmail.net", phone: "417-555-0113" }),
  indyRow({ id: "5", email: "finley@quillmail.net" }),
  indyRow({ id: "6", email: "FINLEY@quillmail.net " }), // repeated elsewhere with another id
  indyRow({ id: "7", email: "gray@quillmail.net", phone: "417-555-0114" }),
  indyRow({ id: "8", email: "harper@quillmail.net" }),
  indyRow({ id: "9001", email: "harper@quillmail.net" }),
  indyRow({ id: "9002", email: "back@quillmail.net" }),
  indyRow({ id: "10", email: "gone@quillmail.net" }),
  indyRow({ id: "11", first_name: "Kai", last_name: "Lark", email: "kai@quillmail.net", phone: "417-555-0120", date_of_birth: "1999-12-24", yes: false }),
  indyRow({ id: "12", email: "staff@quillmail.net", employee: "true" }),
  indyRow({ id: "13", phone: "417-555-0121" }),
  indyRow({ id: "14", email: "jordan@quillmail.net", phone: "417-555-0122", date_of_birth: "1970-05-05", first_name: "Jo" }),
].map((r) => rules.cleanIndyRecord(r, TODAY));
const sortedRows = rules.classifyIndy(people, members);
const by = new Map(sortedRows.map((r) => [r.indy_user_id, r]));
const cls = (id) => by.get(id)?.classification;

check("fill: matched by email (case doesn't matter)", cls("1") === "fill" && by.get("1").target_member_id === "m-email" && by.get("1").decision === "import");
check("fill: phone alone, where that member has no email", cls("2") === "fill" && by.get("2").target_member_id === "m-phone-only");
check("conflict: email and phone match different members", cls("3") === "conflict" && by.get("3").email_member_id === "m-a" && by.get("3").phone_member_id === "m-b");
check("conflict: phone matches a member with a different email", cls("4") === "conflict" && by.get("4").phone_member_id === "m-diff" && !by.get("4").target_member_id);
check("conflict: two Indy accounts land on the same member", cls("5") === "conflict" && cls("6") === "conflict" && by.get("5").decision === "review");
check("conflict: phone matches more than one member", cls("7") === "conflict");
check("conflict: the member is linked to a different Indy account", cls("8") === "conflict");
check("fill: the member already linked to this Indy account", cls("9001") === "fill" && by.get("9001").target_member_id === "m-linked");
check("skip: a member removed at their request (by Indy link)", cls("9002") === "skip" && by.get("9002").reasons.includes("removed at their request"));
check("erased members are never matched", cls("10") === "new" && !by.get("10").email_member_id);
check("new: no match and an email; approved by default", cls("11") === "new" && by.get("11").decision === "import" && by.get("11").import_as === "new");
check("skip: staff", cls("12") === "skip" && by.get("12").decision === "skip");
check("skip: phone only and no member has it", cls("13") === "skip");
check("conflict rows start as review, skips as skip", sortedRows.every((r) => (r.classification === "conflict" ? r.decision === "review" : r.classification === "skip" ? r.decision === "skip" : r.decision === "import")));
check("no row ever plans to fill an email", sortedRows.every((r) => !r.planned_fills.includes("email")));

// ---------- fills never overwrite ----------
check("fill plan: an old-site placeholder name and empty birthday get filled; the phone they have stays", same(by.get("1").planned_fills, ["birthday", "name"]));
check("fill plan: a member with everything gets nothing", rules.plannedFills(people[14], members.find((m) => m.id === "m-full")).length === 0);
check("fill plan: a real name is never replaced", !rules.plannedFills(people[1], members.find((m) => m.id === "m-phone-only")).includes("name"));
{
  const row = { ...by.get("1"), imported_member_id: null, erased_at: null, said_no_decision: "leave" };
  const now = "2026-10-01T15:00:00.000Z";
  // At import time the member has since added a birthday themselves.
  const since = { ...members[0], birthday: "2000-02-02" };
  const plan = rules.fillPlan(row, since, now);
  check("import: re-reads the member and fills only what's still empty", !("birthday" in plan.patch) && plan.patch.name === "Blake Fenn" && !("phone" in plan.patch));
  check("import: never sets an email", !("email" in plan.patch));
  check("import: links the Indy account where none is linked", plan.patch.indy_user_id === "1");
  check("import: never re-links a member linked elsewhere", rules.fillPlan(row, { ...since, indy_user_id: "777" }, now).problem !== null);
  check("import: a removed or missing member isn't filled", rules.fillPlan(row, { ...since, erased_at: now }, now).problem !== null && rules.fillPlan(row, null, now).problem !== null);
  check("import: 'leave' doesn't touch email", !("email_opt_in" in plan.patch));
  const pending = rules.fillPlan({ ...row, said_no_decision: "pending" }, since, now);
  check("import: 'pending' doesn't touch email", !("email_opt_in" in pending.patch));
  const honor = rules.fillPlan({ ...row, said_no_decision: "honor" }, since, now);
  check("import: 'honor' turns email off, dated now", honor.honored && honor.patch.email_opt_in === false && honor.patch.email_opt_in_changed_at === now);
  const chose = rules.fillPlan({ ...row, said_no_decision: "honor" }, { ...since, email_opt_in_changed_at: "2026-09-25T00:00:00Z" }, now);
  check("import: 'honor' never overrides a choice the member made themselves", !chose.honored && chose.keptTheirChoice && !("email_opt_in" in chose.patch));
  const yesRow = { ...by.get("9001"), imported_member_id: null, erased_at: null };
  const yesPlan = rules.fillPlan(yesRow, members.find((m) => m.id === "m-linked"), now);
  check("import: a yes never changes an existing member's email setting", !("email_opt_in" in yesPlan.patch) && !("indy_user_id" in yesPlan.patch));
}

// ---------- said no on Indy ----------
check("said no: flagged when opted in only by the old default", by.get("1").said_no_review === true && by.get("1").said_no_decision === "pending");
check("said no: not flagged for a yes", by.get("2").said_no_review === false && by.get("2").said_no_decision === null);
check("said no: not flagged when the member chose themselves", !rules.saidNoReview({ said_yes: false }, { email_opt_in: true, email_opt_in_changed_at: "2026-09-01T00:00:00Z" }));
check("said no: not flagged when email is already off", !rules.saidNoReview({ said_yes: false }, { email_opt_in: false, email_opt_in_changed_at: null }));
check("said no: new members aren't flagged (their answer is used as is)", by.get("11").said_no_review === false);
{
  const base = { decision: "import", import_as: "fill", imported_member_id: null, erased_at: null, said_no_review: true };
  check("ready: a said-no waiting for Honor or Leave is held back", !rules.readyToImport({ ...base, said_no_decision: "pending" }));
  check("ready: once picked it goes", rules.readyToImport({ ...base, said_no_decision: "honor" }) && rules.readyToImport({ ...base, said_no_decision: "leave" }));
  check("ready: review, skip and imported rows never go", !rules.readyToImport({ ...base, said_no_review: false, decision: "review" }) && !rules.readyToImport({ ...base, said_no_review: false, decision: "skip" }) && !rules.readyToImport({ ...base, said_no_review: false, imported_member_id: "x" }));
}

// ---------- a new member ----------
{
  const row = { ...by.get("11"), imported_member_id: null, erased_at: null };
  const m = rules.newMemberRow(row, "2026-10-01T15:00:00.000Z");
  check("new member: a free Insider with no points", m.tier === "Insiders" && m.points === 0 && m.name === "Kai Lark");
  check("new member: email on or off as they answered, dated when they answered", m.email_opt_in === false && m.email_opt_in_changed_at === row.indy_created_at && !!row.indy_created_at);
  check("new member: carries the Indy link and birthday, no Indy points", m.indy_user_id === "11" && m.birthday === "2000-12-24" && !("indy_points" in m));
  check("consent: yes and no map to the marketing sources", rules.indyConsentSource(true) === "indy_yes" && rules.indyConsentSource(false) === "indy_no");
  check("consent: only replaces nothing or 'unknown'", rules.takesIndyConsent(undefined) && rules.takesIndyConsent("unknown") && !rules.takesIndyConsent("join_form"));
}

// ---------- re-runs ----------
{
  const again = rules.classifyIndy(people, members);
  check("re-run: the same input sorts the same way", same(again, sortedRows));
  const membersById = new Map(members.map((m) => [m.id, m]));
  const fresh3 = by.get("3");
  const untouched = { ...fresh3, classification: "conflict", decision: "review", decided_by: null, imported_member_id: null, erased_at: null };
  check("re-run: an undecided row is sorted afresh", rules.mergeIndyRow(fresh3, untouched, membersById) === fresh3);
  const decided = { ...untouched, decision: "import", import_as: "fill", target_member_id: "m-a", decided_by: "emp-1", said_no_decision: null };
  const kept = rules.mergeIndyRow(fresh3, decided, membersById);
  check("re-run: a decided row keeps its decision and pick", kept.decision === "import" && kept.import_as === "fill" && kept.target_member_id === "m-a" && kept.classification === "conflict");
  check("re-run: a decided row's fills are worked out against the member now", same(kept.planned_fills, rules.plannedFills(fresh3, membersById.get("m-a"))));
  check("re-run: an imported row is left alone", rules.mergeIndyRow(fresh3, { ...decided, imported_member_id: "m-a" }, membersById) === null);
  check("re-run: a removed row is left alone", rules.mergeIndyRow(fresh3, { ...untouched, erased_at: "2026-09-30T00:00:00Z" }, membersById) === null);
  const saidNoKept = rules.mergeIndyRow(by.get("1"), { ...by.get("1"), decided_by: "emp-1", said_no_decision: "honor", imported_member_id: null, erased_at: null }, membersById);
  check("re-run: an Honor pick survives", saidNoKept.said_no_decision === "honor" && saidNoKept.said_no_review);
  // After an import, members carry their Indy ids: a re-load finds them linked.
  const afterImport = members.map((m) => (m.id === "m-email" ? { ...m, indy_user_id: "1", name: "Blake Fenn", birthday: "2000-10-10" } : m));
  const reloaded = rules.classifyIndy(people, afterImport).find((r) => r.indy_user_id === "1");
  check("re-run: after import the member is found by link, with nothing left to fill", reloaded.classification === "fill" && reloaded.reasons.includes("already linked to this Indy account") && reloaded.planned_fills.length === 0);
}

// ---------- the loader, offline ----------
{
  const dir = mkdtempSync(join(tmpdir(), "indy-check-"));
  try {
    const cols = [...rules.INDY_COLUMNS, "address"];
    const quote = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const csvRows = [
      indyRow({ id: "1", first_name: "BLAKE", last_name: "FENN", email: "blake.fenn@quillmail.net", phone: "417-555-0110", date_of_birth: "1980-10-10", yes: false }),
      indyRow({ id: "11", first_name: "Kai", last_name: "Lark", email: "kai@quillmail.net", phone: "417-555-0120" }),
      indyRow({ id: "12", email: "staff@quillmail.net", employee: "true" }),
      indyRow({ id: "3", email: "drew@quillmail.net", phone: "417-555-0112" }),
    ].map((r) => ({ ...r, address: "1 Main St, Joplin, MO" }));
    const csv = [cols.join(","), ...csvRows.map((r) => cols.map((c) => quote(r[c] ?? "")).join(","))].join("\n");
    writeFileSync(join(dir, "indy.csv"), csv);
    writeFileSync(join(dir, "members.json"), JSON.stringify(members));
    writeFileSync(join(dir, "staging.json"), JSON.stringify([{ indy_user_id: "11", classification: "new", reasons: [], decision: "skip", import_as: "new", said_no_decision: null, decided_by: "emp-1", imported_member_id: null, erased_at: null }]));
    const loader = fileURLToPath(new URL("./load-indy-accounts.mjs", import.meta.url));
    const run = (extra) => execFileSync(process.execPath, [loader, join(dir, "indy.csv"), ...extra], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const out = run(["--dry", "--members-file", join(dir, "members.json"), "--staging-file", join(dir, "staging.json")]);
    check("loader: reads the quoted CSV (4 accounts)", /4 Indy accounts/.test(out), out.split("\n")[0]);
    check("loader: prints counts per group", /groups: .*fill: 1/.test(out) && /conflict: 1/.test(out) && /skip: 1/.test(out), out.match(/groups:.*/)?.[0]);
    check("loader: prints the said-no count", /old default \(for Andrew to honor or leave\): 1/.test(out));
    check("loader: prints fills by field", /fills by field: .*birthday: 1/.test(out) && /name: 1/.test(out));
    check("loader: a hand-made decision is kept", /1 keep a decision made by hand/.test(out) && /decisions: .*skip: 2/.test(out));
    check("loader: dry run writes nothing", /Dry run: nothing was written/.test(out));
    const leaked = ["quillmail", "Blake", "BLAKE", "Kai", "Lark", "555-01", "Main St"].filter((s) => out.includes(s));
    check("loader: output has no names, emails, phones or addresses", leaked.length === 0, leaked.join(", "));
    let refused = false;
    try {
      run(["--members-file", join(dir, "members.json")]);
    } catch (e) {
      refused = e.status === 1;
    }
    check("loader: --members-file without --dry is refused", refused);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll Indy import checks passed");
process.exit(failures ? 1 : 0);
