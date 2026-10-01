// Checks shared profiles, the profile line and check-in flair without a
// database or a browser:
//  1. Link names (handles): tidying, the rules, reserved words (as words,
//     so "stafford-j" is fine), suggestions with a random end, and that the
//     app's rule and the database's CHECK agree.
//  2. Display names and the profile line: defaults (never an email's
//     surname), names that sound like the Royale or its staff, limits,
//     invisible and direction-changing characters (and none typed raw into
//     the source), what the check-in screen accepts.
//  3. Movies seen, for the MPLC license: only this (Central) year's
//     releases by name, older and unknown-year films only counted, upcoming
//     screenings left out, and New Year's Eve at 7 PM Central.
//  3b. The page is as of the start of today's business day: nothing from
//     today (a check-in, a badge, a showing) until tomorrow.
//  4. Badges: no points, Birthday Visit with its year only, Early Riser and
//     Night Owl with the month only.
//  5. What the shared page gets: exactly the whitelisted fields, never the
//     email, phone, points, member id, photo address or birthday, and
//     nothing at all when sharing is off, turned off by staff, or erased.
//  6. Flair: catalog lookups fall back, the birthday party, and every color
//     reads with ink type on it (the check-in banner).
//  7. The entrance animations: seeded, and the confetti is gone in time.
//  8. Page views count /m/<handle> as one page, not by whose it is.
//
// Usage: node scripts/check-member-profile.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";

