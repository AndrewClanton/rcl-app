// The Indy import's rules, in one place: reading the export, cleaning up
// each field, sorting each person into fill / new / conflict / skip, and
// what an import may change on a member who's already here. Indy was the
// ticketing system before this app; its customer export is loaded into
// indy_accounts (supabase/migrations/20261001140000_indy_accounts.sql) by
// scripts/load-indy-accounts.mjs, reviewed at /admin/members/indy, and only
// copied into members when an admin presses Import there.
//
// No imports and no server code, so the loader, its offline checks
// (scripts/check-indy-import.mjs), the review screen and the import action
// all run this same file. (Node 23.6+ runs the .ts directly.)
//
// Email (Andrew's call, 9/30, reconfirmed 10/1): Indy's "no" answers are
// ignored. They told Indy, not us. Every new member from Indy joins with
// email on, whatever their four Indy switches said; their answer is kept
// only as information (said_yes, and consent source indy_yes / indy_no).
// What people told US still wins: nobody on our never-mail list
// (email_suppressions: unsubscribes, bounces, complaints) is added, and a
// member who's already here keeps the email setting they have with us.

export type IndyClass = "fill" | "new" | "conflict" | "skip";
export type IndyDecision = "import" | "skip" | "review";
export type IndyImportAs = "fill" | "new";
export type IndyFillField = "phone" | "birthday" | "name";

// The columns the loader needs; the rest of the export is ignored
// (addresses are never read).
export const INDY_COLUMNS = [
  "id",
  "type",
  "first_name",
  "last_name",
  "email",
  "membership_type.name",
  "created_at",
  "phone",
  "points_preloaded",
  "date_of_last_visit",
  "employee",
  "email_showtimes",
  "email_last_chance",
  "email_promotions",
  "email_newsletter",
  "date_of_birth",
] as const;

// Indy asked four email questions. Only a yes to all four counts as a yes
// (information only: it doesn't decide anyone's email here).
export const INDY_EMAIL_SWITCHES = ["email_showtimes", "email_last_chance", "email_promotions", "email_newsletter"] as const;

// Indy's everyday free plan. Anything else (Insiders+, Monthly Membership,
// Board Gamer...) was paid there and is noted, never carried over.
const FREE_PLAN = "royale insiders";

// A member as the loader and the import see them. Erased members are read
// too, only to recognise an Indy account whose person asked to be removed.
export interface IndyMember {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  indy_user_id: string | null;
  erased_at: string | null;
}

// One person from the export, cleaned up, before matching.
export interface IndyPerson {
  indy_user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  phone_digits: string | null;
  birthday: string | null;
  indy_created_at: string | null;
  indy_last_visit: string | null;
  indy_membership: string | null;
  indy_type: string | null;
  indy_points: number | null;
  said_yes: boolean;
  // Why this person can't be imported at all (staff, a test account, no way
  // to reach them). Empty for everyone else.
  skip: string[];
  // What the cleanup changed or noticed (a phone or birthday left off, a
  // mixed answer, a paid plan).
  notes: string[];
}

// A row of indy_accounts as the loader writes it.
export interface IndyStagingRow {
  indy_user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  phone_digits: string | null;
  birthday: string | null;
  indy_created_at: string | null;
  indy_last_visit: string | null;
  indy_membership: string | null;
  indy_type: string | null;
  indy_points: number | null;
  said_yes: boolean;
  classification: IndyClass;
  reasons: string[];
  email_member_id: string | null;
  phone_member_id: string | null;
  target_member_id: string | null;
  planned_fills: IndyFillField[];
  decision: IndyDecision;
  import_as: IndyImportAs | null;
}

// What's already in indy_accounts for a person, for a re-run.
export interface IndyExisting {
  indy_user_id: string;
  classification: IndyClass;
  reasons: string[] | null;
  email_member_id: string | null;
  phone_member_id: string | null;
  target_member_id: string | null;
  import_as: IndyImportAs | null;
  decision: IndyDecision;
  decided_by: string | null;
  imported_member_id: string | null;
  imported_at?: string | null;
  erased_at: string | null;
}

