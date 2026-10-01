// Checks merging duplicate members without a database (nothing is read
// from or written to the live one):
//  1. The rules in src/lib/member-merge.ts, which the merge preview shows:
//     usable phones (the old site's "-" isn't one), refusals, what the kept
//     account takes from the other, the plain-language result, and spotting
//     an account the door tablet made for someone it couldn't find.
//  2. The merge itself, by reading migration 20261001150000: merge_members
//     moves every table that points at members (and the list of those is
//     checked against every "references members" in the migrations, so a
//     new one can't be missed), says no with the same words as the
//     preview, carries over the same fields, and is locked down to the
//     server.
//  3. The app around it: owner/admin only, and the register never merges.
//
// Usage: node scripts/check-member-merge.mjs   (Node 23.6+ runs the .ts directly)

import { registerHooks } from "node:module";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.code !== "MODULE_TYPELESS_PACKAGE_JSON" && w.name !== "ExperimentalWarning") console.warn(`${w.name}: ${w.message}`);
});
const SRC = new URL("../src/", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    const spec = specifier.startsWith("@/") ? new URL(specifier.slice(2), SRC).href : specifier;
    try {
      return next(spec, context);
    } catch (e) {
      if (/^(\.{1,2}\/|file:)/.test(spec) && !/\.[cm]?[jt]s$/.test(spec)) return next(`${spec}.ts`, context);
      throw e;
    }
  },
});

const L = await import("../src/lib/member-merge.ts");
const { usablePhone, normalName, mergeRefusal, mergedProfile, mergedVisitCount, badgeOverlap, mergeSentence, pointsText, isTabletMade, isLikelyTabletDuplicate, suggestKeep, mergeHref } = L;
const { REFUSE_SAME, REFUSE_MISSING, REFUSE_ERASED, REFUSE_LOGINS, REFUSE_BILLING, CARRIED_LABEL, MERGE_MEMBER_COLUMNS } = L;

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(label, ok, ok ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// A member with nothing on it; tests change what they need.
let n = 0;
const member = (over = {}) => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  name: "Jake Brown",
  tier: "Insiders",
  points: 0,
  created_at: "2026-09-15T05:00:00.000Z",
  last_activity_at: null,
  email: null,
  phone: null,
  auth_user_id: null,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  subscription_status: null,
  price_tier: null,
  birthday: null,
  avatar_url: null,
  tagline: null,
  comped: false,
  plus_gift_until: null,
  legacy_user_id: null,
  imported_at: null,
  email_opt_in: true,
  email_opt_in_changed_at: null,
  monthly_member: false,
  erased_at: null,
  ...over,
});

// ---------- 1. the rules ----------
console.log("-- phones and names");
eq("the old site's '-' isn't a usable phone", usablePhone("-"), false);
eq("nor is nothing", [usablePhone(null), usablePhone(""), usablePhone(undefined)], [false, false, false]);
eq("nor junk digits", [usablePhone("123"), usablePhone("555-1234"), usablePhone("0175550101")], [false, false, false]);
eq("a US number however it's typed", [usablePhone("(417) 555-0101"), usablePhone("417.555.0101"), usablePhone("+1 417 555 0101"), usablePhone("14175550101")], [true, true, true, true]);
eq("names ignore case and extra spaces", normalName("  Jake   BROWN "), "jake brown");

console.log("-- refusals");
const a = member();
eq("same account", mergeRefusal(a, a), REFUSE_SAME);
eq("one missing", [mergeRefusal(a, null), mergeRefusal(null, a)], [REFUSE_MISSING, REFUSE_MISSING]);
eq("personal info removed", mergeRefusal(member(), member({ erased_at: "2026-09-30T00:00:00Z" })), REFUSE_ERASED);
eq("both have a website login", mergeRefusal(member({ auth_user_id: "u1" }), member({ auth_user_id: "u2" })), REFUSE_LOGINS);
eq("both have Stripe billing", mergeRefusal(member({ stripe_customer_id: "cus_1" }), member({ stripe_subscription_id: "sub_2" })), REFUSE_BILLING);
eq("one login and the other's billing is fine", mergeRefusal(member({ auth_user_id: "u1" }), member({ stripe_customer_id: "cus_1" })), null);
eq("the usual pair is fine", mergeRefusal(member(), member()), null);