// The app's "@/..." imports point at src/.
const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        if (s === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
        return next(s.startsWith("@/") ? ${JSON.stringify(srcRoot)} + s.slice(2) + ".ts" : s, c);
      }`,
    ),
);

const p = await import("../src/lib/member-profile.ts");
const f = await import("../src/lib/flair.ts");
const mplc = await import("../src/lib/mplc.ts");
const canvas = await import("../src/components/flair/canvas.ts");
const usage = await import("../src/lib/usage.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(label, ok, ok ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// ---------- 1. link names ----------
eq("'  Maya R. ' -> maya-r", p.normalizeHandle("  Maya R. "), "maya-r");
eq("'@Zoë_Smith' -> zoe-smith", p.normalizeHandle("@Zoë_Smith"), "zoe-smith");
eq("typing keeps a trailing hyphen", p.handleInput("maya-"), "maya-");
eq("  but it's gone when saved", p.normalizeHandle("maya-"), "maya");
eq("runs of hyphens collapse", p.normalizeHandle("maya---r"), "maya-r");
eq("emoji and symbols drop out", p.normalizeHandle("🦄 unicorn!! fan"), "unicorn-fan");
eq("cut to 24", p.normalizeHandle("a".repeat(40)).length, 24);
eq("ok: maya-r", p.handleProblem("maya-r"), null);
eq("ok: abc", p.handleProblem("abc"), null);
check("too short: ab", !!p.handleProblem("ab"));
check("too long: 25 letters", !!p.handleProblem("a".repeat(25)));
check("starts with a digit: 1abc", !!p.handleProblem("1abc"));
check("double hyphen: maya--r", !!p.handleProblem("maya--r"));
check("ends in a hyphen: maya-", !!p.handleProblem("maya-"));
check("uppercase isn't stored: Maya", !!p.handleProblem("Maya"));
for (const h of ["admin", "account", "staff", "api", "privacy", "undefined", "royale", "royale-staff", "royalefan", "rcl", "rcl-official", "official-maya", "staff-maya", "maya-staff", "joplin-manager", "owner"]) {
  check(`reserved: ${h}`, !!p.handleProblem(h));
}
// A staff word is reserved as a word, not as the start of a name.
for (const h of ["stafford-j", "rclanton", "rclark", "ownby", "adminton", "supportive-sam", "managerie"]) {
  eq(`not reserved: ${h}`, p.handleProblem(h), null);
}
eq("suggest from 'Maya Rodriguez'", p.suggestHandle("Maya Rodriguez"), "maya-r");
eq("  with a suffix", p.suggestHandle("Maya Rodriguez", "7k"), "maya-r-7k");
eq("  from 'Stafford Jones' (not reserved)", p.suggestHandle("Stafford Jones", "7k"), "stafford-j-7k");
{
  const long = p.suggestHandle("Bartholomew-Maximilian Featherstonehaugh", "x9");
  check("  a long name with a suffix still fits", long.length <= p.HANDLE_MAX && long.endsWith("-x9") && p.isValidHandle(long), long);
  const sfx = Array.from({ length: 200 }, () => p.handleSuffix());
  check("handleSuffix: two characters, no look-alikes (0 o 1 l i)", sfx.every((x) => /^[a-hj-km-np-z2-9]{2}$/.test(x)), sfx.find((x) => !/^[a-hj-km-np-z2-9]{2}$/.test(x)));
  check("  and they vary", new Set(sfx).size > 50);
  eq("  seeded: rand 0 and 0.999", [p.handleSuffix(() => 0), p.handleSuffix(() => 0.999)], ["aa", "99"]);
}
eq("suggest from 'Al' (too short)", p.suggestHandle("Al"), "al-fan");
eq("suggest from a name in another script", p.suggestHandle("李小龙"), "movie-fan");
eq("suggest from 'Staff Member' (reserved): none", p.suggestHandle("Staff Member"), "movie-fan");
eq("suggest from '3PO' (letters only)", p.suggestHandle("3PO"), "po-fan");
eq("suggest from an email-style name: no surname", p.suggestHandle("maya.rodriguez", "7k"), "maya-7k");
{
  // The database's CHECK (20261001120000_member_profiles.sql), in JS.
  const db = (h) => /^[a-z][a-z0-9-]{1,22}[a-z0-9]$/.test(h) && !h.includes("--");
  const samples = ["abc", "maya-r", "a1", "a-b", "zz9", "a".repeat(24), "a".repeat(25), "maya--r", "maya-", "-maya", "9lives", "m", "ab", "movie-fan", "x-y-z-1-2-3"];
  const disagree = samples.filter((h) => p.handleProblem(h) === null && !db(h));
  check("every handle the app accepts passes the database's CHECK", disagree.length === 0, disagree.join(", "));
}

// ---------- 2. names and the profile line ----------
eq("default display name: 'maya rodriguez'", p.defaultDisplayName("maya rodriguez"), "Maya R.");
eq("  one name", p.defaultDisplayName("Maya"), "Maya");
eq("  a long last name", p.defaultDisplayName("José de la Cruz"), "José C.");
eq("  nothing", p.defaultDisplayName("   "), "A Royale Insider");
eq("  a hyphenated first name stays whole", p.defaultDisplayName("Jean-Luc Picard"), "Jean-Luc P.");
// An account made from an email alone is named after the email's first part.
eq("  an email-style name: the first run of letters, no surname", p.defaultDisplayName("maya.rodriguez"), "Maya");
eq("  'mrod_1985'", p.defaultDisplayName("mrod_1985"), "Mrod");
eq("  'maya+rcl'", p.defaultDisplayName("maya+rcl"), "Maya");
eq("  '12345' (no letters)", p.defaultDisplayName("12345"), "A Royale Insider");
eq("  a name that reads as staff", p.defaultDisplayName("Staff Member"), "A Royale Insider");
eq("display name tidied", p.cleanDisplayName("  Maya   ✨ "), { ok: true, value: "Maya ✨" });
for (const n of ["Royale Staff", "Royale Cinema Lounge", "royale cinema", "The Royale", "Royale", "ROYALE  TEAM", "Manager", "Maya (Manager)", "RCL Official", "Royalé Owner", "Bartender Bob"]) {
  check(`display name refused, sounds like the Royale or staff: ${n}`, !p.cleanDisplayName(n).ok);
}
for (const n of ["Royale with Cheese", "Stafford", "Horror Queen", "Maya R.", "Popcorn Royalty"]) {
  check(`display name fine: ${n}`, p.cleanDisplayName(n).ok);
}
eq("a stored name that sounds like staff isn't shown: the default is", p.displayNameFor({ name: "Maya Rodriguez", display_name: "Royale Staff" }), "Maya R.");
eq("blank display name: use the default", p.cleanDisplayName("   "), { ok: true, value: null });
check("41 characters is too long", !p.cleanDisplayName("x".repeat(41)).ok);
check("no letters or digits: refused", !p.cleanDisplayName("🎬🎬").ok);
eq("displayNameFor with none chosen", p.displayNameFor({ name: "Maya Rodriguez", display_name: null }), "Maya R.");
eq("displayNameFor with one chosen", p.displayNameFor({ name: "Maya Rodriguez", display_name: "Horror Queen" }), "Horror Queen");
eq("line: whitespace collapsed", p.cleanProfileLine("  Horror\n or   nothing "), { ok: true, value: "Horror or nothing" });
eq("line: blank is none", p.cleanProfileLine("   "), { ok: true, value: null });
check("line: 120 characters is fine", p.cleanProfileLine("x".repeat(120)).ok);
check("line: 121 is too long", !p.cleanProfileLine("x".repeat(121)).ok);
eq("PROFILE_LINE_MAX matches the database's 120", p.PROFILE_LINE_MAX, 120);
// Escapes, not the characters themselves, so this file shows what it tests.
eq("line: zero-width and direction overrides removed", p.cleanProfileLine("ab\u200bc\u202edef\u2066g\u00ad\ufeff"), { ok: true, value: "abcdefg" });
{
  const zalgo = p.cleanProfileLine("Z\u0301\u0302\u0303\u0304\u0305\u0306o");
  eq("line: piles of combining marks cut to two", zalgo.ok && zalgo.value, "Z\u0301\u0302o");
}
{
  // No invisible or direction-changing character typed straight into the
  // sanitizer's source (they'd be invisible in review, and an editor could
  // strip them and quietly switch it off).
  const { readFileSync } = await import("node:fs");
  const raw = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;
  for (const f of ["../src/lib/member-profile.ts", "../src/app/(profile)/m/[handle]/opengraph-image.tsx", "./check-member-profile.mjs"]) {
    check(`no raw invisible characters in ${f.replace(/^\.\.?\//, "")}`, !raw.test(readFileSync(new URL(f, import.meta.url), "utf8")));
  }
}
eq("check-in screen: a number isn't a line", p.lineFromChannel(123), null);
eq("a form posted by hand: a number isn't a line", p.cleanProfileLine(42), { ok: true, value: null });
eq("  or a link name", p.normalizeHandle({ evil: true }), "");
eq("  or a display name", p.cleanDisplayName(["Maya"]), { ok: true, value: null });
eq("check-in screen: blank isn't a line", p.lineFromChannel("   "), null);
eq("check-in screen: cut to 120", p.lineFromChannel("y".repeat(500))?.length, 120);
eq("a hidden line shows nowhere", p.visibleLine({ tagline: "Hi", tagline_hidden_at: "2026-10-01T00:00:00Z" }), null);
eq("a line not hidden shows", p.visibleLine({ tagline: " Hi  there ", tagline_hidden_at: null }), "Hi there");