// Reasons the sort and the import give that other code looks for.
export const SAME_EMAIL_REASON = "another Indy account has the same email";
export const IMPORTED_EMAIL_REASON = "an Indy account with the same email is already in Members";
export const NEVER_MAIL_REASON = "address is on the never-mail list";

// ---------- the CSV ----------
// Quoted fields can hold commas, quotes ("") and line breaks (Indy's
// address columns do).
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
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
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// The export as one object per person, keyed by column name. ragged counts
// rows with more or fewer fields than the header (a stray quote shifts every
// column after it), so the loader can stop instead of reading the wrong ones.
export function readIndyCsv(text: string): { columns: string[]; records: Record<string, string>[]; missing: string[]; ragged: number } {
  const [head = [], ...body] = parseCsv(text);
  const columns = head.map((h) => h.trim());
  const records = body.map((r) => Object.fromEntries(columns.map((c, i) => [c, (r[i] ?? "").trim()])));
  const missing = INDY_COLUMNS.filter((c) => !columns.includes(c));
  const ragged = body.filter((r) => r.length !== columns.length).length;
  return { columns, records, missing, ragged };
}

// The yes/no columns are read as the literal "true" (any case); anything
// else counts as no. Counts, per column, the values that are neither true,
// false nor blank (1/0, yes/no...), which would silently turn every answer
// into a no and stop staff accounts being skipped.
export function oddIndyValues(records: Record<string, string>[]): Record<string, number> {
  const odd: Record<string, number> = {};
  for (const col of ["employee", ...INDY_EMAIL_SWITCHES]) {
    const n = records.filter((r) => !["true", "false", ""].includes(lc(r[col]))).length;
    if (n) odd[col] = n;
  }
  return odd;
}

// ---------- cleaning up one field ----------
const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const isBlank = (s: string | null | undefined) => !s || !s.trim();

// Typed into a name box to get past it, not a name.
const PLACEHOLDER_NAMES = new Set(["n/a", "none", "null", "undefined", "unknown", "-", "."]);

// Trimmed, single-spaced, and Title Cased when it was typed ALL CAPS or all
// lowercase ("MARY-JANE o'neil" -> "Mary-Jane O'Neil"). A mixed-case name
// ("McDonald", "DeAngelo") is left as typed. Null when there's no name.
export function cleanName(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s || s.toLowerCase() === s.toUpperCase() || s.includes("@") || PLACEHOLDER_NAMES.has(s.toLowerCase())) return null;
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
  let out = "";
  let start = true;
  for (const ch of s.toLowerCase()) {
    out += start ? ch.toUpperCase() : ch;
    start = ch === " " || ch === "-" || ch === "'" || ch === "’";
  }
  return out;
}