console.log("-- what the kept account ends up with");
// The real case: the old-site account (email, Insiders+, placeholder phone)
// keeps; the tablet's account (phone, today's visit) comes in.
const oldSite = member({ email: "jake@example.invalid", phone: "-", tier: "Insiders+", points: 10, legacy_user_id: 4242, imported_at: "2026-09-15T05:00:00Z", last_activity_at: "2026-09-20T02:00:00.000Z" });
const tablet = member({ name: "Jake  Brown", phone: "(417) 555-0101", points: 55, created_at: "2026-10-01T01:00:00.000Z", email_opt_in: false, birthday: "2000-03-04", last_activity_at: "2026-10-01T01:05:00.000Z" });
const p = mergedProfile(oldSite, tablet);
eq("phone comes over (the kept one isn't usable)", [p.phone, p.from.phone], ["(417) 555-0101", "drop"]);
eq("email stays", [p.email, p.from.email], ["jake@example.invalid", "keep"]);
eq("higher tier stays", p.tier, "Insiders+");
eq("points add up", p.points, 65);
eq("member since is the earlier date", p.createdAt, "2026-09-15T05:00:00.000Z");
eq("last activity is the later", p.lastActivityAt, "2026-10-01T01:05:00.000Z");
eq("birthday comes over", p.birthday, "2000-03-04");
eq("email preference: the kept account's when neither chose", p.emailOptIn, true);
eq("carried", p.carried, ["phone", "birthday"]);
eq("nothing lost (same name, one email, one usable phone)", p.notKept, []);
eq("the other way round, the same result", (() => {
  const q = mergedProfile(tablet, oldSite);
  return [q.phone, q.email, q.tier, q.points, q.createdAt, q.carried];
})(), ["(417) 555-0101", "jake@example.invalid", "Insiders+", 65, "2026-09-15T05:00:00.000Z", ["email", "old_site", "tier", "member_since"]]);

eq("a one-word name gives way to the full one", mergedProfile(member({ name: "Jake" }), member({ name: "jake Brown" })).name, "jake Brown");
eq("...but not to a different name", mergedProfile(member({ name: "Jake" }), member({ name: "Jacob Brown" })).name, "Jake");
eq("a different name isn't kept, and says so", mergedProfile(member({ name: "Jake Brown" }), member({ name: "Jacob Brown" })).notKept, ["name"]);
eq("two emails: the kept one stays, and says so", mergedProfile(member({ email: "a@x.com" }), member({ email: "b@x.com" })).notKept, ["email"]);
eq("two usable phones: the kept one stays", (() => {
  const q = mergedProfile(member({ phone: "417-555-0100" }), member({ phone: "417-555-0199" }));
  return [q.phone, q.notKept];
})(), ["417-555-0100", ["phone"]]);
eq("the login comes over", (() => {
  const q = mergedProfile(member(), member({ auth_user_id: "u1" }));
  return [q.hasLogin, q.from.login, q.carried];
})(), [true, "drop", ["login"]]);
eq("Stripe billing comes over whole", mergedProfile(member(), member({ stripe_subscription_id: "sub_1", price_tier: "senior", tier: "Insiders+" })).carried, ["billing", "tier"]);
eq("a senior rate comes over to an unbilled account", mergedProfile(member(), member({ price_tier: "senior" })).carried, ["rate"]);
eq("...but not onto one Stripe bills at its own rate", mergedProfile(member({ stripe_customer_id: "cus_1" }), member({ price_tier: "senior" })).carried, []);
eq("photo, line, free membership, gift and old-site link fill gaps", mergedProfile(member(), member({ avatar_url: "https://x/p.jpg", tagline: "hi", comped: true, plus_gift_until: "2027-01-01T00:00:00Z", legacy_user_id: 7 })).carried, ["photo", "tagline", "free_membership", "gift", "old_site"]);
eq("the later gift end wins", mergedProfile(member({ plus_gift_until: "2027-06-01T00:00:00Z" }), member({ plus_gift_until: "2027-01-01T00:00:00Z" })).giftUntil, "2027-06-01T00:00:00Z");
eq("a recorded email choice on the other account wins over none", (() => {
  const q = mergedProfile(member({ email_opt_in: true }), member({ email_opt_in: false, email_opt_in_changed_at: "2026-09-25T00:00:00Z" }));
  return [q.emailOptIn, q.carried];
})(), [false, ["email_choice"]]);
eq("the kept account's recorded choice stays", mergedProfile(member({ email_opt_in: false, email_opt_in_changed_at: "2026-09-01T00:00:00Z" }), member({ email_opt_in: true, email_opt_in_changed_at: "2026-09-25T00:00:00Z" })).emailOptIn, false);
eq("fractions of points add up exactly", mergedProfile(member({ points: 12.5 }), member({ points: 0.1 })).points, 12.6);