// ---------- 3. movies seen, for the MPLC license ----------
{
  const now = new Date("2026-10-15T00:00:00Z");
  const row = (screeningId, movieId, title, releaseYear, startsAt) => ({ screeningId, movieId, title, posterUrl: null, releaseYear, startsAt });
  const rows = [
    row("s1", "A", "This Year Film", 2026, "2026-09-01T00:00:00Z"),
    row("s2", "A", "This Year Film", 2026, "2026-10-01T00:00:00Z"),
    row("s2", "A", "This Year Film", 2026, "2026-10-01T00:00:00Z"), // a second booking, same showing
    row("s3", "B", "SECRET CLASSIC", 1985, "2026-08-01T00:00:00Z"),
    row("s4", "C", "UNMATCHED TITLE", null, "2026-07-01T00:00:00Z"),
    row("s5", "D", "Coming Next Week", 2026, "2026-10-22T00:00:00Z"), // upcoming
    row("s6", "E", "Last Year Film", 2025, "2026-02-01T00:00:00Z"),
  ];
  const m = p.publicMovies(rows, now);
  eq("named: only this year's releases, seen twice", m.named, [{ title: "This Year Film", posterUrl: null, times: 2 }]);
  eq("archive: 1985, unknown year and 2025 are counted", m.archive, 3);
  eq("total: different films seen (upcoming left out)", m.total, 4);
  const json = JSON.stringify(m);
  check("no archive title reaches the page", !/SECRET CLASSIC|UNMATCHED TITLE|Last Year Film/.test(json));
  check("upcoming screenings aren't 'seen'", !json.includes("Coming Next Week"));
  check("no dates or ids reach the page", !/2026-|"s\d"|movieId|screeningId|startsAt/.test(json));

  // Today's showings wait for tomorrow: `now` is 7 PM Central on Oct 14.
  const today = [
    row("t1", "F", "Showing Right Now", 2026, "2026-10-14T23:00:00Z"), // 6 PM Central today: started an hour ago
    row("t2", "G", "This Morning", 2026, "2026-10-14T14:00:00Z"), // 9 AM Central today
    row("t3", "H", "Last Night Late", 2026, "2026-10-14T04:30:00Z"), // 11:30 PM Central Oct 13: yesterday
  ];
  const mt = p.publicMovies(today, now);
  eq("a showing that started today isn't on the page yet (not even this morning's)", mt.named.map((x) => x.title), ["Last Night Late"]);
  eq("  nor counted", mt.total, 1);
  eq("  the next morning (4 AM Central) it is", p.publicMovies(today, new Date("2026-10-15T09:00:00Z")).total, 3);
  eq("  but not at 3 AM Central (still the same business day)", p.publicMovies(today, new Date("2026-10-15T08:00:00Z")).total, 1);

  // New Year's Eve at 7 PM Central is already Jan 1 on the servers' (UTC)
  // clock: the theater's year is still 2026.
  const nye = new Date("2027-01-01T01:00:00Z");
  eq("centralYear at 7 PM Central on Dec 31", mplc.centralYear(nye), 2026);
  const seen = [row("s1", "A", "This Year Film", 2026, "2026-12-30T20:00:00Z")];
  eq("NYE 7 PM Central: a 2026 film is still named", p.publicMovies(seen, nye).named.length, 1);
  const midnight = new Date("2027-01-01T06:00:00Z");
  eq("midnight Central: it's the archive now", p.publicMovies(seen, midnight), { named: [], archive: 1, total: 1 });
  check("isRestrictedRelease: null year is restricted", mplc.isRestrictedRelease({ release_year: null }, now));
}