export function fullName(first: string | null | undefined, last: string | null | undefined): string | null {
  return [first, last].filter((s) => !isBlank(s)).join(" ").trim() || null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/;
// Typed in to get past a required field, not a way to reach anyone.
const PLACEHOLDER_EMAIL_USERS = new Set(["noemail", "no-email", "no_email", "nomail", "none", "na", "n/a", "noreply", "no-reply", "donotreply"]);

export function cleanEmail(raw: string | null | undefined): { email: string | null; note?: string } {
  const e = lc(raw);
  if (!e) return { email: null };
  if (!EMAIL_RE.test(e)) return { email: null, note: "email not usable (left off)" };
  if (PLACEHOLDER_EMAIL_USERS.has(e.split("@")[0])) return { email: null, note: "placeholder email (left off)" };
  return { email: e };
}

// Digits only, a leading 1 dropped, and exactly 10 digits, shown the way
// the rest of the app stores phones: "(417) 555-0142".
export function cleanPhone(raw: string | null | undefined): { digits: string | null; formatted: string | null; note?: string } {
  let d = (raw ?? "").replace(/\D/g, "");
  if (!d) return { digits: null, formatted: null };
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  if (d.length !== 10) return { digits: null, formatted: null, note: "phone not 10 digits (left off)" };
  // No US area code starts with 0 or 1.
  if (/^(\d)\1{9}$/.test(d) || d[0] === "0" || d[0] === "1") return { digits: null, formatted: null, note: "phone looks made up (left off)" };
  return { digits: d, formatted: `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` };
}

// A member's phone as 10 digits, for matching ("+1 417..." counts).
export function phoneKey(phone: string | null | undefined): string | null {
  let d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  return d.length === 10 ? d : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

// Birthdays are stored as the month and day in the year 2000 (a leap year,
// so Feb 29 fits); the birth year is never kept. Same rule as birthdayValue
// in src/lib/visits.ts (scripts/check-indy-import.mjs checks they agree).
export function birthdayValue(month: number, day: number): string | null {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return null;
  const value = `2000-${pad(month)}-${pad(day)}`;
  return new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value ? value : null;
}

// Indy's date_of_birth ("1987-03-14") as a stored birthday. Left off when it
// isn't a real date, is a placeholder (before 1900, or 1900-01-01), is in
// the future, or falls on or after the day they joined Indy (the form's
// default, not a birthday).
export function cleanBirthday(raw: string | null | undefined, joinedOn: string | null, today: string): { birthday: string | null; note?: string } {
  const t = (raw ?? "").trim();
  if (!t) return { birthday: null };
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (!m) return { birthday: null, note: "birthday not a real date (left off)" };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const iso = `${m[1]}-${pad(mo)}-${pad(d)}`;
  const real = mo >= 1 && mo <= 12 && d >= 1 && new Date(Date.UTC(y, mo - 1, d)).toISOString().slice(0, 10) === iso;
  if (!real) return { birthday: null, note: "birthday not a real date (left off)" };
  if (y < 1900 || iso === "1900-01-01" || iso > today || (joinedOn && iso >= joinedOn)) return { birthday: null, note: "birthday looks like a placeholder (left off)" };
  return { birthday: birthdayValue(mo, d) };
}

// Indy's timestamps ("2024-06-01 19:42:10") are Central wall-clock time
// (sign-ups in the export peak mid-afternoon to evening on that reading).
export function centralToIso(wall: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec((wall ?? "").trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  const guess = Date.UTC(y, mo, d, h, mi, s);
  if (!Number.isFinite(guess)) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value])
  );
  const asCentral = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(guess + (guess - asCentral)).toISOString();
}

