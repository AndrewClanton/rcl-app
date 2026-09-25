// Loads the old site's accounts into legacy_accounts, sorted into paying /
// likely_real / review / bot. Input is the export pulled from the old
// Django admin plus its membership CSV (both kept outside the repo -- they
// hold ~13,000 people's personal info).
//
// Safe to re-run (e.g. a final catch-up pull on switch-over day): rows are
// upserted by old user id, and a decision staff already made by hand at
// /admin/members/old-site is never overwritten, nor is an import link.
//
// Usage: node scripts/load-legacy-accounts.mjs <export.json> <membership.csv> [--dry]
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
const [exportPath, csvPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const DRY = process.argv.includes("--dry");
if (!exportPath || !csvPath) {
  console.error("Usage: node scripts/load-legacy-accounts.mjs <export.json> <membership.csv> [--dry]");
  process.exit(1);
}

const data = JSON.parse(readFileSync(exportPath, "utf8"));
const csvRows = readFileSync(csvPath, "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split(","));

// ---- Joins ------------------------------------------------------------------
const lc = (s) => (s ?? "").trim().toLowerCase();
const membershipById = new Map(data.memberships.map((m) => [m._id, m]));
const membershipByUser = new Map();
for (const [membershipId, userId, , duration, isPlus] of csvRows) {
  const listed = membershipById.get(membershipId) ?? {};
  membershipByUser.set(userId, {
    type: listed["Membership type"] || null,
    duration: duration || listed["Duration"] || null,
    isPlus: isPlus === "1",
    status: listed["Membership Status"] || null,
  });
}
// Profiles and subscriptions name their user by its display string, which is
// the username (itself the email for almost everyone).
const phoneByUsername = new Map(data.profiles.map((p) => [lc(p.User), (p.Phone ?? "").trim()]));
const subscriptionByUsername = new Map(data.subscriptions.map((s) => [lc(s.User), s]));
const emailCounts = new Map();
for (const u of data.users) {
  const e = lc(u["Email address"]);
  if (e) emailCounts.set(e, (emailCounts.get(e) ?? 0) + 1);
}

// ---- Signals ----------------------------------------------------------------
const NAME_PREFIXES = /^(Mc|Mac|De|Da|Di|Du|La|Le|Lo|Van|Von|St|O'|D')/;
const vowelRatio = (s) => (s.match(/[aeiouy]/gi) || []).length / Math.max(1, s.length);
// Bots here generate names like "kXqPzvTrWn": several lower-to-upper case
// flips, or one flip in a long string that isn't a real name prefix
// (McDonald, DeAngelo, LaToya are fine).
function looksRandom(name) {
  const flips = (name.match(/[a-z][A-Z]/g) || []).length;
  if (flips >= 2) return true;
  if (flips === 1 && name.length >= 8 && !NAME_PREFIXES.test(name)) return true;
  return /[bcdfghjklmnpqrstvwxz]{5,}/i.test(name) && name.length >= 8;
}
function looksReal(name) {
  return /^[A-Z][a-zA-Z'\-]{1,13}$/.test(name) && !looksRandom(name) && vowelRatio(name) >= 0.2;
}
// Joplin's area code plus the rest of Missouri and the neighboring
// KS / OK / AR codes a regular might plausibly have.
const REGIONAL = new Set([
  "417", "573", "660", "816", "314", "636", // Missouri
  "620", "316", "913", // Kansas
  "918", "539", // NE Oklahoma
  "479", "501", "870", // Arkansas
]);
function phoneInfo(raw) {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  if (d.length !== 10) return { formatted: raw?.trim() || null, area: null };
  return { formatted: `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`, area: d.slice(0, 3) };
}

// ---- Django admin dates ("Sept. 22, 2026, 7:28 a.m."), in Central time -----
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function centralToIso(y, mo, d, h, mi) {
  // Find the UTC instant whose Chicago wall-clock reads y-mo-d h:mi.
  const guess = Date.UTC(y, mo, d, h, mi);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value])
  );
  const asCentral = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess + (guess - asCentral)).toISOString();
}
function parseDjangoDate(s) {
  const m = (s ?? "").match(/^([A-Za-z]+)\.? (\d{1,2}), (\d{4}),? (?:(\d{1,2})(?::(\d{2}))? ([ap])\.m\.|(noon)|(midnight))$/);
  if (!m) return null;
  const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (mo === undefined) return null;
  let h = 0, mi = 0;
  if (m[7]) h = 12;
  else if (m[8]) h = 0;
  else {
    h = +m[4] % 12 + (m[6] === "p" ? 12 : 0);
    mi = m[5] ? +m[5] : 0;
  }
  return centralToIso(+m[3], mo, +m[2], h, mi);
}