console.log("-- overlaps and the sentence");
eq("a day both checked in counts once", mergedVisitCount(["2026-09-19", "2026-09-30"], ["2026-09-30"]), { total: 2, sameDay: 1 });
eq("no visits", mergedVisitCount([], []), { total: 0, sameDay: 0 });
eq("same badge and period overlap", badgeOverlap([{ badge: "welcome", period: "" }, { badge: "birthday", period: "2026" }], [{ badge: "welcome", period: "" }, { badge: "birthday", period: "2027" }]), 1);
eq("the plain-language result", mergeSentence("Jake Brown", 65, 1), "Jake will have 1 account with 65 points and 1 visit.");
eq("after the merge", mergeSentence("Jake Brown", 65, 2, true), "Jake now has 1 account with 65 points and 2 visits.");
eq("one point, fractions", [pointsText(1), pointsText(12.5), pointsText(0)], ["1 point", "12.5 points", "0 points"]);

console.log("-- spotting the tablet's duplicates");
const now = new Date("2026-10-01T20:00:00Z");
const madeToday = { id: "b", created_at: "2026-10-01T01:00:00Z", phone: "(417) 555-0101", legacy_user_id: null, imported_at: null };
const imported = { id: "a", created_at: "2026-09-15T05:00:00Z", phone: null, legacy_user_id: 4242, imported_at: "2026-09-15T05:00:00Z" };
eq("made at the tablet today", isTabletMade(madeToday, now), true);
eq("an import isn't", isTabletMade(imported, now), false);
eq("nor one with no usable phone", isTabletMade({ ...madeToday, phone: "-" }, now), false);
eq("nor one over 30 days old", isTabletMade({ ...madeToday, created_at: "2026-08-31T00:00:00Z" }, now), false);
eq("the Jake pair is flagged", isLikelyTabletDuplicate(imported, madeToday, true, now), true);
eq("not if the names differ", isLikelyTabletDuplicate(imported, madeToday, false, now), false);
eq("not if the older one has a usable phone (the tablet would have found it)", isLikelyTabletDuplicate({ ...imported, phone: "417-555-0199" }, madeToday, true, now), false);
eq("not the wrong way round", isLikelyTabletDuplicate(madeToday, imported, true, now), false);
eq("the older account is kept by default", suggestKeep(madeToday, imported).keep.id, "a");
eq("the review link", mergeHref("k", "d"), "/admin/members/k/merge?drop=d");

// ---------- 2. the merge itself (the migration) ----------
console.log("-- the migration");
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MIGRATIONS = join(ROOT, "supabase/migrations");
const MIGRATION = "20261001150000_member_merge.sql";
const sql = readFileSync(join(MIGRATIONS, MIGRATION), "utf8");
const body = (() => {
  const start = sql.indexOf("create or replace function public.merge_members(");
  const end = sql.indexOf("$$;", start);
  return start >= 0 && end > start ? sql.slice(start, end) : "";
})();
check("merge_members is defined", body.length > 0);
const flat = body.replace(/\s+/g, " ").toLowerCase();