// ---------- 3b. the page is as of the start of today's business day ----------
eq("profileAsOf at 2 AM Central Oct 2: still Oct 1's business day", p.profileAsOf(new Date("2026-10-02T07:00:00Z")), { today: "2026-10-01", through: "2026-09-30" });
eq("profileAsOf at 5 AM Central Oct 2", p.profileAsOf(new Date("2026-10-02T10:00:00Z")), { today: "2026-10-02", through: "2026-10-01" });
eq("profileAsOf across the fall-back night (Nov 1, 3 AM CST)", p.profileAsOf(new Date("2026-11-01T09:00:00Z")).today, "2026-10-31");
check("beforeToday: yesterday evening yes", p.beforeToday("2026-10-14T01:00:00Z", new Date("2026-10-14T20:00:00Z")));
check("beforeToday: this morning no", !p.beforeToday("2026-10-14T14:00:00Z", new Date("2026-10-14T20:00:00Z")));
check("beforeToday: nonsense no", !p.beforeToday("not a date", new Date("2026-10-14T20:00:00Z")));
{
  // The server's counts (lib/member-profile-server.ts needs the database,
  // so this reads its source): visits before today, the streak as of
  // yesterday, badges and showings through beforeToday.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/lib/member-profile-server.ts", import.meta.url), "utf8");
  check("server: visits counted before today's business day", src.includes('.lt("business_date", today)'));
  check("server: week streak as of yesterday", src.includes("p_date: through"));
  check("server: badges and showings cut off with beforeToday", (src.match(/beforeToday\(/g) ?? []).length >= 2);
  check("server: not the account's live visitSummary", !src.includes("visitSummary"));
}

// ---------- 4. badges ----------
{
  const now = new Date("2026-10-15T00:00:00Z"); // 7 PM Central, Oct 14
  const b = p.publicBadges(
    [
      { key: "welcome", period: "", earnedAt: "2026-09-30T23:30:00Z" },
      { key: "birthday", period: "2025", earnedAt: "2025-03-14T19:00:00Z" },
      { key: "birthday", period: "2026", earnedAt: "2026-03-13T19:00:00Z" },
      { key: "night_owl", period: "", earnedAt: "2026-10-03T05:10:00Z" },
      { key: "early_riser", period: "", earnedAt: "2026-10-06T12:40:00Z" },
      { key: "not_a_badge", period: "", earnedAt: "2026-10-03T05:10:00Z" },
      { key: "visits_10", period: "", earnedAt: "2026-10-14T23:10:00Z" }, // 6:10 PM Central today
      { key: "weeks_4", period: "", earnedAt: "2026-10-14T13:00:00Z" }, // 8 AM Central today
    ],
    now,
  );
  eq("badges in the cabinet's order, unknown ones dropped", b.map((x) => x.key), ["welcome", "early_riser", "night_owl", "birthday"]);
  check("a badge earned today isn't on the page yet", !b.some((x) => x.key === "visits_10" || x.key === "weeks_4"));
  const bday = b.find((x) => x.key === "birthday");
  eq("Birthday Visit shows its year only", bday?.earned, "2026");
  eq("  and how many times", bday?.times, 2);
  check("  and never the day", !JSON.stringify(b).includes("Mar"));
  eq("dates are the Central day: 11:30 PM UTC Sep 30 is Sep 30 in Joplin", b[0].earned, "Sep 30, 2026");
  eq("Night Owl shows the month only (its day would say they were here late)", b.find((x) => x.key === "night_owl")?.earned, "Oct 2026");
  eq("Early Riser too", b.find((x) => x.key === "early_riser")?.earned, "Oct 2026");
  check("no points, no times of day", !/points|:\d\d|AM|PM/.test(JSON.stringify(b)));
  eq("the next morning the badges earned today are there", p.publicBadges([{ key: "visits_10", period: "", earnedAt: "2026-10-14T23:10:00Z" }], new Date("2026-10-15T10:00:00Z")).length, 1);
}

// ---------- 5. what the shared page gets ----------
{
  const memberId = "0f8b8b8e-1111-4c4c-8d8d-123456789abc";
  const row = {
    id: memberId,
    auth_user_id: "a0a0a0a0-2222-4c4c-8d8d-123456789abc",
    name: "Maya Rodriguez",
    email: "maya.private@example.com",
    phone: "(417) 555-0199",
    phone_digits: "4175550199",
    points: 4321,
    tier: "Insiders+",
    stripe_customer_id: "cus_SECRET",
    birthday: "2000-03-14",
    avatar_url: `https://example.supabase.co/storage/v1/object/public/member-avatars/${memberId}-1700000000000.jpg`,
    created_at: "2026-09-02T15:00:00Z",
    share_profile: true,
    profile_handle: "maya-r",
    display_name: null,
    tagline: "Horror or nothing",
    tagline_hidden_at: null,
    profile_hidden_at: null,
    erased_at: null,
    flair_color: "pink",
    flair_effect: "unicorn",
    flair_sticker: "popcorn",
  };
  const facts = {
    visits: 12,
    weekStreak: 4,
    badges: [{ key: "welcome", period: "", earnedAt: "2026-09-10T18:00:00Z" }],
    seen: [{ screeningId: "s1", movieId: "A", title: "This Year Film", posterUrl: "https://image.tmdb.org/x.jpg", releaseYear: 2026, startsAt: "2026-09-10T19:00:00Z" }],
  };
  const now = new Date("2026-10-15T00:00:00Z");
  const out = p.toPublicProfile(row, facts, now);
  eq("fields: exactly the whitelist", Object.keys(out ?? {}).sort(), ["badgeTotal", "badges", "displayName", "flair", "handle", "initial", "line", "memberSince", "movies", "photo", "visits", "weekStreak"]);
  const json = JSON.stringify(out);
  for (const [label, secret] of [
    ["email", "maya.private@example.com"],
    ["phone", "555-0199"],
    ["phone digits", "4175550199"],
    ["points balance", "4321"],
    ["member id", memberId],
    ["member id (first part)", "0f8b8b8e"],
    ["login id", "a0a0a0a0"],
    ["Stripe id", "cus_SECRET"],
    ["photo's storage address", "supabase.co"],
    ["birthday", "03-14"],
    ["last name", "Rodriguez"],
    ["Insiders+ status", "Insiders+"],
  ]) {
    check(`never on the page: ${label}`, !json.includes(secret));
  }
  eq("display name defaults to first name and last initial", out?.displayName, "Maya R.");
  check("photo is served by handle", /^\/m\/maya-r\/photo\?v=[0-9a-z]+$/.test(out?.photo ?? ""), out?.photo);
  eq("member since, by month", out?.memberSince, "Sep 2026");
  eq("flair as keys", out?.flair, { color: "pink", effect: "unicorn", sticker: "popcorn" });
  eq("line shows", out?.line, "Horror or nothing");
  eq("line hidden by staff: not on the page", p.toPublicProfile({ ...row, tagline_hidden_at: "2026-10-01T00:00:00Z" }, facts, now)?.line, null);
  eq("sharing off: no page", p.toPublicProfile({ ...row, share_profile: false }, facts, now), null);
  eq("turned off by staff: no page", p.toPublicProfile({ ...row, profile_hidden_at: "2026-10-01T00:00:00Z" }, facts, now), null);
  eq("erased: no page", p.toPublicProfile({ ...row, erased_at: "2026-10-01T00:00:00Z" }, facts, now), null);
  eq("no handle: no page", p.toPublicProfile({ ...row, profile_handle: null }, facts, now), null);
  eq("a stored handle that isn't valid: no page", p.toPublicProfile({ ...row, profile_handle: "Maya-R" }, facts, now), null);
  eq("no photo: none", p.toPublicProfile({ ...row, avatar_url: null }, facts, now)?.photo, null);
  check("a new photo gets a new address", p.photoVersion("a.jpg") !== p.photoVersion("b.jpg"));
  check("the link preview's words: name and counts only", !/Rodriguez|4321|@/.test(p.profileBlurb(out)), p.profileBlurb(out));
  {
    // They're here tonight: checked in at 6 PM, earned a badge, and their
    // 6 PM showing has started. None of it is on the page (or its preview)
    // until tomorrow.
    const tonight = {
      ...facts,
      badges: [...facts.badges, { key: "visits_10", period: "", earnedAt: "2026-10-14T23:01:00Z" }],
      seen: [...facts.seen, { screeningId: "s9", movieId: "Z", title: "TONIGHT AT SIX", posterUrl: null, releaseYear: 2026, startsAt: "2026-10-14T23:00:00Z" }],
    };
    const o2 = p.toPublicProfile(row, tonight, now);
    check("tonight's showing isn't on the page", !JSON.stringify(o2).includes("TONIGHT AT SIX") && o2?.movies.total === 1);
    check("  nor tonight's badge", o2?.badges.length === 1 && !o2.badges.some((x) => x.key === "visits_10"));
    eq("  nor in the link preview's counts", p.profileBlurb(o2), p.profileBlurb(out));
  }
}

// ---------- 6. flair ----------
eq("nothing picked: classic", f.parseFlair(null), f.CLASSIC);
eq("unknown keys fall back", f.parseFlair({ color: "chartreuse", effect: "explode", sticker: "skull" }), f.CLASSIC);
eq("from a members row", f.flairKeys(f.parseFlair({ flair_color: "teal", flair_effect: "fireworks", flair_sticker: "star" })), { color: "teal", effect: "fireworks", sticker: "star" });
eq("birthday week: the party", f.entranceFor(f.parseFlair({ flair_effect: "unicorn" }), true), "party");
eq("any other week: their own", f.entranceFor(f.parseFlair({ flair_effect: "unicorn" }), false), "unicorn");
check("'party' is an entrance, not a pickable effect", f.isEntrance("party") && !f.isFlairEffect("party"));
check("about ten colors, unique keys", f.FLAIR_COLORS.length >= 8 && f.FLAIR_COLORS.length <= 12 && new Set(f.FLAIR_COLORS.map((c) => c.key)).size === f.FLAIR_COLORS.length);
{
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ink = lum("#14110c");
  for (const c of f.FLAIR_COLORS) {
    const ratio = (lum(c.hex) + 0.05) / (ink + 0.05);
    // WCAG AA for ordinary text (4.5:1) both ways: ink type on the color,
    // and the color on the ink screen.
    check(`${c.label}: ink type reads on it, and it shows on the ink screen`, ratio >= 4.5, `contrast ${ratio.toFixed(1)}:1`);
  }
}
eq("mixHex halfway", f.mixHex("#000000", "#ffffff", 0.5), "#808080");
check("effect palette leads with their color", f.effectPalette("#ff6fb5")[0] === "#ff6fb5");
check("every sticker in the picker is known", f.FLAIR_STICKERS.every((s) => f.isSticker(s.key)));
check("entrances are 3.6 seconds or less", f.ENTRANCE_MS <= 3600 && f.STILL_MS < f.ENTRANCE_MS);

// ---------- 7. the animations ----------
{
  const a = canvas.seeded(42);
  const b = canvas.seeded(42);
  eq("seeded: same seed, same scatter", [a(), a(), a()], [b(), b(), b()]);
  const h = 800;
  const w = 1280;
  const bits = canvas.makeConfetti(w, h, { colors: ["#ff6fb5"], backs: ["#aa3377"], count: 180, from: "cannons", rand: canvas.seeded(7) });
  const top = bits.map(() => Infinity);
  const dt = 1 / 60;
  let visibleAtEnd = 0;
  for (let t = 0; t < f.ENTRANCE_MS / 1000; t += dt) {
    bits.forEach((bit, i) => {
      canvas.stepConfetti(bit, dt, h);
      if (bit.delay <= 0) top[i] = Math.min(top[i], bit.y);
    });
  }
  visibleAtEnd = bits.filter((bit) => bit.y >= 0 && bit.y <= h && bit.x >= 0 && bit.x <= w).length;
  const tops = top.filter(Number.isFinite).sort((x, y) => x - y);
  const median = tops[Math.floor(tops.length / 2)] / h;
  check("confetti cannons reach the upper half of the screen", median > 0.2 && median < 0.6, `median peak at ${(median * 100).toFixed(0)}% from the top`);
  check("  and it's nearly all fallen away by the end", visibleAtEnd < bits.length * 0.1, `${visibleAtEnd} of ${bits.length} still on screen`);
}

// ---------- 8. page views ----------
eq("page views: a profile is one page, not whose", usage.normalizePath("/m/maya-r"), { path: "/m/[handle]", pattern: "/m/[handle]", entityId: null });
eq("page views: other pages unchanged", usage.normalizePath("/showtimes").path, "/showtimes");

console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