// ---- Classify -----------------------------------------------------------------
const emailRe = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const rows = [];
let unparsedDates = 0;
for (const u of data.users) {
  const legacyId = Number(u._id);
  const email = (u["Email address"] ?? "").trim();
  const username = (u.Username ?? "").trim();
  const first = (u["First name"] ?? "").trim();
  const last = (u["Last name"] ?? "").trim();
  const membership = membershipByUser.get(u._id) ?? {};
  const sub = subscriptionByUsername.get(lc(username)) ?? subscriptionByUsername.get(lc(email)) ?? null;
  const phone = phoneInfo(phoneByUsername.get(lc(username)) ?? phoneByUsername.get(lc(email)));
  const joinedAt = parseDjangoDate(u["Date joined"]);
  if (!joinedAt) unparsedDates++;

  const reasons = [];
  const paidPlan = membership.duration === "monthly" || membership.duration === "annual";
  const paying = !!sub || membership.isPlus || paidPlan;
  if (sub) reasons.push("had an old-site subscription");
  if (membership.isPlus) reasons.push("flagged Plus on old site");
  if (paidPlan) reasons.push(`${membership.duration} plan on old site`);
  const random = looksRandom(first) || looksRandom(last);
  const real = looksReal(first) && looksReal(last);
  if (random) reasons.push("random-looking name");
  else if (real) reasons.push("real-looking name");
  else reasons.push("name doesn't fit either pattern");
  const regional = phone.area && REGIONAL.has(phone.area);
  reasons.push(!phone.area ? "no phone" : regional ? `local/regional phone (${phone.area})` : "out-of-area phone");
  const validEmail = emailRe.test(email);
  if (!validEmail) reasons.push("no usable email");
  const sharedEmail = validEmail && (emailCounts.get(lc(email)) ?? 0) > 1;
  if (sharedEmail) reasons.push("email shared with another old account");

  // A regional phone doesn't rescue a random-looking name: among those, the
  // "regional" area codes come out evenly spread (417 no more common than
  // 501), which is what randomly generated numbers look like -- real
  // members cluster heavily in 417.
  let classification;
  if (!validEmail || sharedEmail) classification = "review";
  else if (paying) classification = random ? "review" : "paying";
  else if (random) classification = "bot";
  else if (real) classification = "likely_real";
  else classification = "review";

  rows.push({
    legacy_user_id: legacyId,
    email: email || null,
    username: username || null,
    first_name: first || null,
    last_name: last || null,
    phone: phone.formatted,
    joined_at: joinedAt,
    active: u.Active === "True",
    membership_type: membership.type ?? null,
    membership_duration: membership.duration ?? null,
    membership_is_plus: membership.isPlus ?? false,
    membership_status: membership.status ?? null,
    subscription_type: sub?.["Subscription type"] && sub["Subscription type"] !== "-" ? sub["Subscription type"] : null,
    subscription_billing_status: sub?.["Billing status"] ?? null,
    subscription_fortis_id: sub?.["Fortis sub id"] && sub["Fortis sub id"] !== "-" ? sub["Fortis sub id"] : null,
    subscription_cancelled_at: sub?.["Cancelled at"] && sub["Cancelled at"] !== "-" ? sub["Cancelled at"] : null,
    classification,
    reasons,
    defaultDecision: classification === "bot" ? "skip" : classification === "review" ? "review" : "import",
  });
}

const tally = (key) => rows.reduce((m, r) => ((m[r[key]] = (m[r[key]] ?? 0) + 1), m), {});
console.log(`${rows.length} old accounts; join dates unparsed: ${unparsedDates}`);
console.log("groups:", tally("classification"));
const reviewWhy = {};
for (const r of rows.filter((r) => r.classification === "review")) {
  const key = r.reasons.filter((x) => !/phone|^had|^flagged|plan on/.test(x) || /local/.test(x)).join(" + ");
  reviewWhy[key] = (reviewWhy[key] ?? 0) + 1;
}
console.log("why 'review':", reviewWhy);
if (DRY) process.exit(0);

// ---- Upsert, preserving staff decisions and import links ----------------------
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const decidedByHand = new Set();
for (let from = 0; ; from += 1000) {
  const { data: page, error } = await supabase.from("legacy_accounts").select("legacy_user_id").not("decided_by", "is", null).range(from, from + 999);
  if (error) throw error;
  page.forEach((r) => decidedByHand.add(r.legacy_user_id));
  if (page.length < 1000) break;
}

// People who asked for their info to be removed stay removed.
const erased = new Set();
for (let from = 0; ; from += 1000) {
  const { data: page, error } = await supabase.from("legacy_accounts").select("legacy_user_id").not("erased_at", "is", null).range(from, from + 999);
  if (error) throw error;
  page.forEach((r) => erased.add(r.legacy_user_id));
  if (page.length < 1000) break;
}
rows.splice(0, rows.length, ...rows.filter((r) => !erased.has(r.legacy_user_id)));

const strip = ({ defaultDecision, ...row }) => row;
const fresh = rows.filter((r) => !decidedByHand.has(r.legacy_user_id)).map((r) => ({ ...strip(r), decision: r.defaultDecision }));
const kept = rows.filter((r) => decidedByHand.has(r.legacy_user_id)).map(strip);
for (const batch of [fresh, kept]) {
  for (let i = 0; i < batch.length; i += 500) {
    const { error } = await supabase.from("legacy_accounts").upsert(batch.slice(i, i + 500), { onConflict: "legacy_user_id" });
    if (error) throw error;
  }
}
console.log(`loaded ${rows.length} (${kept.length} kept their hand-made decision)`);