// Every column that points at members(id) (pg_constraint on 10/1).
const REFS = [
  "bookings.member_id",
  "booth_reservations.member_id",
  "gift_memberships.recipient_member_id",
  "legacy_accounts.imported_member_id",
  "member_badges.member_id",
  "member_claims.member_id",
  "member_erasures.member_id",
  "member_payments.member_id",
  "member_rewards.member_id",
  "member_subscription_ends.member_id",
  "member_visits.member_id",
  "orders.member_id",
  "points_ledger.member_id",
];
// The claim links are deleted (they name the dropped account); the rest move.
const DELETED = new Set(["member_claims.member_id"]);
for (const ref of REFS) {
  const [table, col] = ref.split(".");
  const moved = flat.includes(`update ${table} set ${col} = p_keep where ${col} = p_drop`);
  const deleted = flat.includes(`delete from ${table} where ${col} = p_drop`);
  check(`${ref} is ${DELETED.has(ref) ? "cleared" : "moved"}`, DELETED.has(ref) ? deleted : moved);
}

// ...and that list is every "references members" in the migrations.
const found = new Set();
for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql"))) {
  const text = readFileSync(join(MIGRATIONS, f), "utf8").replace(/--[^\n]*/g, "");
  for (const m of text.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
    for (const c of m[2].matchAll(/^\s*(\w+)\s+uuid\b[^\n,]*references\s+(?:public\.)?members\s*\(\s*id\s*\)/gim)) found.add(`${m[1]}.${c[1]}`);
  }
  for (const m of text.matchAll(/alter table (?:if exists )?(?:public\.)?(\w+)\s+add column (?:if not exists )?(\w+)\s+uuid\b[^;]*?references\s+(?:public\.)?members\s*\(\s*id\s*\)/gi)) found.add(`${m[1]}.${m[2]}`);
}
const missing = [...found].filter((r) => !REFS.includes(r));
const extra = REFS.filter((r) => !found.has(r));
check("every column that references members is handled", missing.length === 0, missing.length ? `not handled: ${missing.join(", ")}` : `${found.size} found`);
check("and the list has nothing that isn't in the migrations", extra.length === 0, extra.join(", "));