// Today's date in Central time, "YYYY-MM-DD".
export function centralToday(now: Date = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}`;
}

// ---------- test and junk accounts ----------
const TEST_NAMES = new Set(["test", "testing", "tester", "asdf", "qwerty", "fake", "dummy", "xxx"]);
const TEST_DOMAINS = new Set(["example.com", "example.org", "example.net", "test.com", "test.org", "mailinator.com"]);

export function looksLikeTest(email: string | null, first: string | null, last: string | null): boolean {
  if ([first, last].some((n) => n && TEST_NAMES.has(lc(n)))) return true;
  if (!email) return false;
  const [user, domain = ""] = email.split("@");
  if (TEST_DOMAINS.has(domain) || /\.(test|invalid|example|localhost)$/.test(domain)) return true;
  return /^test\d*$/.test(user) || TEST_NAMES.has(user);
}

// ---------- one person from the export ----------
export function cleanIndyRecord(r: Record<string, string>, today: string): IndyPerson {
  const notes: string[] = [];
  const skip: string[] = [];
  const email = cleanEmail(r.email);
  if (email.note) notes.push(email.note);
  const phone = cleanPhone(r.phone);
  if (phone.note) notes.push(phone.note);
  const createdAt = centralToIso(r.created_at);
  const joinedOn = /^\d{4}-\d{2}-\d{2}/.test(r.created_at ?? "") ? r.created_at.slice(0, 10) : null;
  const birthday = cleanBirthday(r.date_of_birth, joinedOn, today);
  if (birthday.note) notes.push(birthday.note);
  const answers = INDY_EMAIL_SWITCHES.map((k) => lc(r[k]) === "true");
  const saidYes = answers.every(Boolean);
  if (!saidYes && answers.some(Boolean)) notes.push("mixed email answers on Indy (counted as no)");
  const first = cleanName(r.first_name);
  const last = cleanName(r.last_name);
  const membership = (r["membership_type.name"] ?? "").trim() || null;
  const plan = lc(membership);

  if (lc(r.employee) === "true") skip.push("Indy staff account");
  if (plan === "staff") skip.push("Staff membership on Indy");
  else if (plan === "owner") skip.push("Owner membership on Indy");
  else if (membership && plan !== FREE_PLAN) notes.push("paid Indy plan (not carried over)");
  if (looksLikeTest(email.email, first, last)) skip.push("looks like a test account");
  if (!email.email && !phone.digits) skip.push("no email or phone");

  const lastVisit = /^\d{4}-\d{2}-\d{2}$/.test(r.date_of_last_visit ?? "") ? r.date_of_last_visit : null;
  const points = Number(r.points_preloaded);
  return {
    indy_user_id: (r.id ?? "").trim(),
    email: email.email,
    first_name: first,
    last_name: last,
    phone: phone.formatted,
    phone_digits: phone.digits,
    birthday: birthday.birthday,
    indy_created_at: createdAt,
    indy_last_visit: lastVisit,
    indy_membership: membership,
    indy_type: (r.type ?? "").trim() || null,
    indy_points: (r.points_preloaded ?? "").trim() !== "" && Number.isFinite(points) ? points : null,
    said_yes: saidYes,
    skip,
    notes,
  };
}

// ---------- what an import may change on a member ----------
// The old-site import named people with no name after their email
// ("pat.smith" for pat.smith@example.com). That, or no name at all, is the
// only name an Indy name may replace.
export function isPlaceholderName(name: string | null | undefined, email: string | null | undefined): boolean {
  if (isBlank(name)) return true;
  const user = lc(email).split("@")[0];
  return !!user && lc(name) === user;
}

// The fields an import would fill in: only ones the member has empty, and
// never the email.
export function plannedFills(
  p: Pick<IndyPerson, "phone" | "birthday" | "first_name" | "last_name">,
  m: Pick<IndyMember, "name" | "email" | "phone" | "birthday">
): IndyFillField[] {
  const fills: IndyFillField[] = [];
  if (p.phone && isBlank(m.phone)) fills.push("phone");
  if (p.birthday && !m.birthday) fills.push("birthday");
  if (fullName(p.first_name, p.last_name) && isPlaceholderName(m.name, m.email)) fills.push("name");
  return fills;
}

// ---------- sorting everyone ----------
const MATCH_REASONS = new Set(["matched by email", "matched by phone (member has no email)", "no member matches"]);

// fill: matched to exactly one member, by email (or by phone where that
//   member has no email). Only their empty fields get filled.
// new: no member matches and they have an email: a new free Insider.
// conflict: the matches disagree or can't be trusted. A person decides.
// skip: staff, test accounts, no way to reach them, and anyone removed at
//   their request.
// importedEmails: on a re-load, the emails of Indy accounts already
// imported (email -> that account's Indy id). One imported by phone into a
// member with no email leaves its email on no member, so another account
// with that email would otherwise look new.
export function classifyIndy(people: IndyPerson[], members: IndyMember[], importedEmails: Map<string, string> = new Map()): IndyStagingRow[] {
  const live = members.filter((m) => !m.erased_at);
  const byEmail = new Map<string, IndyMember>();
  const byPhone = new Map<string, IndyMember[]>();
  const byIndy = new Map<string, IndyMember>();
  for (const m of live) {
    if (m.email && !isBlank(m.email)) byEmail.set(lc(m.email), m);
    const key = phoneKey(m.phone);
    if (key) byPhone.set(key, [...(byPhone.get(key) ?? []), m]);
    if (m.indy_user_id) byIndy.set(m.indy_user_id, m);
  }
  // An erased member keeps its indy_user_id (the erase blanks contact
  // details, not links), so a re-pull can't bring them back. Their email is
  // gone, though, and member_erasures only records who and when (member id,
  // dates, counts), so someone removed before they were ever linked to Indy
  // can't be recognised here. The staging row's own erased_at covers anyone
  // removed after the load (see the trigger in the migration).
  const erasedIndy = new Set(members.filter((m) => m.erased_at && m.indy_user_id).map((m) => m.indy_user_id as string));

  const rows: IndyStagingRow[] = people.map((p) => {
    const base = {
      indy_user_id: p.indy_user_id,
      email: p.email,
      first_name: p.first_name,
      last_name: p.last_name,
      phone: p.phone,
      phone_digits: p.phone_digits,
      birthday: p.birthday,
      indy_created_at: p.indy_created_at,
      indy_last_visit: p.indy_last_visit,
      indy_membership: p.indy_membership,
      indy_type: p.indy_type,
      indy_points: p.indy_points,
      said_yes: p.said_yes,
    };
    const E = p.email ? byEmail.get(p.email) : undefined;
    const P = p.phone_digits ? (byPhone.get(p.phone_digits) ?? []) : [];
    const matches = { email_member_id: E?.id ?? null, phone_member_id: P.length === 1 ? P[0].id : null };
    const sorted = (classification: IndyClass, reasons: string[], target: IndyMember | null = null): IndyStagingRow => ({
      ...base,
      ...matches,
      classification,
      reasons: [...reasons, ...p.notes],
      target_member_id: target?.id ?? null,
      planned_fills: target ? plannedFills(p, target) : [],
      decision: classification === "skip" ? "skip" : classification === "conflict" ? "review" : "import",
      import_as: classification === "fill" ? "fill" : classification === "new" ? "new" : null,
    });

    if (erasedIndy.has(p.indy_user_id)) {
      // Kept only as a skipped, blanked row, like the erase trigger leaves one.
      const blank = { email: null, first_name: null, last_name: null, phone: null, phone_digits: null, birthday: null, indy_last_visit: null, indy_points: null };
      return { ...sorted("skip", ["removed at their request"]), ...blank, reasons: ["removed at their request"], email_member_id: null, phone_member_id: null };
    }
    if (p.skip.length) return sorted("skip", p.skip);
    const linked = byIndy.get(p.indy_user_id);
    if (linked) return sorted("fill", ["already linked to this Indy account"], linked);
    const otherIndy = (m: IndyMember) => !!m.indy_user_id && m.indy_user_id !== p.indy_user_id;
    if (E) {
      if (P.length && !P.some((m) => m.id === E.id)) return sorted("conflict", [P.length > 1 ? "email matches one member, phone matches others" : "email and phone match different members"]);
      if (otherIndy(E)) return sorted("conflict", ["that member is linked to a different Indy account"]);
      return sorted("fill", ["matched by email"], E);
    }
    if (P.length > 1) return sorted("conflict", ["phone matches more than one member"]);
    if (P.length === 1) {
      const M = P[0];
      if (otherIndy(M)) return sorted("conflict", ["that member is linked to a different Indy account"]);
      if (isBlank(M.email)) return sorted("fill", ["matched by phone (member has no email)"], M);
      return sorted("conflict", [p.email ? "phone matches a member with a different email" : "phone matches a member with an email; this account has none"]);
    }
    if (p.email) return sorted("new", ["no member matches"]);
    return sorted("skip", ["no email, and no member has that phone"]);
  });

  // Two Indy accounts landing on the same member, or two with the same
  // email that no member has: nobody can tell which is right without
  // looking. The email case spans fill, new and conflict: one account filling
  // a kiosk-made member (no email) by phone while another with the same email
  // is added as new would give one person two members, and the email's
  // unique index can't catch it because the kiosk member has no email. (An
  // email a member already has is safe: every account with it matches that
  // member, so two fills of it are the same-member case, and it can't be
  // added as new.)
  const byTarget = new Map<string, IndyStagingRow[]>();
  for (const r of rows) {
    if (r.classification === "fill" && r.target_member_id) byTarget.set(r.target_member_id, [...(byTarget.get(r.target_member_id) ?? []), r]);
  }
  const toConflict = (group: IndyStagingRow[], reason: string, min = 2) => {
    if (group.length < min) return;
    for (const r of group) {
      r.classification = "conflict";
      r.reasons = [reason, ...r.reasons.filter((x) => !MATCH_REASONS.has(x))];
      r.target_member_id = null;
      r.planned_fills = [];
      r.decision = "review";
      r.import_as = null;
    }
  };
  // (A member already linked to one Indy account can't be a second one's
  // fill: that's a conflict above, so these groups never include it.)
  for (const group of byTarget.values()) toConflict(group, "another Indy account matches the same member");
  const byFreeEmail = new Map<string, IndyStagingRow[]>();
  for (const r of rows) {
    if (r.classification !== "skip" && r.email && !r.email_member_id) byFreeEmail.set(r.email, [...(byFreeEmail.get(r.email) ?? []), r]);
  }
  for (const group of byFreeEmail.values()) toConflict(group, SAME_EMAIL_REASON);
  for (const [email, group] of byFreeEmail) {
    const importedAs = importedEmails.get(email);
    if (importedAs) toConflict(group.filter((r) => r.indy_user_id !== importedAs), IMPORTED_EMAIL_REASON, 1);
  }
  return rows;
}

// ---------- a re-run ----------
// Rows nobody has touched are sorted afresh. A row someone decided keeps its
// sort and decision (its Indy details are refreshed, and what it would fill
// is worked out again against the member as they are now). A row already
// imported, or erased, is left alone: null means "don't write it".
export function mergeIndyRow(fresh: IndyStagingRow, existing: IndyExisting | undefined, membersById: Map<string, IndyMember>): IndyStagingRow | null {
  if (!existing) return fresh;
  if (existing.erased_at || existing.imported_member_id || existing.imported_at) return null;
  if (!existing.decided_by) return fresh;
  const target = existing.target_member_id ? membersById.get(existing.target_member_id) : undefined;
  const liveTarget = target && !target.erased_at ? target : null;
  return {
    ...fresh,
    classification: existing.classification,
    reasons: existing.reasons ?? [],
    email_member_id: existing.email_member_id,
    phone_member_id: existing.phone_member_id,
    target_member_id: existing.target_member_id,
    import_as: existing.import_as,
    decision: existing.decision,
    planned_fills: liveTarget ? plannedFills(fresh, liveTarget) : [],
  };
}

// ---------- the counts the loader prints ----------
export function summarizeIndy(rows: IndyStagingRow[]) {
  const tally = (keys: string[]) => keys.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
  return {
    total: rows.length,
    byClass: tally(rows.map((r) => r.classification)),
    byReason: tally(rows.flatMap((r) => r.reasons)),
    decisions: tally(rows.map((r) => r.decision)),
    saidYes: rows.filter((r) => r.said_yes).length,
    saidNo: rows.filter((r) => !r.said_yes).length,
    fillsByField: tally(rows.filter((r) => r.import_as === "fill").flatMap((r) => r.planned_fills)),
    newSaidYes: rows.filter((r) => r.classification === "new" && r.said_yes).length,
    newSaidNo: rows.filter((r) => r.classification === "new" && !r.said_yes).length,
  };
}

// ---------- the import ----------
// The staging row as the import reads it.
export type IndyImportRow = Pick<
  IndyStagingRow,
  | "indy_user_id"
  | "email"
  | "first_name"
  | "last_name"
  | "phone"
  | "birthday"
  | "indy_created_at"
  | "said_yes"
  | "decision"
  | "import_as"
  | "target_member_id"
  | "classification"
> & { decided_by: string | null; imported_member_id: string | null; imported_at: string | null; erased_at: string | null };

type ReadyFields = Pick<IndyImportRow, "decision" | "import_as" | "imported_member_id" | "erased_at"> & {
  decided_by?: string | null;
  imported_at?: string | null;
};

// Ready for the Import button: set to import, not in yet, and, for a new
// member, approved by a person (Approve, Approve all new, or Add as new on a
// conflict). The loader's automatic default never adds anyone by itself. A
// fill is ready on the default: it only fills a matched member's empty
// details. (imported_at as well as imported_member_id: the member link is
// cleared if that member is ever deleted, and the row must not go in twice.)
export function readyToImport(r: ReadyFields): boolean {
  if (r.decision !== "import" || !r.import_as || r.imported_member_id || r.imported_at || r.erased_at) return false;
  return r.import_as !== "new" || !!r.decided_by;
}

// The same as a PostgREST filter, for .or(): the database narrows to these
// rows, then readyToImport checks each one. Used with decision = 'import',
// import_as not null, imported_member_id null, imported_at null and
// erased_at null (scripts/check-indy-import.mjs checks they agree).
export const READY_FILTER = "import_as.eq.fill,decided_by.not.is.null";

// What pressing Import would do right now, from the rows not in yet: the
// review screen's dry run. Fills and links are as of the last load or pick
// (the import works them out again and never overwrites). Every new member
// joins with email on, whatever they said on Indy; an address on the
// never-mail list is checked at Import and goes back to Conflict instead.
export interface IndyImportPreview {
  ready: number;
  newMembers: number; // all with email on
  fills: number; // members who get a detail filled in
  links: number; // members only linked, nothing to fill
  newWaiting: number; // new, still waiting for a person to approve
}
export type IndyPreviewRow = ReadyFields & Pick<IndyStagingRow, "planned_fills">;

export function importPreview(rows: IndyPreviewRow[]): IndyImportPreview {
  const p: IndyImportPreview = { ready: 0, newMembers: 0, fills: 0, links: 0, newWaiting: 0 };
  for (const r of rows) {
    if (!readyToImport(r)) {
      if (r.import_as === "new" && !r.decided_by && readyToImport({ ...r, decided_by: "anyone" })) p.newWaiting++;
      continue;
    }
    p.ready++;
    if (r.import_as === "new") p.newMembers++;
    else if ((r.planned_fills ?? []).length) p.fills++;
    else p.links++;
  }
  return p;
}

export interface IndyFillPlan {
  patch: Record<string, string>;
  filled: IndyFillField[];
  // Why this row can't go in now (it goes back to review with this reason).
  problem: string | null;
}

// What pressing Import does to a member who's already here, worked out
// against the member as they are right now: fill only what's still empty,
// never the email, and link the Indy account if nothing's linked. Their
// email setting is never touched, whatever they said on Indy: on stays on,
// and off (an opt-out they gave us) stays off.
export function fillPlan(row: IndyImportRow, member: IndyMember | null | undefined): IndyFillPlan {
  const none = (problem: string): IndyFillPlan => ({ patch: {}, filled: [], problem });
  if (!member) return none("the matched member is gone");
  if (member.erased_at) return none("the matched member was removed");
  if (member.indy_user_id && member.indy_user_id !== row.indy_user_id) return none("that member is linked to a different Indy account");
  const filled = plannedFills(row, member);
  const patch: Record<string, string> = {};
  if (filled.includes("phone") && row.phone) patch.phone = row.phone;
  if (filled.includes("birthday") && row.birthday) patch.birthday = row.birthday;
  const name = fullName(row.first_name, row.last_name);
  if (filled.includes("name") && name) patch.name = name;
  if (!member.indy_user_id) patch.indy_user_id = row.indy_user_id;
  return { patch, filled, problem: null };
}

// A new free Insider from an approved Indy account, with email on whatever
// they answered on Indy (the import has already checked the address isn't
// on our never-mail list). A yes on Indy is dated as their choice; a no
// leaves no date, so they read as on by default, like everyone else.
export function newMemberRow(row: IndyImportRow, now: string) {
  const email = row.email as string;
  return {
    name: fullName(row.first_name, row.last_name) ?? email.split("@")[0],
    email,
    phone: row.phone,
    birthday: row.birthday,
    tier: "Insiders",
    points: 0,
    indy_user_id: row.indy_user_id,
    imported_at: now,
    email_opt_in: true,
    email_opt_in_changed_at: row.said_yes ? (row.indy_created_at ?? now) : null,
  };
}

// For the email-marketing tables (member_email_prefs.consent_source): what
// they said on Indy, kept as information (indy_no puts someone at the back
// of the warm-up order). It only goes where nothing better is recorded.
export function indyConsentSource(saidYes: boolean): "indy_yes" | "indy_no" {
  return saidYes ? "indy_yes" : "indy_no";
}
export function takesIndyConsent(existingSource: string | null | undefined): boolean {
  return !existingSource || existingSource === "unknown";
}