check("anything else still pointing at the duplicate stops the merge", /confrelid = 'public\.members'::regclass/.test(body) && /raise exception 'The duplicate still has/.test(body));
check("overlapping visits: the kept account's stays", /delete from member_visits dv using member_visits kv\s+where dv\.member_id = p_drop and kv\.member_id = p_keep and kv\.business_date = dv\.business_date/.test(body));
check("overlapping badges: the earlier stays", /db\.earned_at < kb\.earned_at/.test(body));
check("points add up", /v_points := k\.points \+ d\.points/.test(body) && /points = v_points/.test(body));
check("member since is the earlier, last activity the later", /created_at = least\(k\.created_at, d\.created_at\)/.test(body) && /last_activity_at = greatest\(last_activity_at, k\.last_activity_at, d\.last_activity_at\)/.test(body));
check("the merge is logged before the duplicate is deleted", body.indexOf("insert into member_merges") > 0 && body.indexOf("insert into member_merges") < body.indexOf("delete from members where id = p_drop"));
check("the duplicate is deleted before the kept account takes its unique fields", body.indexOf("delete from members where id = p_drop") < body.indexOf("update members set"));
check("both rows locked first", /perform 1 from members where id in \(p_keep, p_drop\) order by id for update/.test(body));

for (const [label, text] of Object.entries({ REFUSE_SAME, REFUSE_MISSING, REFUSE_ERASED, REFUSE_LOGINS, REFUSE_BILLING })) {
  check(`refuses with the preview's words: ${label}`, body.includes(`raise exception '${text.replace(/'/g, "''")}'`));
}
const sqlCarried = [...body.matchAll(/array_append\(v_carried, '(\w+)'\)/g)].map((m) => m[1]);
eq("carries over the same fields as the preview, in the same order", sqlCarried, Object.keys(CARRIED_LABEL));
for (const col of MERGE_MEMBER_COLUMNS.split(",").map((c) => c.trim())) {
  if (["id", "erased_at", "points", "last_activity_at", "created_at", "subscription_status"].includes(col)) continue;
  check(`the kept account's ${col} is decided`, new RegExp(`\\b${col} = `).test(body.slice(body.indexOf("update members set"))));
}

check("security definer, search_path = public", /security definer\s+set search_path = public/.test(body));
for (const fn of ["merge_members(uuid, uuid, uuid)", "member_duplicate_pairs(uuid)", "members_erase_merges()"]) {
  check(`${fn} not callable by public/anon/authenticated`, sql.includes(`revoke execute on function public.${fn} from public, anon, authenticated;`));
}
check("merge_members and member_duplicate_pairs for the server", sql.includes("grant execute on function public.merge_members(uuid, uuid, uuid) to service_role;") && sql.includes("grant execute on function public.member_duplicate_pairs(uuid) to service_role;"));
check("the merge log has RLS on", /alter table member_merges enable row level security;/.test(sql));
check("the merge log keeps no contact details", !/create table if not exists member_merges \([^;]*\b(email|phone)\b/.test(sql.replace(/--[^\n]*/g, "")));
check("removing the kept account's personal info clears the dropped name", /update member_merges set dropped_name = null where keep_id = new\.id/.test(sql));
check("placeholder phones are cleared, with a count", /update members set phone = null where phone is not null and phone_digits = '';/.test(sql) && /raise notice 'placeholder phones cleared: %'/.test(sql));
check("the finder's phone test is the preview's usablePhone", sql.includes("right(phone_digits, 10) ~ '^[2-9][0-9]{9}$'") && body.includes("right(coalesce(k.phone_digits, ''), 10) ~ '^[2-9][0-9]{9}$'"));
check("the finder pairs names of two words or more", /a\.nm ~ ' '/.test(sql));

// ---------- 3. the app around it ----------
console.log("-- the app");
const src = (p) => readFileSync(join(ROOT, "src", p), "utf8");
const actions = src("app/admin/members/merge-actions.ts");
check("the merge action is owner/admin only", /const staff = await assertAdmin\(\);/.test(actions));
check("it runs merge_members as that staff member", /rpc\("merge_members", \{ p_keep: keepId, p_drop: dropId, p_staff: staff\.employeeId \}\)/.test(actions));
check("the merge page is owner/admin only", /await requireAdmin\(\)/.test(src("app/admin/members/[id]/merge/page.tsx")));
check("the duplicates page is owner/admin only", /await requireAdmin\(\)/.test(src("app/admin/members/duplicates/page.tsx")));
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const posFiles = walk(join(ROOT, "src/app/pos")).filter((f) => /\.(ts|tsx)$/.test(f));
const posMerges = posFiles.filter((f) => /merge_members|mergeMemberAccounts|merge-actions/.test(readFileSync(f, "utf8")));
check("the register never merges", posMerges.length === 0, posMerges.join(", "));
const allSrc = walk(join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f));
const writers = allSrc.filter((f) => /from\("member_merges"\)\s*\.(insert|update|upsert|delete)/.test(readFileSync(f, "utf8")));
check("only the database writes the merge log", writers.length === 0, writers.join(", "));
const forward = src("lib/member-forward.ts");
check("a merged id on an open sale follows to the kept account", /from\("member_merges"\)\.select\("keep_id"\)\.eq\("dropped_id", id\)/.test(forward) && /currentMemberId\(params\.memberId\)/.test(src("app/pos/actions.ts")));

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll member-merge checks passed.");
process.exit(failures ? 1 : 0);
