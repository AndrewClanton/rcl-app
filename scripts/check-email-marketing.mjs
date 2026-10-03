// Checks email marketing (src/lib/email/*, the unsubscribe, webhook and
// click routes, the Back office actions and the Indy import) against
// in-memory stand-ins for Supabase and Resend
// (scripts/check-email-marketing-fakes.mjs). No database, no network,
// nothing is sent: fetch is replaced before anything loads, and it throws
// on any host but a fake api.resend.com.
//
// Usage: node scripts/check-email-marketing.mjs   (Node 23.6+ runs the .ts directly)
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = path.join(root, "src");
const fakesUrl = new URL("./check-email-marketing-fakes.mjs", import.meta.url).href;
const STUBBED = {
  "server-only": fakesUrl,
  "next/server": fakesUrl,
  "next/cache": fakesUrl,
  "@/lib/supabase/admin": fakesUrl,
  "@/lib/auth": fakesUrl,
  "@/lib/data/lineup": fakesUrl,
};
const withExt = (base) => [".ts", ".tsx", "/index.ts"].map((e) => base + e).find((p) => existsSync(p));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBBED[specifier]) return { url: STUBBED[specifier], shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const file = withExt(path.join(src, specifier.slice(2)));
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !path.extname(specifier)) {
      const parent = fileURLToPath(context.parentURL);
      if (parent.startsWith(src)) {
        const file = withExt(path.resolve(path.dirname(parent), specifier));
        if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});

const fakes = await import(fakesUrl);
const { db, resend, fakeFetch, flushAfter, setLineup } = fakes;
globalThis.fetch = fakeFetch;
// Test-only values, set in this process only. The key is fake and fetch is
// the fake above: nothing can reach Resend.
process.env.RESEND_API_KEY = "re_test_fake";
process.env.EMAIL_FROM = "Royale Cinema Lounge <hello@royalecinemajoplin.com>";
process.env.EMAIL_TOKEN_SECRET = randomBytes(32).toString("base64url");
process.env.EMAIL_SENDING_ENABLED = "true";
process.env.EMAIL_SCHEDULE_AHEAD_HOURS = "60";
// The Back office switch (email_settings), on for these checks; it's off by default.
db.email_settings.push({ key: "sending_switch", value: { on: true, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
const WEBHOOK_SECRET = `whsec_${randomBytes(24).toString("base64")}`;
process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
delete process.env.CRON_SECRET;

const load = (p) => import(pathToFileURL(path.join(src, p)).href);
const rules = await load("lib/email/rules.ts");
const timing = await load("lib/email/timing.ts");
const tokens = await load("lib/email/tokens.ts");
const lintMod = await load("lib/email/lint.ts");
const render = await load("lib/email/render.ts");
const format = await load("lib/email/format.ts");
const hash = await load("lib/email/hash.ts");
const sender = await load("lib/email/campaign-send.ts");
const consent = await load("lib/email/consent.ts");
const clicks = await load("lib/email/clicks.ts");
const sig = await load("lib/email/webhook-signature.ts");
const { SITE_URL } = await load("lib/site.ts");
const unsubRoute = await load("app/api/email/unsubscribe/route.ts");
const hookRoute = await load("app/api/resend/webhook/route.ts");
const actions = await load("app/admin/email/actions.ts");

let failures = 0;
let passed = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail && !ok ? `  (${detail})` : ""}`);
  if (ok) passed++;
  else failures++;
};
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(label, ok, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const DAY = 86_400_000;
const HOUR = 3_600_000;
const cdt = (date, time) => new Date(`${date}T${time}:00-05:00`);
const cst = (date, time) => new Date(`${date}T${time}:00-06:00`);

// ===================== 1. caps =====================
{
  const at = cdt("2026-10-15", "15:00"); // Thursday
  const lineupTue = { c: "L", t: cdt("2026-10-13", "10:30").toISOString(), k: "lineup", a: null, g: "lineup", x: null, s: "delivered", ck: false };
  const eventMon = { c: "E", t: cdt("2026-10-12", "10:30").toISOString(), k: "event", a: null, g: "events", x: null, s: "delivered", ck: false };
  const member = { createdAt: "2026-01-01T00:00:00Z", imported: true };
  const event = { id: "N", kind: "event", category: "events", automation: null };
  const offer = { id: "O", kind: "offer", category: "offers", automation: null };
  eq("caps: an extra after only the lineup this week is fine", rules.capCheck([lineupTue], event, at, member), null);
  eq("caps: a second extra in the same 7 days is refused", rules.capCheck([eventMon], event, at, member), "cap_extra");
  eq("caps: a third email in 7 days is refused", rules.capCheck([lineupTue, eventMon], offer, at, member), "cap_week");
  eq("caps: two within 20 hours are refused", rules.capCheck([{ ...lineupTue, t: new Date(at.getTime() - 19 * HOUR).toISOString() }], event, at, member), "cap_day");
  eq("caps: 21 hours apart is fine", rules.capCheck([{ ...lineupTue, t: new Date(at.getTime() - 21 * HOUR).toISOString() }], event, at, member), null);
  eq("caps: account emails (the invite) are never held back", rules.capCheck([lineupTue, eventMon], { id: "I", kind: "invite", category: "account", automation: null }, at, member), null);
  eq("caps: account emails don't count against the week", rules.capCheck([{ ...eventMon, k: "invite", g: "account" }], event, at, member), null);
  eq("caps: a held-back row doesn't count", rules.capCheck([{ ...eventMon, s: "held_out" }], event, at, member), null);
  const fresh = { createdAt: new Date(at.getTime() - 3 * DAY).toISOString(), imported: false };
  const welcome2 = { id: "W", kind: "automation", category: "rewards", automation: "welcome_2" };
  const welcome1Sent = { c: "W1", t: new Date(at.getTime() - 3 * DAY).toISOString(), k: "automation", a: "welcome_1", g: "rewards", x: null, s: "delivered", ck: false };
  eq("caps: welcome skips the extra cap in a new member's first 14 days", rules.capCheck([welcome1Sent], welcome2, at, fresh), null);
  eq("caps: ...but not after 14 days", rules.capCheck([welcome1Sent], welcome2, at, { createdAt: new Date(at.getTime() - 20 * DAY).toISOString(), imported: false }), "cap_extra");
  const month = Array.from({ length: 8 }, (_, i) => ({ ...lineupTue, c: `m${i}`, t: new Date(at.getTime() - (i * 3 + 25) * DAY).toISOString() }));
  eq("caps: under 8 in 30 days is fine", rules.capCheck(month.filter((s) => Date.parse(s.t) > at.getTime() - 30 * DAY), event, at, member), null);
  const eight = Array.from({ length: 8 }, (_, i) => ({ ...lineupTue, c: `n${i}`, k: "lineup", t: new Date(at.getTime() - (8 + i * 2.5) * DAY).toISOString() }));
  eq("caps: a ninth in 30 days is refused", rules.capCheck(eight, { id: "Z", kind: "lineup", category: "lineup", automation: null }, at, member), "cap_month");
  const tonight = { id: "T", kind: "alert", category: "alerts", automation: null, alert: "tonight" };
  const tonights = [8, 16].map((d) => ({ ...lineupTue, c: `t${d}`, k: "alert", g: "alerts", x: "tonight", t: new Date(at.getTime() - d * DAY).toISOString() }));
  eq("caps: a third tonight alert in 30 days is refused", rules.capCheck(tonights, tonight, at, member), "cap_kind");
  const offerSent = { ...lineupTue, c: "o1", k: "offer", g: "offers", t: new Date(at.getTime() - 12 * DAY).toISOString() };
  eq("caps: a second offer in 30 days is refused", rules.capCheck([offerSent], offer, at, member), "cap_kind");
  check("caps: fitsWindow counts a send scheduled later today too", !rules.fitsWindow([at.getTime() + 2 * HOUR, at.getTime() - 2 * DAY], at.getTime(), 7, 2));
}

// ===================== send windows =====================
{
  const slot = (d) => timing.nextSendSlot(d).toISOString();
  eq("window: Wednesday noon stays", slot(cdt("2026-10-14", "12:00")), cdt("2026-10-14", "12:00").toISOString());
  eq("window: Tuesday 8 AM moves to 10:30 the same day", slot(cdt("2026-10-13", "08:00")), cdt("2026-10-13", "10:30").toISOString());
  eq("window: Friday 7:30 PM moves to Saturday 10:30", slot(cdt("2026-10-16", "19:30")), cdt("2026-10-17", "10:30").toISOString());
  eq("window: Saturday 8 PM skips Sunday to Monday 10:30", slot(cdt("2026-10-17", "20:00")), cdt("2026-10-19", "10:30").toISOString());
  eq("window: Sunday noon moves to Monday 10:30", slot(cdt("2026-10-18", "12:00")), cdt("2026-10-19", "10:30").toISOString());
  eq("window: across the clocks going back (Sun Nov 1) lands Monday 10:30 CST", slot(cst("2026-11-01", "12:00")), cst("2026-11-02", "10:30").toISOString());
  check("window: 6:59 PM is inside, 7:00 PM isn't", timing.inSendWindow(cdt("2026-10-14", "18:59")) && !timing.inSendWindow(cdt("2026-10-14", "19:00")));
  check("window: 8:59 AM isn't, 9:00 AM is", !timing.inSendWindow(cdt("2026-10-14", "08:59")) && timing.inSendWindow(cdt("2026-10-14", "09:00")));
  eq("lineup slot: from a Monday, the next day at 10:30", timing.nextLineupSlot(cdt("2026-10-12", "09:00")).at.toISOString(), cdt("2026-10-13", "10:30").toISOString());
  eq("lineup slot: from Tuesday 11 AM, next Tuesday", timing.nextLineupSlot(cdt("2026-10-13", "11:00")).date, "2026-10-20");
}

// ===================== segment rules =====================
const facts = (over = {}) => ({
  memberId: randomUUID(),
  email: "sam@example.com",
  emailHash: hash.hashEmail("sam@example.com"),
  name: "Sam",
  tier: "Insiders",
  legacyPlus: false,
  imported: true,
  fromOldSite: true,
  hasLogin: false,
  hasPhone: true,
  createdAt: "2026-09-25T12:00:00Z",
  birthday: null,
  emailOptIn: true,
  prefs: { lineup: true, alerts: true, events: true, offers: true, rewards: true },
  pausedUntil: null,
  consentSource: "old_site_import",
  importGroup: null,
  engagement: "active",
  reconfirmSentAt: null,
  lastEngagedAt: null,
  suppressed: null,
  visitDays: [],
  archiveDays: [],
  firstVisitOn: null,
  lastVisitOn: null,
  tickets: [],
  orders: [],
  lastClickAt: null,
  sends: [],
  deliveredSinceEngaged: 0,
  inviteDelivered: false,
  ...over,
});
{
  const now = cdt("2026-10-15", "12:00");
  const ctx = { now, today: "2026-10-15" };
  const m = (f, r) => rules.matchesRule(facts(f), r, ctx);
  check("rule: tier Insiders+ only matches Insiders+", m({ tier: "Insiders+" }, { r: "tier", v: "Insiders+" }) && !m({}, { r: "tier", v: "Insiders+" }));
  check("rule: consent source", m({ consentSource: "indy_yes" }, { r: "consent", v: ["indy_yes"] }) && !m({}, { r: "consent", v: ["indy_yes"] }));
  check("rule: regulars = 3+ visit days in 30", m({ visitDays: ["2026-10-01", "2026-10-08", "2026-10-14"] }, { r: "visit_days", within: 30, min: 3 }) && !m({ visitDays: ["2026-10-01", "2026-10-08", "2026-09-01"] }, { r: "visit_days", within: 30, min: 3 }));
  check("rule: lapsed 45 = came before, nothing for 45 days", m({ lastVisitOn: "2026-08-20", firstVisitOn: "2026-08-01" }, { r: "lapsed", days: 45 }) && !m({ lastVisitOn: "2026-09-20" }, { r: "lapsed", days: 45 }) && !m({}, { r: "lapsed", days: 45 }));
  check("rule: never visited", m({}, { r: "never_visited" }) && !m({ firstVisitOn: "2026-10-01" }, { r: "never_visited" }));
  check("rule: birthday this week (and Dec 30 -> Jan 2 wraps)", m({ birthday: "2000-10-19" }, { r: "birthday_within", days: 7 }) && rules.birthdayWithin("2000-01-02", "2026-12-30", 7) && !m({ birthday: "2000-10-25" }, { r: "birthday_within", days: 7 }));
  check("rule: Feb 29 birthdays count on Feb 28", rules.birthdayWithin("2000-02-29", "2027-02-28", 1));
  const t = (d, q, p) => ({ d: new Date(now.getTime() - d * DAY).toISOString(), q, p });
  check("rule: 2+ paid tickets in 30 days (free ones don't count)", m({ tickets: [t(3, 1, 8), t(10, 1, 8)] }, { r: "paid_tickets", within: 30, min: 2 }) && !m({ tickets: [t(3, 1, 8), t(10, 3, 0)] }, { r: "paid_tickets", within: 30, min: 2 }));
  const o = (d, c) => ({ d: new Date(now.getTime() - d * DAY).toISOString(), a: false, c, f: false, t: 5 });
  check("rule: coffee regulars", m({ orders: [o(2, true), o(9, true)] }, { r: "bar", v: "coffee", within: 30, min: 2 }) && !m({ orders: [o(2, true), o(9, false)] }, { r: "bar", v: "coffee", within: 30, min: 2 }));
  check("rule: engaged = a click or a visit within N days", m({ lastClickAt: new Date(now.getTime() - 5 * DAY).toISOString() }, { r: "engaged", days: 60 }) && !m({}, { r: "engaged", days: 60 }));
  check("rule: Indy returners = said yes, never had an old-site account", m({ consentSource: "indy_yes", fromOldSite: false }, rules.PRESETS.find((p) => p.key === "indy_returners").audience.include[1]));
  check("audience: include AND-ed, minus exclude", rules.matchesAudience(facts({ tier: "Insiders", legacyPlus: true }), { include: [{ r: "legacy_plus" }, { r: "tier", v: "Insiders" }], exclude: [{ r: "has_login", v: true }] }, ctx));
  check("sunset: old-site import, invite + 4 delivered, no engagement -> due", rules.sunsetDue(facts({ inviteDelivered: true, deliveredSinceEngaged: 5 }), now) && !rules.sunsetDue(facts({ inviteDelivered: true, deliveredSinceEngaged: 3 }), now));
  check("sunset: 10+ since engaging over 90 days ago -> due", rules.sunsetDue(facts({ consentSource: "indy_yes", deliveredSinceEngaged: 10, lastEngagedAt: new Date(now.getTime() - 100 * DAY).toISOString() }), now));
  eq("warm-up order: join form, kiosk, claim, Indy+paid, Indy, old-site paying, likely real, unknown, review, Indy no", [
    rules.trustRank({ consentSource: "join_form" }),
    rules.trustRank({ consentSource: "kiosk" }),
    rules.trustRank({ consentSource: "claim" }),
    rules.trustRank({ consentSource: "indy_yes", legacyPlus: true }),
    rules.trustRank({ consentSource: "indy_yes", legacyPlus: false }),
    rules.trustRank({ consentSource: "old_site_import", legacyPlus: true }),
    rules.trustRank({ consentSource: "old_site_import", importGroup: "likely_real" }),
    rules.trustRank({ consentSource: "unknown" }),
    rules.trustRank({ consentSource: "old_site_import", importGroup: "review" }),
    rules.trustRank({ consentSource: "indy_no" }),
  ], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
}

// ===================== 2. prefs, pause, dormant =====================
{
  const now = new Date();
  const lineup = { id: "c", kind: "lineup", category: "lineup", automation: null };
  eq("prefs: category off -> excluded", rules.hardFilter(facts({ prefs: { lineup: false, alerts: true, events: true, offers: true, rewards: true } }), lineup, now), "pref_off");
  eq("prefs: paused -> excluded", rules.hardFilter(facts({ pausedUntil: new Date(now.getTime() + DAY).toISOString() }), lineup, now), "paused");
  eq("prefs: a pause that ended doesn't count", rules.hardFilter(facts({ pausedUntil: new Date(now.getTime() - DAY).toISOString() }), lineup, now), null);
  eq("prefs: dormant -> excluded", rules.hardFilter(facts({ engagement: "dormant" }), lineup, now), "dormant");
  eq("prefs: ...except from \"Still want these?\"", rules.hardFilter(facts({ engagement: "dormant" }), { id: "r", kind: "reconfirm", category: "account", automation: "reconfirm" }, now), null);
  eq("prefs: email off -> excluded", rules.hardFilter(facts({ emailOptIn: false }), lineup, now), "opted_out");
  eq("prefs: a malformed address is left out (it would fail the whole batch)", rules.hardFilter(facts({ email: "sam@example" }), lineup, now), "bad_address");
}

// ===================== 3. suppression by hash =====================
{
  check("hash: case and spaces don't matter", hash.hashEmail("  Sam@Example.COM ") === hash.hashEmail("sam@example.com"));
  check("hash: 64 hex characters, no address in it", /^[0-9a-f]{64}$/.test(hash.hashEmail("sam@example.com")));
  await consent.suppressHash(hash.hashEmail("gone@example.com"), "hard_bounce");
  await consent.suppressHash(hash.hashEmail("gone@example.com"), "manual");
  eq("suppression: a weaker reason doesn't replace a hard bounce", db.email_suppressions.find((s) => s.email_hash === hash.hashEmail("gone@example.com")).reason, "hard_bounce");
  check("suppression: stored without any address", !JSON.stringify(db.email_suppressions).includes("@"));
}

// ===================== 4. holdout =====================
{
  const campaign = randomUUID();
  const ids = Array.from({ length: 10000 }, () => randomUUID());
  const held = ids.filter((id) => hash.isHeldOut(id, campaign, 10)).length;
  check("holdout: about 10% of 10,000", held > 850 && held < 1150, String(held));
  check("holdout: the same answer every time", ids.slice(0, 200).every((id) => hash.isHeldOut(id, campaign, 10) === hash.isHeldOut(id, campaign, 10)));
  check("holdout: 0% holds nobody", ids.every((id) => !hash.isHeldOut(id, campaign, 0)));
}

// ===================== tokens and headers =====================
{
  const memberId = randomUUID();
  const sendId = randomUUID();
  const t = tokens.sealEmailToken({ memberId, sendId });
  check("token: 66 characters of base64url", /^[A-Za-z0-9_-]{66}$/.test(t ?? ""), t);
  eq("token: opens to the same member and send", tokens.openEmailToken(t), { memberId, sendId });
  eq("token: without a send", tokens.openEmailToken(tokens.sealEmailToken({ memberId, sendId: null })), { memberId, sendId: null });
  let tampered = 0;
  const raw = Buffer.from(t, "base64url");
  for (let i = 0; i < raw.length; i++) {
    const b = Buffer.from(raw);
    b[i] ^= 1;
    if (tokens.openEmailToken(b.toString("base64url")) === null) tampered++;
  }
  eq("token: flipping any bit breaks it", tampered, raw.length);
  eq("token: junk opens to null", [tokens.openEmailToken(""), tokens.openEmailToken(null), tokens.openEmailToken("x".repeat(66)), tokens.openEmailToken(`${t}A`)], [null, null, null, null]);
  const saved = process.env.EMAIL_TOKEN_SECRET;
  process.env.EMAIL_TOKEN_SECRET = randomBytes(32).toString("base64url");
  eq("token: another secret doesn't open it", tokens.openEmailToken(t), null);
  delete process.env.EMAIL_TOKEN_SECRET;
  eq("token: no secret, no tokens (so nothing can go without an unsubscribe link)", tokens.sealEmailToken({ memberId, sendId }), null);
  process.env.EMAIL_TOKEN_SECRET = saved;
  const h = tokens.listUnsubscribeHeaders(t);
  eq("headers: List-Unsubscribe is our one-click address in angle brackets", h["List-Unsubscribe"], `<${SITE_URL}/api/email/unsubscribe?t=${t}>`);
  eq("headers: List-Unsubscribe-Post is RFC 8058's exact value", h["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  check("headers: no address in either", !JSON.stringify(h).includes("@"));
  check("prefs link carries #all for Unsubscribe", tokens.preferencesUrl(t, "all").endsWith(`/email/preferences?t=${t}#all`));
}

// ===================== 8. MPLC lint and rendering =====================
const films = [
  { movieId: "m-new", title: "The Incomer", posterUrl: null, rating: "R", runtime: 110, archive: false, showtimes: [{ id: randomUUID(), startsAt: cdt("2026-10-16", "19:00").toISOString() }] },
  { movieId: "m-old", title: "The Texas Chain Saw Massacre", posterUrl: null, rating: "R", runtime: 83, archive: true, showtimes: [{ id: randomUUID(), startsAt: cdt("2026-10-16", "23:59").toISOString() }] },
];
const data = { range: { start: "2026-10-13", days: 7 }, films, happenings: [{ id: randomUUID(), title: "Horror trivia", note: "Teams of six", startsAt: cdt("2026-10-13", "19:00").toISOString() }], menuItems: [] };
const links = { preferencesUrl: `${SITE_URL}/email/preferences?t=TOKEN`, unsubscribeUrl: `${SITE_URL}/email/preferences?t=TOKEN#all`, href: (u) => u };
const recipient = { firstName: "Sam", consentSource: "indy_yes", tier: "Insiders", hasLogin: false, email: null, claimUrl: null };
{
  const restricted = ["The Texas Chain Saw Massacre", "Jaws", "It"];
  const base = { preheader: "One showing", bodyTexts: [], primaryButtons: 1, plainFilmTitles: [], restrictedTitles: restricted, htmlBytes: 1000 };
  check("lint: an archive title in the subject is refused", lintMod.lintCampaign({ ...base, subject: "Tonight: the texas chain-saw massacre!" }).errors.length === 1);
  check("lint: ...and in the preview text", lintMod.lintCampaign({ ...base, subject: "Tonight", preheader: "Jaws at midnight" }).errors.length === 1);
  check("lint: a word that merely contains a title isn't flagged", lintMod.lintCampaign({ ...base, subject: "Jawsome deals" }).errors.length === 0);
  check("lint: a very short title only warns", lintMod.lintCampaign({ ...base, subject: "It is trivia night" }).errors.length === 0 && lintMod.lintCampaign({ ...base, subject: "It is trivia night" }).warnings.some((w) => w.includes('"It"')));
  check("lint: an archive film in a plain card is refused", lintMod.lintCampaign({ ...base, subject: "Hi", plainFilmTitles: [{ title: "Jaws", archive: true }] }).errors.length === 1);
  check("lint: over 100 KB is refused, over 90 KB warns", lintMod.lintCampaign({ ...base, subject: "Hi", htmlBytes: 101 * 1024 }).errors.length === 1 && lintMod.lintCampaign({ ...base, subject: "Hi", htmlBytes: 95 * 1024 }).warnings.length === 1);
  check("lint: ALL CAPS, two !, two main buttons and no preview text warn", lintMod.lintCampaign({ ...base, subject: "DON'T MISS OUT NOW!!", preheader: "", primaryButtons: 2 }).warnings.length === 4);

  const lineup = { kind: "lineup", category: "lineup", subject: "", preheader: "", content: { lineup: { start: "2026-10-13", days: 7, skipMovieIds: [], skipHappeningIds: [] }, blocks: [{ t: "paragraph", text: "Hi {first name}," }, { t: "lineup" }, { t: "signoff" }] } };
  const r = render.renderCampaign(lineup, data, recipient, links);
  check("render: the default subject names only this year's titles", r.subject.includes("The Incomer") && !r.subject.includes("Chain Saw"));
  check("render: the default preview text has no archive title", !r.preheader.includes("Chain Saw"));
  const archiveAt = r.html.indexOf("From the film archive");
  check("render: the archive film is only inside the archive section, after its note", archiveAt > 0 && r.html.indexOf("Texas Chain Saw") > archiveAt && r.html.indexOf(render.ARCHIVE_NOTE.slice(0, 40)) > archiveAt);
  check("render: every email has the street address", r.html.includes("715 E Broadway") && r.html.includes("Joplin, MO 64801") && r.text.includes("715 E Broadway"));
  check("render: ...and the unsubscribe and preferences links, in HTML and text", r.html.includes(`${SITE_URL}/email/preferences?t=TOKEN#all`) && r.text.includes("Unsubscribe: ") && r.html.includes("Email preferences"));
  check("render: the CAN-SPAM ad line on marketing, not on account email", r.html.includes("A promotional email from Royale Cinema Lounge") && !render.renderCampaign({ ...lineup, kind: "invite", category: "account" }, data, recipient, links).html.includes("A promotional email"));
  check("render: no view-in-browser or forward link", !/view (it )?in (your )?browser|forward to a friend/i.test(r.html));
  check("render: the first name fills in, and the house event gets a calendar link", r.html.includes("Hi Sam,") && r.html.includes("/api/calendar/"));
  const card = render.renderCampaign({ kind: "alert", category: "alerts", subject: "Tonight", preheader: "x", content: { blocks: [{ t: "filmCard", movieId: "m-old" }] } }, data, recipient, links);
  check("render: an archive film in a film card still lands in the archive section", card.html.indexOf("From the film archive") > 0 && card.html.indexOf("From the film archive") < card.html.indexOf("Texas Chain Saw") && card.meta.containsArchive);
  const evil = render.renderCampaign({ kind: "announcement", category: "events", subject: "Hi {first name}", preheader: "", content: { blocks: [{ t: "paragraph", text: "<script>alert(1)</script>" }, { t: "button", label: "Go", link: "javascript:alert(1)" }] } }, data, { ...recipient, firstName: format.firstNameOf('<b>Sam</b> "x"') }, links);
  check("render: typed text is escaped and odd links become the showtimes page", !evil.html.includes("<script>alert") && !evil.html.includes("javascript:") && evil.html.includes(`${SITE_URL}/showtimes`));
  eq("first name: stripped of markup, capitalised, 'there' when missing", [format.firstNameOf("SAM jones"), format.firstNameOf("<i>"), format.firstNameOf("Removed member"), format.applyFirstName("Hi {first name},", null), format.applyFirstName("{first name}, it's your week.", null)], ["Sam", "I", null, "Hi there,", "It's your week."]);
}

// ===================== 5. sending: batches, retries, idempotency =====================
const mkMember = (i, over = {}) => {
  const m = { id: randomUUID(), name: `Member ${i}`, email: `member${i}@example.com`, tier: "Insiders", email_opt_in: true, erased_at: null, created_at: "2026-09-25T12:00:00Z", legacy_user_id: 1000 + i, auth_user_id: null, phone: "(417) 555-0100", ...over };
  db.members.push(m);
  return m;
};
const mkCampaign = (over = {}) => {
  const c = {
    id: randomUUID(),
    kind: "event",
    automation: null,
    category: "events",
    name: "Trivia",
    subject: "Trivia, two Tuesdays",
    preheader: "7 PM",
    content: { blocks: [{ t: "paragraph", text: "Hi {first name}" }, { t: "button", label: "See it", link: "/showtimes" }, { t: "signoff" }] },
    audience: { include: [{ r: "all" }] },
    holdout_pct: 0,
    status: "scheduled",
    scheduled_for: null,
    send_key: null,
    lineup_start: null,
    contains_archive: false,
    links: [],
    recipients: null,
    held_out: null,
    excluded: {},
    locked_until: null,
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    sent_at: null,
    ...over,
  };
  db.email_campaigns.push(c);
  return c;
};
setLineup({ films, happenings: [] });
{
  const members = Array.from({ length: 5 }, (_, i) => mkMember(i));
  db.member_email_prefs.push({ member_id: members[1].id, lineup: true, alerts: true, events: false, offers: true, rewards: true, consent_source: "indy_yes", engagement: "active" });
  db.email_suppressions.push({ email_hash: hash.hashEmail(members[2].email), reason: "complaint", first_at: new Date().toISOString(), last_at: new Date().toISOString() });
  const c = mkCampaign();
  resend.acceptThenFail = 1; // Resend takes the batch, but the answer is lost
  const r1 = await sender.runCampaign(c.id, Date.now() + 30_000);
  const mine = () => db.email_sends.filter((s) => s.campaign_id === c.id);
  eq("send: 3 of 5 go (events off and a complaint are left out)", mine().filter((s) => s.resend_email_id).length, 3);
  eq("send: a lost answer is retried with the same key: Resend sent 3, not 6", resend.sent.length, 3);
  eq("send: one batch", resend.batches, 1);
  eq("send: the campaign is sent", [r1.status, db.email_campaigns.find((x) => x.id === c.id).status], ["sent", "sent"]);
  eq("send: exclusions counted by reason", Object.entries(db.email_campaigns.find((x) => x.id === c.id).excluded).sort(), [["pref_off", 1], ["suppressed", 1]]);
  const item = resend.sent[0];
  check("send: each email has the one-click headers, reply-to and tags", item.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click" && item.reply_to === "info@royalecinemajoplin.com" && item.tags.some((t) => t.name === "send"));
  check("send: links are tracked through our own /e/ route", item.html.includes(`${SITE_URL}/e/`) && !item.html.includes('href="https://rcl-app.vercel.app/showtimes"'));
  check("send: one person per email, never a list in To", resend.sent.every((e) => e.to.length === 1));
  await sender.runCampaign(c.id, Date.now() + 30_000);
  eq("send: running it again sends nothing more", resend.sent.length, 3);

  // A batch that failed outright is retried later with the same key, once.
  const c2 = mkCampaign({ name: "Second", kind: "invite", category: "account" }); // account email: no caps
  resend.failNext = 2;
  await sender.runCampaign(c2.id, Date.now() + 30_000);
  // Account email ignores category choices, so 4 (only the complaint is left out).
  eq("send: after two failures the same batch goes once", [resend.batches, db.email_sends.filter((s) => s.campaign_id === c2.id && s.resend_email_id).length], [2, 4]);
  check("send: the batch's key is <campaign>:<batch>:<stamp>, the same on the retry", [...resend.keys.keys()].filter((k) => k.startsWith(`${c2.id}:1:`)).length === 1);

  // Two runs at once: only one takes the lease.
  const c3 = mkCampaign({ name: "Third", kind: "reconfirm", category: "account" });
  const before = resend.sent.length;
  const [a, b] = await Promise.all([sender.runCampaign(c3.id, Date.now() + 30_000), sender.runCampaign(c3.id, Date.now() + 30_000)]);
  eq("send: two runs at once, one works (the other finds it taken)", [a.ran, b.ran].filter(Boolean).length, 1);
  check("send: ...and nobody gets it twice", resend.sent.length - before === 4 && new Set(resend.sent.slice(before).map((e) => e.to[0])).size === 4, String(resend.sent.length - before));

  // The kill switch.
  process.env.EMAIL_SENDING_ENABLED = "false";
  const c4 = mkCampaign({ name: "Blocked" });
  const r4 = await sender.runCampaign(c4.id, Date.now() + 30_000);
  eq("kill switch: nothing goes, the campaign stays scheduled with a reason", [r4.ran, db.email_campaigns.find((x) => x.id === c4.id).status, !!db.email_campaigns.find((x) => x.id === c4.id).error], [false, "scheduled", true]);
  process.env.EMAIL_SENDING_ENABLED = "true";
  process.env.EMAIL_FROM = "Royale <onboarding@resend.dev>";
  check("kill switch: a @resend.dev sender refuses list email", !(await sender.sendingGate()).ok);
  process.env.EMAIL_FROM = "Royale Cinema Lounge <hello@royalecinemajoplin.com>";
  db.email_campaigns.splice(db.email_campaigns.findIndex((x) => x.id === c4.id), 1);

  // A double "Schedule" with the same send key.
  const draft = mkCampaign({ name: "Draft", status: "draft" });
  const key = randomUUID();
  const day = new Date(Date.now() + 3 * DAY).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const s1 = await actions.scheduleCampaign(draft.id, { when: "at", date: day, time: "10:30", sendKey: key });
  const s2 = await actions.scheduleCampaign(draft.id, { when: "at", date: day, time: "10:30", sendKey: key });
  check("schedule: a double click with the same key reports the first", s1.ok && s2.ok && /Already/.test(s2.message ?? ""), JSON.stringify([s1, s2]));
  const s3 = await actions.scheduleCampaign(draft.id, { when: "at", date: day, time: "10:30", sendKey: randomUUID() });
  check("schedule: a second, different request is refused (already scheduled)", !s3.ok);
  const archiveDraft = mkCampaign({ name: "Bad", status: "draft", subject: "Tonight: The Texas Chain Saw Massacre" });
  db.movies.push({ id: "m-old", title: "The Texas Chain Saw Massacre", release_year: 1974 }, { id: "m-new", title: "The Incomer", release_year: new Date().getFullYear() });
  const s4 = await actions.scheduleCampaign(archiveDraft.id, { when: "at", date: day, time: "10:30", sendKey: randomUUID() });
  check("schedule: an archive title in the subject blocks scheduling", !s4.ok && /archive title/.test(s4.error ?? ""), JSON.stringify(s4));
}

// ===================== 5b. hand-over: window, caps, age, lost answers, odd addresses, stops =====================
const mkQueued = (c, m, over = {}) => {
  const row = {
    id: randomUUID(),
    campaign_id: c.id,
    member_id: m.id,
    status: "queued",
    dedupe_key: null,
    deliver_at: new Date().toISOString(),
    batch_no: null,
    batch_key: null,
    batch_at: null,
    resend_email_id: null,
    submitted_at: null,
    delivered_at: null,
    first_opened_at: null,
    opens: 0,
    first_clicked_at: null,
    last_clicked_at: null,
    clicks: 0,
    bounced_at: null,
    bounce_type: null,
    complained_at: null,
    unsubscribed_at: null,
    error: null,
    created_at: new Date().toISOString(),
    ...over,
  };
  db.email_sends.push(row);
  return row;
};
const automations = await load("lib/email/automations.ts");
{
  const eff = (planned, now) => sender.effectiveDeliverAt(planned, now).toISOString();
  eq("hand-over: Tuesday's 10:30 email still queued at Wednesday's 8 AM run goes Wednesday 10:30, not at 8", eff(cdt("2026-10-13", "10:30").toISOString(), cdt("2026-10-14", "08:00")), cdt("2026-10-14", "10:30").toISOString());
  eq("hand-over: Saturday 6:55 PM's leftovers wait for Monday 10:30 (never Sunday)", eff(cdt("2026-10-17", "18:55").toISOString(), cdt("2026-10-17", "19:10")), cdt("2026-10-19", "10:30").toISOString());
  eq("hand-over: a time still ahead stays as it is", eff(cdt("2026-10-15", "15:00").toISOString(), cdt("2026-10-15", "09:00")), cdt("2026-10-15", "15:00").toISOString());

  // A row whose time passed days ago (a paused list, a switch turned back on).
  const m = mkMember(100);
  const c = mkCampaign({ name: "Stale", recipients: 1 });
  const row = mkQueued(c, m, { deliver_at: new Date(Date.now() - 3 * DAY).toISOString() });
  const before = resend.sent.length;
  await sender.runCampaign(c.id, Date.now() + 30_000);
  const item = resend.sent.slice(before).find((e) => e.tags.some((t) => t.value === row.id));
  const lands = item?.scheduled_at ? new Date(item.scheduled_at) : new Date();
  check("hand-over: an old queued row still arrives inside 9 AM to 7 PM, Monday to Saturday", !!item && timing.inSendWindow(lands), JSON.stringify(item?.scheduled_at ?? null));
  check("hand-over: ...and its deliver_at becomes the real arrival time (so the caps see it)", Date.parse(db.email_sends.find((s) => s.id === row.id).deliver_at) >= Date.now() - 5 * 60_000);

  // The caps, again at hand-over: another email reached them 2 hours ago.
  const m2 = mkMember(101);
  const other = mkCampaign({ name: "Earlier today", status: "sent" });
  mkQueued(other, m2, { status: "delivered", deliver_at: new Date(Date.now() - 2 * HOUR).toISOString(), submitted_at: new Date(Date.now() - 2 * HOUR).toISOString() });
  const capped = mkCampaign({ name: "Capped at hand-over", recipients: 1 });
  const cappedRow = mkQueued(capped, m2, { deliver_at: new Date(Date.now() - DAY).toISOString() });
  const before2 = resend.sent.length;
  await sender.runCampaign(capped.id, Date.now() + 30_000);
  const cr = db.email_sends.find((s) => s.id === cappedRow.id);
  check("hand-over: the caps are checked again against what they've had since: held back, not sent", cr.status === "cancelled" && /Held back/.test(cr.error ?? "") && resend.sent.length === before2, JSON.stringify(cr));

  const upsell = { id: "U", kind: "automation", category: "offers", automation: "plus_upsell" };
  const upsellSent = { c: "U", t: new Date(Date.now() - 30 * DAY).toISOString(), k: "automation", a: "plus_upsell", g: "offers", x: null, s: "delivered", ck: false };
  eq("caps: an automation's own earlier send counts (the upsell's 1 in 60 days)", rules.capCheck([upsellSent], upsell, new Date(), { createdAt: "2026-01-01T00:00:00Z", imported: true }), "cap_kind");
  eq("upsell: someone held back stays held back (not a new held-back row every day)", automations.automationKey("plus_upsell", facts({ sends: [{ ...upsellSent, s: "held_out" }] }), new Date(), "2026-10-15"), null);

  // An automated email days late is dropped.
  const m3 = mkMember(102);
  const bday = mkCampaign({ name: "Birthday", kind: "automation", automation: "birthday", category: "rewards", status: "active" });
  const old = mkQueued(bday, m3, { dedupe_key: "birthday:2026", created_at: new Date(Date.now() - 3 * DAY).toISOString() });
  const before3 = resend.sent.length;
  await sender.runCampaign(bday.id, Date.now() + 30_000);
  check("automation: a birthday email queued 3 days ago is dropped, not sent late", db.email_sends.find((s) => s.id === old.id).status === "cancelled" && resend.sent.length === before3);

  // Welcome while sending is switched off: nothing queues.
  const w = mkCampaign({ name: "Welcome", kind: "automation", automation: "welcome_1", category: "rewards", status: "active" });
  const m4 = mkMember(112);
  process.env.EMAIL_SENDING_ENABLED = "false";
  const queued = await automations.queueWelcome(m4.id);
  process.env.EMAIL_SENDING_ENABLED = "true";
  check("welcome: nothing queues while sending is off (so switching it on can't fire days-old welcomes)", queued === false && !db.email_sends.some((s) => s.campaign_id === w.id));
  w.status = "off";
}
{
  // A batch Resend may have taken, unconfirmed for over 20 hours.
  const m = mkMember(103);
  const c = mkCampaign({ name: "Lost answer", recipients: 1 });
  const row = mkQueued(c, m, { batch_no: 1, batch_key: `${c.id}:1:old`, batch_at: new Date(Date.now() - 21 * HOUR).toISOString(), deliver_at: new Date(Date.now() - 21 * HOUR).toISOString() });
  const before = resend.sent.length;
  const r = await sender.runCampaign(c.id, Date.now() + 30_000);
  const s = db.email_sends.find((x) => x.id === row.id);
  check("idempotency: a batch unconfirmed for over 20 hours isn't sent again (Resend forgets a key after 24)", resend.sent.length === before && s.status === "submitted" && s.error === sender.UNSURE, JSON.stringify(s));
  check("idempotency: ...and the Back office says so", /20 hours/.test(r.note ?? "") && /20 hours/.test(db.email_campaigns.find((x) => x.id === c.id).error ?? ""));
}
{
  // One address Resend refuses (422) in a batch.
  const good = [mkMember(104), mkMember(105)];
  const bad = mkMember(106, { email: "reject-me@example.com" });
  const c = mkCampaign({ name: "Odd address", kind: "invite", category: "account", recipients: 3 });
  for (const m of [...good, bad]) mkQueued(c, m);
  const before = resend.sent.length;
  const r = await sender.runCampaign(c.id, Date.now() + 30_000);
  const st = (m) => db.email_sends.find((s) => s.campaign_id === c.id && s.member_id === m.id);
  check("split: one address Resend refuses doesn't block the batch: the others go, one by one", resend.sent.length - before === 2 && good.every((m) => ["submitted", "scheduled"].includes(st(m).status)), JSON.stringify(good.map((m) => st(m).status)));
  check("split: only the refused one is marked failed, and the email isn't paused", st(bad).status === "failed" && r.status === "sent", JSON.stringify([st(bad).status, r.status, r.note]));
  check("split: the stored refusal holds no address", !(st(bad).error ?? "").includes("@"));
  check("split: each one alone went under its own key", [...resend.keys.keys()].filter((k) => k.startsWith(`${c.id}:`) && k.includes(":split:")).length === 2);
}
{
  // Paused from elsewhere mid-run: no more batches.
  const ms = Array.from({ length: 120 }, (_, i) => mkMember(200 + i));
  const c = mkCampaign({ name: "Stopped mid-run", kind: "invite", category: "account", recipients: 120 });
  for (const m of ms) mkQueued(c, m);
  resend.onBatch = () => {
    db.email_campaigns.find((x) => x.id === c.id).status = "paused";
    resend.onBatch = null;
  };
  const before = resend.sent.length;
  await sender.runCampaign(c.id, Date.now() + 60_000);
  const left = db.email_sends.filter((s) => s.campaign_id === c.id && s.status === "queued").length;
  check("stop: a campaign paused mid-run gets no more batches (100 went, 20 wait)", resend.sent.length - before === 100 && left === 20 && db.email_campaigns.find((x) => x.id === c.id).status === "paused", JSON.stringify([resend.sent.length - before, left]));
}
{
  // Calling back email waiting at Resend (a guardrail, "Stop all sending").
  const m = mkMember(107);
  const c = mkCampaign({ name: "Waiting at Resend", status: "sent" });
  const row = mkQueued(c, m, { status: "scheduled", resend_email_id: "re_waiting", batch_no: 1, batch_key: "k", deliver_at: new Date(Date.now() + 3 * HOUR).toISOString() });
  const r = await sender.recallScheduledSends("Guardrail: test.");
  const s = db.email_sends.find((x) => x.id === row.id);
  check("recall: email waiting at Resend is cancelled there and put back in the queue", resend.cancelled.includes("re_waiting") && s.status === "queued" && !s.resend_email_id && !s.batch_key && r.recalled >= 1, JSON.stringify(r));
  check("recall: its email is paused until an admin resumes", db.email_campaigns.find((x) => x.id === c.id).status === "paused");
  const stop = await actions.stopAllSending("Testing the stop");
  check("stop all: sets the pause every run checks", stop.ok && !!(await sender.guardrailPause()));
  const resumed = await actions.resumeAllSending("Checked the test");
  check("stop all: resuming clears it", resumed.ok && !(await sender.guardrailPause()));
}
{
  // Scheduling a time later today hands it over now, set to arrive then.
  const nowC = timing.centralParts(new Date());
  const m = mkMember(108);
  db.member_email_prefs.push({ member_id: m.id, lineup: true, alerts: true, events: true, offers: true, rewards: true, consent_source: "staff", engagement: "active" });
  const c = mkCampaign({ name: "Tonight", status: "draft", kind: "invite", category: "account", audience: { include: [{ r: "consent", v: ["staff"] }] } });
  const mine = () => resend.sent.filter((e) => e.tags.some((t) => t.name === "campaign" && t.value === c.id));
  if (nowC.weekday !== "Sun" && nowC.minutes < 17 * 60) {
    const r = await actions.scheduleCampaign(c.id, { when: "at", date: nowC.date, time: "18:30", sendKey: randomUUID() });
    check("schedule: a time later today goes to Resend now, set to arrive then (a once-a-day cron would miss it)", r.ok && mine().length === 1 && mine()[0].scheduled_at === timing.centralDateTime(nowC.date, "18:30").toISOString(), JSON.stringify([r, mine()[0]?.scheduled_at]));
  } else {
    const day = timing.centralParts(new Date(Date.now() + 3 * DAY)).date;
    const r = await actions.scheduleCampaign(c.id, { when: "at", date: day, time: "10:30", sendKey: randomUUID() });
    check("schedule: a later day waits for that morning's run", r.ok && mine().length === 0 && /morning/.test(r.message ?? ""), JSON.stringify(r));
  }
}
{
  // Trivia vouchers are prizes, not money spent.
  const m = mkMember(110);
  const at = new Date(Date.now() - 2 * DAY).toISOString();
  const allVoucher = { id: randomUUID(), total: 10, tip: 0, payment_voucher_amount: 10 };
  const halfVoucher = { id: randomUUID(), total: 22, tip: 2, payment_voucher_amount: 10 };
  db.orders.push(allVoucher, halfVoucher);
  db.bookings.push(
    { id: randomUUID(), member_id: m.id, quantity: 1, unit_price: 10, order_id: allVoucher.id, status: "confirmed", created_at: at },
    { id: randomUUID(), member_id: m.id, quantity: 2, unit_price: 10, order_id: halfVoucher.id, status: "confirmed", created_at: at },
    { id: randomUUID(), member_id: m.id, quantity: 1, unit_price: 8, order_id: null, status: "confirmed", created_at: at },
  );
  eq("vouchers: 'you bought N tickets ($X)' leaves out a voucher-paid ticket and counts half of a half-voucher order", (await sender.ticketSpend([m.id])).get(m.id), { n: 3, spend: 18 });
  eq("vouchers: the paid share of an order (tips aside)", [rules.paidShare(allVoucher), rules.paidShare(halfVoucher), rules.paidShare({ total: 30, tip: 5, payment_voucher_amount: 0 })], [0, 0.5, 1]);
  const mig = readFileSync(path.join(root, "supabase/migrations/20261001090000_email_marketing.sql"), "utf8");
  const factsSql = mig.slice(mig.indexOf("function public.member_email_facts"), mig.indexOf("function public.email_claim_campaign"));
  check("vouchers: member facts give a voucher-paid register ticket 'p' 0, so it's not a paid ticket", /payment_voucher_amount/.test(factsSql) && /left join orders o on o\.id = bk\.order_id/.test(factsSql));
  check("vouchers: 'came in after' money leaves out vouchers and tips, counts each ticket once, and shows vouchers apart", /voucher_total numeric/.test(mig) && /filter \(where wb\.order_id is null\)/.test(mig) && /o\.total - coalesce\(o\.tip, 0\) - coalesce\(o\.payment_voucher_amount, 0\)/.test(mig));
}
{
  // Only the person, proven, can lift a spam complaint.
  const m = mkMember(109, { email_opt_in: false });
  const h = hash.hashEmail(m.email);
  db.email_suppressions.push({ email_hash: h, reason: "complaint", first_at: new Date().toISOString(), last_at: new Date().toISOString() });
  await consent.setMarketingOptIn(m.id, true, "join_form");
  check("consent: an address typed on the public join form can't lift a spam complaint", db.email_suppressions.some((s) => s.email_hash === h));
  await consent.setMarketingOptIn(m.id, true, "account");
  check("consent: ...the person signed in to their account can", !db.email_suppressions.some((s) => s.email_hash === h));

  // Turning one kind off stops that kind already waiting at Resend.
  const p = mkMember(111);
  const later = new Date(Date.now() + 5 * HOUR).toISOString();
  const ev = mkQueued(mkCampaign({ name: "Events later", status: "sent" }), p, { status: "scheduled", resend_email_id: "re_ev_later", deliver_at: later });
  const li = mkQueued(mkCampaign({ name: "Lineup later", status: "sent", kind: "lineup", category: "lineup" }), p, { status: "scheduled", resend_email_id: "re_li_later", deliver_at: later });
  await consent.updatePrefs(p.id, { events: false }, "prefs_page");
  check("prefs: turning events off cancels an events email waiting at Resend, not the lineup", resend.cancelled.includes("re_ev_later") && !resend.cancelled.includes("re_li_later") && db.email_sends.find((s) => s.id === ev.id).status === "cancelled" && db.email_sends.find((s) => s.id === li.id).status === "scheduled");
}

// ===================== 5c. too late, the emergency stop, "Still want these?" =====================
const dispatch = await load("lib/email/dispatch.ts");
const BLOCKS = [{ t: "paragraph", text: "Hi {first name}" }, { t: "button", label: "See it", link: "/showtimes" }, { t: "signoff" }];
const later = (h) => new Date(Date.now() + h * HOUR).toISOString();
const sendOf = (id) => db.email_sends.find((s) => s.id === id);
const campaignOf = (id) => db.email_campaigns.find((x) => x.id === id);
const goesToday = () => timing.centralParts(timing.nextSendSlot(new Date())).date === timing.centralParts(new Date()).date;
{
  // The latest each kind of one-off may arrive.
  const by = (c) => timing.sendByFor(c);
  const tonight = by({ kind: "alert", content: { alert: "tonight" }, scheduled_for: cdt("2026-10-15", "15:00").toISOString() });
  check("too late: a \"tonight\" alert only goes on its own day", tonight.hard && tonight.at.toISOString() === cdt("2026-10-16", "00:00").toISOString(), JSON.stringify(tonight));
  const weekend = by({ kind: "alert", content: { alert: "weekend" }, scheduled_for: cdt("2026-10-15", "10:30").toISOString() });
  check("too late: a \"this weekend\" alert only goes before that Sunday is over", weekend.hard && weekend.at.toISOString() === cdt("2026-10-19", "00:00").toISOString(), JSON.stringify(weekend));
  const ev = by({ kind: "event", content: { eventDate: "2026-10-22" }, scheduled_for: cdt("2026-10-15", "10:30").toISOString() });
  check("too late: an event email only goes up to the day of the event", ev.hard && ev.at.toISOString() === cdt("2026-10-23", "00:00").toISOString(), JSON.stringify(ev));
  const lineupBy = by({ kind: "lineup", content: { lineup: { start: "2026-10-13", days: 7 } }, scheduled_for: cdt("2026-10-13", "10:30").toISOString() });
  check("too late: a lineup only goes during the week it covers (before the next one)", lineupBy.hard && lineupBy.at.toISOString() === cdt("2026-10-20", "00:00").toISOString(), JSON.stringify(lineupBy));
  const ann = by({ kind: "announcement", scheduled_for: cdt("2026-10-17", "15:00").toISOString() });
  check("too late: anything else by the end of the next sending day (Saturday's go on Monday, never Sunday)", !ann.hard && ann.at.toISOString() === cdt("2026-10-20", "00:00").toISOString(), JSON.stringify(ann));
  check("too late: automations have their own rule (2 days from being queued)", by({ kind: "automation", automation: "birthday" }) === null);

  // Yesterday's "tonight" alert, with some of the list still queued.
  const m1 = mkMember(400);
  const yesterday = new Date(Date.now() - DAY).toISOString();
  const alert = mkCampaign({ name: "Tonight, yesterday", kind: "alert", category: "alerts", content: { blocks: BLOCKS, alert: "tonight" }, scheduled_for: yesterday, recipients: 1 });
  const row1 = mkQueued(alert, m1, { deliver_at: yesterday });
  const before1 = resend.sent.length;
  const r1 = await sender.runCampaign(alert.id, Date.now() + 30_000);
  check("too late: yesterday's \"tonight\" alert is cancelled at hand-over, not sent today with the wrong day's words", sendOf(row1.id).status === "cancelled" && /Too late/.test(sendOf(row1.id).error ?? "") && resend.sent.length === before1 && /too late/.test(r1.note ?? ""), JSON.stringify([sendOf(row1.id).status, r1.note]));

  // An announcement whose rest would now arrive days late: an admin decides.
  const m2 = mkMember(401);
  const old = new Date(Date.now() - 4 * DAY).toISOString();
  const news = mkCampaign({ name: "Old news", kind: "announcement", category: "events", scheduled_for: old, recipients: 1 });
  const row2 = mkQueued(news, m2, { deliver_at: old });
  const before2 = resend.sent.length;
  const r2 = await sender.runCampaign(news.id, Date.now() + 30_000);
  check("too late: anything else that would arrive days late pauses for an admin (nothing sent, nothing cancelled)", r2.status === "paused" && campaignOf(news.id).status === "paused" && sendOf(row2.id).status === "queued" && resend.sent.length === before2 && /Resume/.test(r2.note ?? ""), JSON.stringify(r2));
  const res2 = await actions.resumeCampaign(news.id);
  const went2 = ["submitted", "scheduled"].includes(sendOf(row2.id).status);
  check("too late: Resume sends the rest anyway (its day becomes today)", res2.ok && campaignOf(news.id).status !== "paused" && timing.sendByFor(campaignOf(news.id)).at.getTime() > Date.now() && (goesToday() ? went2 : sendOf(row2.id).status === "queued"), JSON.stringify([res2, campaignOf(news.id).status, sendOf(row2.id).status]));

  // One that never started and is already past its day.
  const stale = mkCampaign({ name: "Tonight, two days ago", kind: "alert", category: "alerts", content: { blocks: BLOCKS, alert: "tonight" }, scheduled_for: new Date(Date.now() - 2 * DAY).toISOString() });
  const r3 = await sender.runCampaign(stale.id, Date.now() + 30_000);
  check("too late: one that never started and is past its day doesn't start: paused, nobody queued", r3.status === "paused" && /Too late to start/.test(r3.note ?? "") && !db.email_sends.some((s) => s.campaign_id === stale.id), JSON.stringify(r3));
}
{
  // Resuming after a stop runs what's due today right away, not on tomorrow morning's run.
  const m = mkMember(403);
  const c = mkCampaign({ name: "Stopped mid-list", kind: "invite", category: "account", recipients: 1 });
  const row = mkQueued(c, m);
  await actions.stopAllSending("Testing resume");
  check("stop all: what was going pauses", campaignOf(c.id).status === "paused" && /^Stopped:/.test(campaignOf(c.id).error ?? ""));
  const before = resend.sent.length;
  const res = await actions.resumeAllSending("Checked, all fine");
  if (goesToday()) check("resume all: emails due today are handed to Resend right away", res.ok && resend.sent.length - before >= 1 && ["submitted", "scheduled"].includes(sendOf(row.id).status) && /back on/.test(res.message ?? ""), JSON.stringify([res, sendOf(row.id).status]));
  else check("resume all: emails due tomorrow are scheduled again for the morning run", res.ok && campaignOf(c.id).status === "scheduled" && sendOf(row.id).status === "queued", JSON.stringify(res));
}
{
  // Sending switched off: what's waiting at Resend comes back, and its email pauses for an admin.
  const m = mkMember(404);
  const c = mkCampaign({ name: "Handed over for later", status: "sent", recipients: 1 });
  const row = mkQueued(c, m, { status: "scheduled", resend_email_id: "re_switch_off", batch_no: 1, batch_key: "k-off", deliver_at: later(5) });
  process.env.EMAIL_SENDING_ENABLED = "false";
  const cron = await dispatch.runEmailCron(Date.now() + 30_000);
  process.env.EMAIL_SENDING_ENABLED = "true";
  check("switched off: email waiting at Resend is called back, and its email pauses (it doesn't go by itself once sending is back on)", resend.cancelled.includes("re_switch_off") && sendOf(row.id).status === "queued" && campaignOf(c.id).status === "paused", JSON.stringify([cron.recall, sendOf(row.id).status, campaignOf(c.id).status]));

  // Only one call-back at a time.
  const m2 = mkMember(405);
  const c2 = mkCampaign({ name: "Busy recall", status: "sent", recipients: 1 });
  const row2 = mkQueued(c2, m2, { status: "scheduled", resend_email_id: "re_busy", deliver_at: later(5) });
  db.email_settings.push({ key: "recall_lease", value: { run: "another", until: new Date(Date.now() + 60_000).toISOString() }, updated_at: new Date().toISOString() });
  const busy = await sender.recallScheduledSends("Stopped: test");
  check("recall: only one call-back runs at a time (a second says so and touches nothing)", busy.busy === true && busy.left >= 1 && !resend.cancelled.includes("re_busy") && sendOf(row2.id).status === "scheduled", JSON.stringify(busy));
  db.email_settings.splice(db.email_settings.findIndex((s) => s.key === "recall_lease"), 1);
  db.email_settings.push({ key: "recall_lease", value: { run: "died", until: new Date(Date.now() - 1000).toISOString() }, updated_at: new Date().toISOString() });
  const freed = await sender.recallScheduledSends("Stopped: test");
  check("recall: a call-back that died lets go when its lease runs out", !freed.busy && resend.cancelled.includes("re_busy") && !db.email_settings.some((s) => s.key === "recall_lease"), JSON.stringify(freed));

  // A big list: what one run can't reach stays counted, and the page's button carries on.
  const refused = await actions.recallWaiting();
  check("call back: refused while sending isn't stopped", !refused.ok);
  const big = mkCampaign({ name: "Big list", status: "sent", recipients: 3 });
  const rows = [0, 1, 2].map((i) => mkQueued(big, mkMember(410 + i), { status: "scheduled", resend_email_id: `re_big_${i}`, deliver_at: later(6) }));
  await sender.pauseAllSending("Big list test", { prefix: "Stopped" });
  const part = await sender.recallScheduledSends("Stopped: Big list test", { deadline: Date.now() - 1 });
  check("recall: what a run can't reach is counted (left) and stays counted for the Email page", part.left >= 3 && (await sender.waitingAtResend(big.id)) === 3, JSON.stringify(part));
  const again = await actions.recallWaiting();
  check("call back: the Email page's button carries on while sending is stopped (and can be pressed again)", again.ok && again.recalled >= 3 && (await sender.waitingAtResend(big.id)) === 0 && rows.every((r) => sendOf(r.id).status === "queued"), JSON.stringify(again));
  const overview = await load("lib/email/reports.ts").then((r) => r.getOverview());
  check("Email page: the stop, the count still at Resend and the paused emails show after a refresh", overview.paused_by_guardrail?.by === "Stopped" && overview.waitingAtResend === 0 && overview.pausedEmails.some((p) => p.id === big.id), JSON.stringify([overview.paused_by_guardrail, overview.waitingAtResend]));

  // An email cancelled meanwhile: what comes back is cancelled, not left queued.
  const m3 = mkMember(415);
  const gone = mkCampaign({ name: "Cancelled meanwhile", status: "cancelled", recipients: 1 });
  const row3 = mkQueued(gone, m3, { status: "scheduled", resend_email_id: "re_cancelled_meanwhile", deliver_at: later(5) });
  await actions.recallWaiting();
  check("recall: one from an email stopped meanwhile is cancelled, not left queued", sendOf(row3.id).status === "cancelled" && campaignOf(gone.id).status === "cancelled", JSON.stringify(sendOf(row3.id)));
  await actions.resumeAllSending("Checked the big list");
}
{
  // An unsubscribe whose cancel Resend didn't take is tried again by the cron.
  const m = mkMember(416);
  const c = mkCampaign({ name: "Cancel retry", status: "sent", recipients: 1 });
  const row = mkQueued(c, m, { status: "scheduled", resend_email_id: "re_retry_cancel", deliver_at: later(5) });
  resend.cancelFailNext = 2; // the request and its one retry
  await consent.setMarketingOptIn(m.id, false, "prefs_page");
  check("unsubscribe: a cancel Resend didn't take is marked to try again (still waiting there)", sendOf(row.id).status === "scheduled" && (sendOf(row.id).error ?? "").startsWith(consent.CANCEL_RETRY), JSON.stringify(sendOf(row.id)));
  const n = await consent.retryPendingCancels(Date.now() + 30_000);
  check("unsubscribe: ...and the next cron run cancels it", n === 1 && sendOf(row.id).status === "cancelled" && resend.cancelled.includes("re_retry_cancel"), JSON.stringify([n, sendOf(row.id)]));
}
{
  // "Still want these?": nobody's 14 days start until it's really on its way.
  const rc = db.email_campaigns.find((x) => x.automation === "reconfirm") ?? mkCampaign({ name: "Still want these?", kind: "automation", automation: "reconfirm", category: "account" });
  Object.assign(rc, { status: "active", kind: "automation", category: "account", audience: { include: [{ r: "sunset_due" }] }, holdout_pct: 0, locked_until: null });
  const prefOf = (id) => db.member_email_prefs.find((p) => p.member_id === id);
  const quiet = (m) => facts({ memberId: m.id, email: m.email, emailHash: hash.hashEmail(m.email), consentSource: "indy_yes", deliveredSinceEngaged: 12, lastEngagedAt: new Date(Date.now() - 120 * DAY).toISOString() });
  const a = mkMember(420);
  const b = mkMember(421);
  for (const m of [a, b]) db.member_email_prefs.push({ member_id: m.id, lineup: true, alerts: true, events: true, offers: true, rewards: true, consent_source: "indy_yes", engagement: "active", reconfirm_sent_at: null });
  const n = await automations.queueAutomation(rc, new Date(), [quiet(a)]);
  check("reconfirm: queueing it doesn't start anyone's 14 days", n === 1 && prefOf(a.id).engagement === "active" && !prefOf(a.id).reconfirm_sent_at, JSON.stringify([n, prefOf(a.id)]));
  eq("reconfirm: due for someone gone quiet", automations.automationKey("reconfirm", quiet(a), new Date(), "2026-10-15"), "reconfirm:2026-10-15");
  const queuedFacts = { ...quiet(a), sends: [{ c: rc.id, t: new Date().toISOString(), k: "automation", a: "reconfirm", g: "account", x: null, s: "queued", ck: false }] };
  eq("reconfirm: not queued again while one is waiting (its 14 days haven't started yet)", automations.automationKey("reconfirm", queuedFacts, new Date(), "2026-10-15"), null);
  const rowB = mkQueued(rc, b, { dedupe_key: "reconfirm:test", deliver_at: later(3) });
  await sender.runCampaign(rc.id, Date.now() + 30_000);
  const rowA = db.email_sends.find((s) => s.campaign_id === rc.id && s.member_id === a.id);
  check("reconfirm: handed to Resend, their 14 days start, from when it arrives", ["submitted", "scheduled"].includes(rowA.status) && prefOf(a.id).engagement === "reconfirm_sent" && prefOf(a.id).reconfirm_sent_at === rowA.deliver_at, JSON.stringify([rowA.status, prefOf(a.id)]));
  check("reconfirm: (one for later waits at Resend)", sendOf(rowB.id).status === "scheduled" && prefOf(b.id).engagement === "reconfirm_sent", JSON.stringify([sendOf(rowB.id).status, prefOf(b.id)]));
  await sender.recallScheduledSends("Stopped: test");
  check("reconfirm: called back before it arrived, they're simply active again", sendOf(rowB.id).status === "queued" && prefOf(b.id).engagement === "active" && prefOf(b.id).reconfirm_sent_at === null, JSON.stringify(prefOf(b.id)));
  await sender.runCampaign(rc.id, Date.now() + 30_000);
  check("reconfirm: (handed over again)", sendOf(rowB.id).status === "scheduled" && prefOf(b.id).engagement === "reconfirm_sent");
  const off = await actions.setAutomationOn("reconfirm", false);
  check("reconfirm: switching it off cancels what waits at Resend, and nobody it never reached goes quiet", off.ok && sendOf(rowB.id).status === "cancelled" && prefOf(b.id).engagement === "active", JSON.stringify([sendOf(rowB.id).status, prefOf(b.id)]));
  rc.status = "active";
  const c = mkMember(422);
  const rowC = mkQueued(rc, c, { dedupe_key: "reconfirm:old", created_at: new Date(Date.now() - 3 * DAY).toISOString() });
  await sender.runCampaign(rc.id, Date.now() + 30_000);
  check("reconfirm: one dropped for being 2 days late leaves them active", sendOf(rowC.id).status === "cancelled" && (prefOf(c.id)?.engagement ?? "active") === "active");
  rc.status = "off";
  const mig = readFileSync(path.join(root, "supabase/migrations/20261001090000_email_marketing.sql"), "utf8");
  const eng = mig.slice(mig.indexOf("function public.email_refresh_engagement"), mig.indexOf('-- ---------- "came in after"'));
  check("reconfirm: the daily check only turns quiet someone it really went to, and resets anyone it never reached", /and email_reconfirm_went\(p\.member_id, p\.reconfirm_sent_at\)/.test(eng) && /and not email_reconfirm_went\(p\.member_id, p\.reconfirm_sent_at\)/.test(eng));
}

// ===================== 6. one-click unsubscribe =====================
{
  const m = mkMember(90);
  const c = mkCampaign({ name: "Unsub test", status: "sent" });
  const sendId = randomUUID();
  const later = randomUUID();
  db.email_sends.push({ id: sendId, campaign_id: c.id, member_id: m.id, status: "delivered", unsubscribed_at: null, created_at: new Date().toISOString() });
  db.email_sends.push({ id: later, campaign_id: mkCampaign({ name: "Later", status: "sending" }).id, member_id: m.id, status: "scheduled", resend_email_id: "re_later", deliver_at: new Date(Date.now() + DAY).toISOString(), created_at: new Date().toISOString() });
  const t = tokens.sealEmailToken({ memberId: m.id, sendId });
  const req = (method, token, body) => {
    const url = `${SITE_URL}/api/email/unsubscribe?t=${token}`;
    const r = new Request(url, { method, ...(body ? { body, headers: { "content-type": "application/x-www-form-urlencoded" } } : {}) });
    return Object.assign(r, { nextUrl: new URL(url) });
  };
  const g = await unsubRoute.GET(req("GET", t));
  check("unsubscribe: GET never unsubscribes (it goes to the preference page)", g.status === 303 && (g.headers.get("location") ?? "").includes("/email/preferences?t=") && db.members.find((x) => x.id === m.id).email_opt_in === true);
  const bad = Buffer.from(t, "base64url");
  bad[20] ^= 1;
  const b = await unsubRoute.POST(req("POST", bad.toString("base64url"), "List-Unsubscribe=One-Click"));
  check("unsubscribe: a tampered token gets 200 and changes nothing", b.status === 200 && db.members.find((x) => x.id === m.id).email_opt_in === true);
  const p = await unsubRoute.POST(req("POST", t, "List-Unsubscribe=One-Click"));
  const body = await p.text();
  check("unsubscribe: one-click POST answers 200 with plain text, no redirect", p.status === 200 && /unsubscribed/i.test(body) && !p.headers.get("location"));
  check("unsubscribe: email is off, and the choice is logged", db.members.find((x) => x.id === m.id).email_opt_in === false && db.email_consent_log.some((l) => l.member_id === m.id && l.action === "opt_out" && l.source === "one_click"));
  check("unsubscribe: stamped on the email it came from", !!db.email_sends.find((s) => s.id === sendId).unsubscribed_at && db.email_events.some((e) => e.send_id === sendId && e.type === "unsubscribed"));
  check("unsubscribe: an email scheduled for them is cancelled at Resend", resend.cancelled.includes("re_later") && db.email_sends.find((s) => s.id === later).status === "cancelled");
  const logs = db.email_consent_log.filter((l) => l.member_id === m.id).length;
  const again = await unsubRoute.POST(req("POST", t, "List-Unsubscribe=One-Click"));
  check("unsubscribe: doing it again is harmless", again.status === 200 && db.email_consent_log.filter((l) => l.member_id === m.id).length === logs);
  check("unsubscribe: category choices are kept for coming back", (db.member_email_prefs.find((x) => x.member_id === m.id)?.lineup ?? true) === true);
  const gone = mkMember(97);
  const goneToken = tokens.sealEmailToken({ memberId: gone.id, sendId: null });
  gone.erased_at = new Date().toISOString();
  check("unsubscribe: a member removed since gets 200 (nothing left to email), not an error to retry forever", (await unsubRoute.POST(req("POST", goneToken, "List-Unsubscribe=One-Click"))).status === 200);
  const secret = process.env.EMAIL_TOKEN_SECRET;
  delete process.env.EMAIL_TOKEN_SECRET;
  const noSecret = await unsubRoute.POST(req("POST", t, "List-Unsubscribe=One-Click"));
  process.env.EMAIL_TOKEN_SECRET = secret;
  check("unsubscribe: with no EMAIL_TOKEN_SECRET it answers 500 instead of pretending it worked", noSecret.status === 500);
}

// ===================== 7. the webhook =====================
{
  const m = mkMember(91);
  const c = mkCampaign({ name: "Hook test", status: "sent" });
  const sendId = randomUUID();
  db.email_sends.push({ id: sendId, campaign_id: c.id, member_id: m.id, status: "submitted", resend_email_id: "re_hook", delivered_at: null, opens: 0, clicks: 0, created_at: new Date().toISOString() });
  const post = (event, { id = `msg_${randomUUID()}`, secret = WEBHOOK_SECRET, tamper = false } = {}) => {
    const body = JSON.stringify(event);
    const ts = String(Math.floor(Date.now() / 1000));
    const key = Buffer.from(secret.slice(6), "base64");
    const s = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
    return new Request(`${SITE_URL}/api/resend/webhook`, { method: "POST", body: tamper ? body.replace("re_hook", "re_hook2") : body, headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${s}` } });
  };
  const ev = (type, extra = {}) => ({ type, created_at: new Date().toISOString(), data: { email_id: "re_hook", to: [m.email], tags: { send: sendId, kind: "event" }, ...extra } });
  eq("webhook: a bad signature gets 400", (await hookRoute.POST(post(ev("email.delivered"), { tamper: true }))).status, 400);
  eq("webhook: a wrong secret gets 400", (await hookRoute.POST(post(ev("email.delivered"), { secret: `whsec_${randomBytes(24).toString("base64")}` }))).status, 400);
  check("webhook: Svix's published example still verifies", sig.verifyResendSignature('{"test": 2432232314}', { id: "msg_p5jXN8AQM9LWM0D4loKWxJek", timestamp: "1614265330", signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=" }, "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", 1614265330 * 1000));
  const d = await hookRoute.POST(post(ev("email.delivered")));
  check("webhook: delivered marks the send", d.status === 200 && db.email_sends.find((s) => s.id === sendId).status === "delivered");
  const openId = `msg_${randomUUID()}`;
  await hookRoute.POST(post(ev("email.opened"), { id: openId }));
  await hookRoute.POST(post(ev("email.opened"), { id: openId }));
  eq("webhook: a redelivered event (same svix-id) counts once", db.email_sends.find((s) => s.id === sendId).opens, 1);
  check("webhook: an open is never engagement", !db.member_email_prefs.find((x) => x.member_id === m.id)?.last_engaged_at);
  const complaintId = `msg_${randomUUID()}`;
  const cr = await hookRoute.POST(post(ev("email.complained"), { id: complaintId }));
  check("webhook: a complaint opts them out and suppresses the address", cr.status === 200 && db.members.find((x) => x.id === m.id).email_opt_in === false && db.email_suppressions.some((s) => s.email_hash === hash.hashEmail(m.email) && s.reason === "complaint"));
  const logs = db.email_consent_log.length;
  await hookRoute.POST(post(ev("email.complained"), { id: complaintId }));
  eq("webhook: the same complaint again changes nothing", db.email_consent_log.length, logs);
  check("webhook: nothing stored holds an address", !JSON.stringify(db.email_events).includes("@"));
  // A complaint whose handling fails partway (a database error) is applied
  // in full when Resend sends it again, not dropped as a duplicate.
  const m2 = mkMember(95);
  const send2 = randomUUID();
  db.email_sends.push({ id: send2, campaign_id: c.id, member_id: m2.id, status: "delivered", resend_email_id: "re_hook_b", delivered_at: new Date().toISOString(), opens: 0, clicks: 0, created_at: new Date().toISOString() });
  const ev2 = { type: "email.complained", created_at: new Date().toISOString(), data: { email_id: "re_hook_b", to: [m2.email], tags: { send: send2, kind: "event" } } };
  const id2 = `msg_${randomUUID()}`;
  const table = db.email_suppressions;
  db.email_suppressions = undefined;
  const first = await hookRoute.POST(post(ev2, { id: id2 }));
  db.email_suppressions = table;
  const second = await hookRoute.POST(post(ev2, { id: id2 }));
  check("webhook: a complaint that failed partway (500) is applied in full on Resend's retry", first.status === 500 && second.status === 200 && db.members.find((x) => x.id === m2.id).email_opt_in === false && db.email_suppressions.some((s) => s.email_hash === hash.hashEmail(m2.email) && s.reason === "complaint"), JSON.stringify([first.status, second.status]));
  // A complaint about someone removed since: nothing to switch off, not a 500.
  const m3 = mkMember(96);
  const send3 = randomUUID();
  db.email_sends.push({ id: send3, campaign_id: c.id, member_id: m3.id, status: "delivered", resend_email_id: "re_hook_c", delivered_at: new Date().toISOString(), opens: 0, clicks: 0, created_at: new Date().toISOString() });
  const m3Email = m3.email;
  m3.erased_at = new Date().toISOString();
  const cr3 = await hookRoute.POST(post({ type: "email.complained", created_at: new Date().toISOString(), data: { email_id: "re_hook_c", to: [m3Email], tags: { send: send3 } } }));
  check("webhook: a complaint about a member removed since still suppresses the address, and answers 200", cr3.status === 200 && db.email_suppressions.some((s) => s.email_hash === hash.hashEmail(m3Email)));
  const bounceMember = mkMember(92);
  await hookRoute.POST(post({ type: "email.bounced", created_at: new Date().toISOString(), data: { email_id: "re_none", to: [bounceMember.email], bounce: { type: "Permanent", subType: "General", message: `550 ${bounceMember.email} does not exist` } } }));
  check("webhook: a hard bounce on a receipt still suppresses the address (by hash)", db.email_suppressions.some((s) => s.email_hash === hash.hashEmail(bounceMember.email) && s.reason === "hard_bounce"));
  check("webhook: the bounce message is scrubbed of addresses", !JSON.stringify(db.email_events).includes(bounceMember.email));
  // Suppression survives an email change and the member row going away.
  const hardHash = hash.hashEmail(bounceMember.email);
  bounceMember.email = "new-address@example.com";
  eq("suppression: a new address isn't suppressed", rules.hardFilter(facts({ email: bounceMember.email, suppressed: null }), { id: "x", kind: "lineup", category: "lineup", automation: null }, new Date()), null);
  db.members.splice(db.members.indexOf(bounceMember), 1);
  check("suppression: the old address stays blocked after the member is gone", db.email_suppressions.some((s) => s.email_hash === hardHash));
}

// ===================== 12. clicks =====================
{
  const m = mkMember(93);
  const c = mkCampaign({ name: "Click test", status: "sent", links: [{ i: 0, url: `${SITE_URL}/showtimes/abc`, label: "A" }, { i: 1, url: `${SITE_URL}/membership#join`, label: "B" }, { i: 2, url: "http://evil.example.com/", label: "bad" }] });
  const sendId = randomUUID();
  db.email_sends.push({ id: sendId, campaign_id: c.id, member_id: m.id, status: "delivered", submitted_at: new Date(Date.now() - 10 * 60_000).toISOString(), deliver_at: null, clicks: 0, opens: 0, created_at: new Date().toISOString() });
  const to = await clicks.handleClick(sendId, "0", "GET");
  check("click: a known link goes to the stored address, with utm tags", to.startsWith(`${SITE_URL}/showtimes/abc?`) && to.includes("utm_medium=email"));
  check("click: a human click is counted and is engagement", db.email_sends.find((s) => s.id === sendId).clicks === 1 && !!db.member_email_prefs.find((p) => p.member_id === m.id)?.last_engaged_at);
  eq("click: an unknown link number goes to the showtimes page", await clicks.handleClick(sendId, "7", "GET"), clicks.FALLBACK);
  eq("click: an unknown send goes to the showtimes page", await clicks.handleClick(randomUUID(), "0", "GET"), clicks.FALLBACK);
  eq("click: a stored non-https link is never followed", await clicks.handleClick(sendId, "2", "GET"), clicks.FALLBACK);
  eq("click: junk in the address goes to the showtimes page", await clicks.handleClick("../../etc", "0", "GET"), clicks.FALLBACK);
  await clicks.handleClick(sendId, "1", "HEAD");
  check("click: a HEAD request is a scanner", db.email_events.some((e) => e.send_id === sendId && e.suspect && e.detail.method === "HEAD") && db.email_sends.find((s) => s.id === sendId).clicks === 1);
  // A scanner opening every link the moment it arrives.
  const m2 = mkMember(94);
  const send2 = randomUUID();
  db.email_sends.push({ id: send2, campaign_id: c.id, member_id: m2.id, status: "delivered", submitted_at: new Date().toISOString(), deliver_at: null, clicks: 0, opens: 0, created_at: new Date().toISOString() });
  const t0 = new Date();
  await clicks.handleClick(send2, "0", "GET", t0);
  await clicks.handleClick(send2, "1", "GET", new Date(t0.getTime() + 200));
  const s2 = db.email_sends.find((s) => s.id === send2);
  check("click: every link in the same second right after delivery is a scanner, and uncounted", s2.clicks === 0 && db.email_events.filter((e) => e.send_id === send2).every((e) => e.suspect));
}

// ===================== 13. the ready-made emails (Ready to send) =====================
{
  // Test-only signing key (claim and Insiders+ links), this process only.
  process.env.SUPABASE_SERVICE_ROLE_KEY = randomBytes(32).toString("base64url");
  const designs = await load("lib/email/designs/index.ts");
  const ready = await load("lib/email/designs/ready.ts");
  const sendPlan = await load("lib/email/send-plan.ts");
  const finishTok = await load("lib/plus-finish-token.ts");
  const artTok = await load("lib/email/designs/art-token.ts");
  const links = await load("lib/email/designs/links.ts");
  const readyActions = await load("app/admin/email/ready/actions.ts");
  const saved = db.members.splice(0); // a list of only this section's members
  const empty = { range: { start: "", days: 7 }, films: [], happenings: [], menuItems: [] };
  db.email_settings.push({ key: "resend_plan", value: { daily: 6, monthly: 3000, reserve: 2 } }); // 4 a day for lists
  const mkDesign = (key) => {
    const d = designs.DESIGNS[key];
    return mkCampaign({ kind: d.kind, category: d.category, name: d.name, subject: d.subject, preheader: d.preheader, content: { blocks: [{ t: "design", key }], design: key, pace: {} }, audience: d.audience, status: "sending" });
  };
  const queuedOf = (c) => db.email_sends.filter((s) => s.campaign_id === c.id && s.status === "queued");
  // Handed over at `at` (and, as in life, queued that day, which is what
  // the wave-by-wave results go by).
  const goOut = (c, at) => queuedOf(c).forEach((s) => Object.assign(s, { status: "submitted", submitted_at: at.toISOString(), deliver_at: at.toISOString(), created_at: at.toISOString() }));

  eq("waves: manual is the default (no setting saved)", await sendPlan.getWaveMode(), "manual");
  db.email_settings.push({ key: "design_waves", value: { auto: true } }); // the automatic waves first; manual ones below
  eq("plan: the free plan less 20 a day for receipts is 80 a day", sendPlan.perDay(sendPlan.FREE_PLAN), 80);
  eq("plan: 300 people at 80 a day, 50 left today, is 5 sending days", sendPlan.sendingDays(300, 80, 50), 5);
  check("plan: a wave can't go on a Sunday afternoon (Central), can on a weekday evening (it's the next UTC day's 10:30)", !sendPlan.waveCanGoToday(cdt("2026-10-11", "12:00")) && sendPlan.waveCanGoToday(cdt("2026-10-06", "20:30")));

  // ---- daily waves: the invite, 10 people, 4 a day ----
  // The tenth has an email and no phone: invited too (links stopped needing a phone, 10/1).
  const inv = [...Array.from({ length: 9 }, (_, i) => mkMember(600 + i, { legacy_user_id: null })), mkMember(621, { legacy_user_id: null, phone: null })];
  mkMember(620, { auth_user_id: randomUUID() }); // signed up already: not invited
  // How engaged each is (the wave order): two active this month (a recent
  // check-in time, a visit), one active months ago, two who ticked "yes"
  // on the join form (the more recent first), one long-standing member.
  inv[6].last_activity_at = "2026-10-04T18:00:00Z";
  db.member_visits.push({ member_id: inv[3].id, business_date: "2026-09-20" });
  inv[8].last_activity_at = "2026-03-01T18:00:00Z";
  const yes = (m, at) => db.member_email_prefs.push({ member_id: m.id, lineup: true, alerts: true, events: true, offers: true, rewards: true, consent_source: "join_form", consent_at: at, engagement: "active" });
  yes(inv[1], "2026-09-30T15:00:00Z");
  yes(inv[4], "2026-09-02T15:00:00Z");
  inv[0].created_at = "2024-05-01T12:00:00Z";
  const ids = (list) => list.map((m) => m.id).sort();
  const c1 = mkDesign("royale-is-here");
  check("waves: all three ready-made emails go most engaged first", designs.DESIGN_KEYS.every((k) => designs.DESIGNS[k].audience.order === "engaged"));
  const tue = cdt("2026-10-06", "11:00");
  {
    const key = (f, x = {}) => rules.engagementKey({ consentSource: "unknown", legacyPlus: false, importGroup: null, createdAt: "2026-09-25T12:00:00Z", lastEngagedAt: null, lastClickAt: null, lastVisitOn: null, orders: [], tickets: [], ...f }, x, tue);
    const order = [
      key({}, { activityAt: "2026-10-05T12:00:00Z" }), // came in yesterday
      key({ lastClickAt: "2026-08-01T12:00:00Z" }), // tapped an email 2 months ago
      key({ consentSource: "join_form" }, { consentAt: "2026-10-01T12:00:00Z" }), // nothing yet, said yes last week
      key({ consentSource: "join_form" }, { consentAt: "2026-06-01T12:00:00Z" }), // ...said yes in June
      key({ consentSource: "old_site_import", legacyPlus: true }), // old-site, paid
      key({ consentSource: "old_site_import", importGroup: "likely_real", createdAt: "2023-01-01T12:00:00Z" }), // old-site, longest-standing
      key({ consentSource: "old_site_import", importGroup: "likely_real" }),
      key({}), // nothing, and no yes on record: last
    ];
    check("order: activity, then the yes (most recent first), then member since, then nothing on record last", order.every((k, i) => i === 0 || rules.compareEngagement(order[i - 1], k) < 0), JSON.stringify(order));
    eq("order: in plain words for the screen", order.map((k) => rules.engagementGroup(k)), [0, 1, 4, 4, 5, 5, 5, 6]);
  }
  let w = await sender.prepareWave(await sender.getCampaign(c1.id), empty, tue);
  eq("waves: the first wave is today's share (4 of the 10 who qualify)", [queuedOf(c1).length, w.more, db.email_campaigns.find((x) => x.id === c1.id).content.pace.remaining], [4, true, 6]);
  eq("waves: the queue orders by engagement: the first wave is the 4 most engaged", ids(queuedOf(c1).map((s) => ({ id: s.member_id }))), ids([inv[6], inv[3], inv[8], inv[1]]));
  check("waves: the no-login rule holds (nobody signed up)", queuedOf(c1).every((s) => inv.some((m) => m.id === s.member_id)));
  check("waves: the invite no longer asks for a phone on file", !JSON.stringify(designs.DESIGNS["royale-is-here"].audience).includes("has_phone"));
  check("waves: each queued row remembers they had no login", queuedOf(c1).every((s) => s.had_login === false));
  w = await sender.prepareWave(await sender.getCampaign(c1.id), empty, tue);
  eq("waves: while some are still queued, no new wave", queuedOf(c1).length, 4);
  goOut(c1, tue);
  w = await sender.prepareWave(await sender.getCampaign(c1.id), empty, new Date(tue.getTime() + HOUR));
  eq("waves: once today's share has gone, nothing more today", [queuedOf(c1).length, w.more, w.note], [0, true, sender.DAILY_LIMIT]);
  w = await sender.prepareWave(await sender.getCampaign(c1.id), empty, cdt("2026-10-07", "08:05"));
  eq("waves: the next morning's run queues the next 4", queuedOf(c1).length, 4);
  check("waves: ...led by the other 'yes' and the longest-standing member", [inv[4], inv[0]].every((m) => queuedOf(c1).some((s) => s.member_id === m.id)));
  goOut(c1, cdt("2026-10-07", "10:30"));
  w = await sender.prepareWave(await sender.getCampaign(c1.id), empty, cdt("2026-10-11", "12:00"));
  check("waves: never on a Sunday (it waits for Monday)", queuedOf(c1).length === 0 && w.more && /Monday/.test(w.note ?? ""), w.note);
  w = await sender.prepareWave(await sender.getCampaign(c1.id), empty, cdt("2026-10-12", "08:05"));
  eq("waves: the last wave is the 2 left, and then there's no more", [queuedOf(c1).length, w.more], [2, false]);
  goOut(c1, cdt("2026-10-12", "10:30"));
  w = await sender.prepareWave(await sender.getCampaign(c1.id), empty, cdt("2026-10-13", "08:05"));
  eq("waves: nobody gets it twice (all 10 had it, once each)", [queuedOf(c1).length, w.more, new Set(db.email_sends.filter((s) => s.campaign_id === c1.id).map((s) => s.member_id)).size], [0, false, 10]);
  check("waves: the member with only an email got it", db.email_sends.some((s) => s.campaign_id === c1.id && s.member_id === inv[9].id));
  {
    const res = await ready.designResults(await sender.getCampaign(c1.id), "royale-is-here");
    eq("waves: results wave by wave (by the day each was queued)", res.waves.map((x) => [x.n, x.day, x.sent, x.outcomeOf]), [
      [1, "2026-10-06", 4, 4],
      [2, "2026-10-07", 4, 4],
      [3, "2026-10-12", 2, 2],
    ]);
  }

  // ---- manual waves (the default): only a press from staff starts one ----
  db.email_settings.find((s) => s.key === "design_waves").value = { auto: false };
  const c2 = mkDesign("royale-is-here");
  const paceOf = (c) => db.email_campaigns.find((x) => x.id === c.id).content.pace;
  const press = (c, at) => Object.assign(paceOf(c), { go: at.toISOString(), goKey: randomUUID() }); // as sendNextWave does
  w = await sender.prepareWave(await sender.getCampaign(c2.id), empty, cdt("2026-10-14", "08:05"));
  eq("manual waves: the morning run starts no wave by itself", [queuedOf(c2).length, w.more, w.note], [0, true, sender.WAVE_WAITING]);
  press(c2, cdt("2026-10-14", "11:00"));
  w = await sender.prepareWave(await sender.getCampaign(c2.id), empty, cdt("2026-10-14", "11:00"));
  eq("manual waves: a press sends one wave (today's share), the most engaged, then waits", [ids(queuedOf(c2).map((s) => ({ id: s.member_id }))), w.more, w.note, paceOf(c2).go], [ids([inv[6], inv[3], inv[8], inv[1]]), true, sender.WAVE_WAITING, null]);
  goOut(c2, cdt("2026-10-14", "11:00"));
  w = await sender.prepareWave(await sender.getCampaign(c2.id), empty, cdt("2026-10-15", "08:05"));
  eq("manual waves: the next morning, still nothing without a press", [queuedOf(c2).length, w.more], [0, true]);
  press(c2, cdt("2026-10-15", "18:00"));
  w = await sender.prepareWave(await sender.getCampaign(c2.id), empty, cdt("2026-10-16", "08:05"));
  eq("manual waves: a press is good for that day only (yesterday's sends nothing)", [queuedOf(c2).length, paceOf(c2).go], [0, null]);
  press(c2, cdt("2026-10-16", "10:00"));
  w = await sender.prepareWave(await sender.getCampaign(c2.id), empty, cdt("2026-10-16", "10:00"));
  check("manual waves: the second press sends the next 4", queuedOf(c2).length === 4 && [inv[4], inv[0]].every((m) => queuedOf(c2).some((s) => s.member_id === m.id)));
  db.email_sends.splice(0, db.email_sends.length, ...db.email_sends.filter((s) => s.campaign_id !== c2.id));
  db.email_campaigns.find((x) => x.id === c2.id).status = "cancelled";
  db.email_settings.find((s) => s.key === "design_waves").value = { auto: true }; // the live run below sends a wave itself
  eq("waves: a paced email has no 'too late' (it goes over days)", timing.sendByFor({ kind: "invite", content: { pace: {} }, scheduled_for: tue.toISOString() }), null);

  // ---- a real run: the invite's own links, re-checked at hand-over ----
  db.email_sends.splice(0, db.email_sends.length, ...db.email_sends.filter((s) => s.campaign_id !== c1.id));
  db.email_campaigns.find((x) => x.id === c1.id).recipients = null;
  const now = new Date();
  const canGo = sendPlan.waveCanGoToday(now);
  // Today's real list email so far (the sections above) plus room for 4 more.
  const roomFor4 = async () => { const used = await sendPlan.listUsage(now); db.email_settings.find((s) => s.key === "resend_plan").value = { daily: used.today + 2 + 4, monthly: 100000, reserve: 2 }; };
  await roomFor4();
  const before = resend.sent.length;
  const c1row = db.email_campaigns.find((x) => x.id === c1.id);
  Object.assign(c1row, { status: "sending", content: { ...c1row.content, pace: {}, waves: [] } }); // as a run has it
  if (canGo) {
    // One of them signs up between being chosen and the hand-over.
    const w2 = await sender.prepareWave(await sender.getCampaign(c1.id), empty, now);
    const q = queuedOf(c1);
    const late = db.members.find((m) => m.id === q[0].member_id);
    late.auth_user_id = randomUUID();
    await sender.deliverQueued(await sender.getCampaign(c1.id), empty, Date.now() + 30_000);
    const mine = resend.sent.slice(before);
    eq("invite: today's 4 chosen, the one who signed up meanwhile is skipped at hand-over", [w2.more, mine.length, db.email_sends.find((s) => s.id === q[0].id).status], [true, 3, "cancelled"]);
    const one = mine[0];
    const sendTag = one.tags.find((t) => t.name === "send").value;
    check("invite: the button is their own claim link (kind email, 30 days), tagged with the send", /\/account\/claim\?t=[A-Za-z0-9_-]{58}&amp;utm_source=email&amp;utm_campaign=claim-invite&amp;utm_content=royale-is-here&amp;utm_term=top&amp;e=/.test(one.html) && one.html.includes(`e=${sendTag}`));
    const claimRows = db.member_claims.filter((r) => r.kind === "email");
    check("invite: a claim row per person, good for 30 days", claimRows.length >= 3 && claimRows.every((r) => Math.abs(Date.parse(r.expires_at) - Date.now() - 30 * DAY) < 2 * DAY));
    check("invite: the door and profile pictures carry their sealed first name", /\/api\/email\/art\/door-d\.[0-9a-f]{10}\.png\?n=[A-Za-z0-9_-]+/.test(one.html) && /\/api\/email\/art\/profile-m\./.test(one.html));
    const tok = one.html.match(/\/api\/email\/art\/door-d\.[0-9a-f]{10}\.png\?n=([A-Za-z0-9_-]+)/)?.[1];
    const who = db.members.find((m) => m.id === db.email_sends.find((s) => s.id === sendTag).member_id);
    eq("invite: the sealed name opens to their first name, and nothing more", artTok.openArtName(tok), format.firstNameOf(who.name));
    check("invite: unsubscribe headers and the footer's address", one.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click" && one.html.includes("715 E Broadway"));
    check("invite: the personal button has its own line in the tracked links", (db.email_campaigns.find((x) => x.id === c1.id).links ?? []).some((l) => l.url === links.PERSONAL_CLAIM));
    await clicks.recordPersonalClick(sendTag, who.id, "claim", new Date(Date.now() + 10 * 60_000));
    check("invite: a tap on their own button (landing on the claim page) counts as a click", db.email_sends.find((s) => s.id === sendTag).clicks === 1);
    await clicks.recordPersonalClick(sendTag, randomUUID(), "claim");
    eq("invite: ...but not from someone else's account", db.email_sends.find((s) => s.id === sendTag).clicks, 1);
    who.auth_user_id = randomUUID();
    const res = await ready.designResults(await sender.getCampaign(c1.id), "royale-is-here");
    eq("invite: results count who signed in since", [res.sent, res.outcome, res.outcomeOf], [3, 1, 3]);
  } else {
    console.log("(skipped the live invite run: a wave can't go at this hour; the dated waves above cover it)");
  }

  // ---- Press play: their own Insiders+ link, and not to anyone set up since ----
  const legacy = Array.from({ length: 3 }, (_, i) => mkMember(700 + i, { legacy_plus: true, tier: "Insiders+", stripe_subscription_id: null, subscription_status: null, comped: false, plus_gift_until: null }));
  mkMember(710, { legacy_plus: true, comped: true }); // complimentary: nothing to restart
  mkMember(711, { legacy_plus: true, stripe_subscription_id: "sub_1", subscription_status: "active" }); // paying already
  // Nothing paying here, but the old system still charged them in September.
  const oldPayer = mkMember(712, { legacy_plus: true, tier: "Insiders+", stripe_subscription_id: null, subscription_status: null, comped: false, plus_gift_until: null });
  db.legacy_billing_payers.push({ member_id: oldPayer.id, last_paid_on: "2026-09-02", note: null });
  const c3 = mkDesign("press-play");
  if (canGo) {
    await roomFor4();
    const b3 = resend.sent.length;
    await sender.prepareWave(await sender.getCampaign(c3.id), empty, now);
    eq("press play: only the former unlimited members with nothing paying (here or on the old system) are chosen", queuedOf(c3).map((s) => s.member_id).sort(), legacy.map((m) => m.id).sort());
    legacy[1].stripe_subscription_id = "sub_2";
    legacy[1].subscription_status = "active";
    await sender.deliverQueued(await sender.getCampaign(c3.id), empty, Date.now() + 30_000);
    const mine = resend.sent.slice(b3);
    eq("press play: someone who set up Insiders+ meanwhile is skipped at hand-over", mine.length, 2);
    const t = mine[0].html.match(/\/membership\/finish\?t=([A-Za-z0-9_-]{48})&amp;utm_source=email&amp;utm_campaign=unlimited-restart/)?.[1];
    const open = finishTok.openFinishToken(t);
    check("press play: the button is their own Insiders+ link: kind campaign, $15 a month, 30 days", !!open && open.kind === "campaign" && open.tier === "adult" && open.interval === "month" && Math.abs(open.exp - Date.now() - 30 * DAY) < 2 * DAY, JSON.stringify(open));
    check("press play: the register's emailed link still lasts 7 days", finishTok.FINISH_LIFETIME_S.email === 7 * 86_400 && finishTok.FINISH_LIFETIME_S.campaign === 30 * 86_400);
    check("press play: the tape picture carries their name", /\/api\/email\/art\/tape-d\.[0-9a-f]{10}\.jpg\?n=/.test(mine[0].html));
  }

  // ---- the staff screen's guards ----
  process.env.EMAIL_SENDING_ENABLED = "false";
  const t1 = await readyActions.sendDesignTest("come-in");
  const s1 = await readyActions.sendDesign("come-in", randomUUID());
  check("ready: with the Vercel master setting off, no test and no send (says an owner turns it on, names nobody)", !t1.ok && !s1.ok && /sending is off/.test(t1.error) && /An owner turns it on/.test(s1.error) && !/Andrew/.test(t1.error + s1.error), JSON.stringify([t1, s1]));
  process.env.EMAIL_SENDING_ENABLED = "true";
  const s2 = await readyActions.sendDesign("come-in", randomUUID());
  check("ready: nothing goes until the pictures are on our server", !s2.ok && /pictures/.test(s2.error), JSON.stringify(s2));
  const bt = resend.sent.length;
  const t2 = await readyActions.sendDesignTest("press-play");
  check("ready: a test goes only to the signed-in staff member, marked [Test]", t2.ok && resend.sent.length === bt + 1 && resend.sent[bt].to[0] === "admin@example.com" && resend.sent[bt].subject.startsWith("[Test] "), JSON.stringify(t2));
  check("ready: a test's buttons open the ordinary pages, not anyone's own link", !/\/account\/claim\?t=|\/membership\/finish\?t=/.test(resend.sent[bt].html));
  const counts = await ready.countAudiences({});
  check("ready: live counts for all three", ["royale-is-here", "come-in", "press-play"].every((k) => typeof counts[k].willSend === "number"));
  check("ready: press play's left-out list counts the old system's September payers", counts["press-play"].excluded.some((e) => e.why === "Paid on the old system in September" && e.n === 1), JSON.stringify(counts["press-play"].excluded));

  // ---- v1.10: the Back office switch (under the Vercel master setting) ----
  const switchRow = db.email_settings.find((s) => s.key === "sending_switch");
  switchRow.value = { on: false };
  const t3 = await readyActions.sendDesignTest("come-in");
  check("switch: off in Back office (Vercel on): no test, and it says an owner can turn it on", !t3.ok && /An owner can turn it on/.test(t3.error) && !/Andrew/.test(t3.error), JSON.stringify(t3));
  const sendMod = await load("lib/email/send.ts");
  const bt3 = resend.sent.length;
  const receipt = await sendMod.sendEmail("someone@example.com", "Your receipt", "<p>Thanks</p>");
  check("switch: receipts and other one-to-one email still go while it's off", receipt.ok && resend.sent.length === bt3 + 1, JSON.stringify(receipt));
  db.email_settings.splice(db.email_settings.indexOf(switchRow), 1);
  check("switch: no setting saved counts as off", !(await sender.sendingGate()).ok);
  const on = await actions.setSendingSwitch(true);
  check("switch: the owners' action turns it on at once", on.ok && (await sender.sendingGate()).ok, JSON.stringify(on));

  // ---- v1.10: Pause calls back what's waiting at Resend ----
  const later = new Date(Date.now() + 6 * HOUR).toISOString();
  const atResend = (c, n, extra = {}) =>
    Array.from({ length: n }, () => {
      const s = { id: randomUUID(), campaign_id: c.id, member_id: randomUUID(), status: "scheduled", dedupe_key: "", deliver_at: later, resend_email_id: `re_${randomUUID()}`, batch_key: "k", created_at: new Date().toISOString(), ...extra };
      db.email_sends.push(s);
      return s;
    });
  const cp = mkDesign("come-in");
  Object.assign(cp, { status: "scheduled", created_at: "2099-01-01T00:00:00Z" });
  atResend(cp, 3);
  const p1 = await readyActions.pauseDesign("come-in");
  check("pause: pauses, calls back the 3 waiting at Resend into the queue, and says so", p1.ok && cp.status === "paused" && queuedOf(cp).length === 3 && /Paused\./.test(p1.message) && /3 called back from Resend; 0 had already gone/.test(p1.message), JSON.stringify(p1));
  cp.status = "cancelled";

  // ---- v1.10: the brake (each wave's bounces and complaints) ----
  eq(
    "brake: 5 of 100 bounced is fine, 6 isn't; 1 spam complaint in 100 is too many",
    [sender.brakeVerdict({ n: 2, day: "d", sent: 100, bounced: 5, complained: 0 }), sender.brakeVerdict({ n: 2, day: "d", sent: 100, bounced: 6, complained: 0 }), !!sender.brakeVerdict({ n: 2, day: "d", sent: 100, bounced: 0, complained: 1 })],
    [null, "Paused: 6 of 100 in wave 2 bounced. Check the list before sending more.", true],
  );
  const cb = mkDesign("press-play");
  Object.assign(cb, { status: "scheduled", created_at: "2099-01-01T00:00:00Z" });
  const waveDay = cdt("2026-10-20", "10:30").toISOString();
  for (let i = 0; i < 20; i++) db.email_sends.push({ id: randomUUID(), campaign_id: cb.id, member_id: randomUUID(), status: i < 2 ? "bounced" : "delivered", bounce_type: i < 2 ? "Permanent" : null, complained_at: null, dedupe_key: "", created_at: waveDay });
  atResend(cb, 2, { created_at: waveDay });
  const b1 = await sender.enforceWaveBrake(await sender.getCampaign(cb.id), { recall: "now" });
  check("brake: 2 of 22 bounced pauses that email, in plain words, and calls back what's waiting", !!b1 && /^Paused: 2 of 22 in wave 1 bounced\. Check the list/.test(b1.reason) && cb.status === "paused" && cb.error.startsWith(sender.BRAKE_PREFIX) && b1.recall?.recalled === 2, JSON.stringify(b1));
  const r1 = await readyActions.resumeDesign("press-play");
  check("brake: carrying on needs what you checked", !r1.ok && /what you checked/.test(r1.error) && cb.status === "paused", JSON.stringify(r1));
  await readyActions.resumeDesign("press-play", "Old addresses from 2019; fine.");
  check("brake: carrying on clears that wave, and the same numbers don't stop it again", paceOf(cb).brakeOk === "2026-10-20" && cb.status !== "paused" && !(await sender.enforceWaveBrake({ ...(await sender.getCampaign(cb.id)), status: "scheduled" })), JSON.stringify([cb.status, cb.error, paceOf(cb)]));
  cb.status = "cancelled";

  // ---- v1.10: ready-made emails stay 3 days apart for each person ----
  {
    const audience = await load("lib/email/audience.ts");
    const at = cdt("2026-10-21", "10:30");
    const had = (days) => facts({ sends: [{ c: "OTHER", t: new Date(at.getTime() - days * DAY).toISOString(), k: "invite", a: null, g: "account", x: null, s: "delivered", ck: false }] });
    const r = await audience.resolveAudience(
      { id: randomUUID(), kind: "announcement", category: "account", automation: null, audience: { include: [{ r: "all" }] }, holdoutPct: 0 },
      { at, now: at, facts: [had(1), had(4), facts()], spacing: { others: new Map([["OTHER", "The new Royale is here"]]), days: 3 } },
    );
    eq("gap: had another ready-made email yesterday -> a later wave; 4 days ago or never -> this one", [r.willSend, r.excluded.design_gap, [...r.spaced]], [2, 1, [["The new Royale is here", 1]]]);
  }
  check("starters: the old invite and Insiders+ come-back are retired", !(await load("lib/email/templates.ts")).STARTERS.some((s) => ["invite", "plus_comeback"].includes(s.key)));

  db.email_settings.splice(db.email_settings.findIndex((s) => s.key === "resend_plan"), 1);
  db.members.push(...saved);
}

// ===================== 9 & 10. static checks =====================
{
  const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : [path.join(dir, f)]));
  const files = [...walk(path.join(src, "lib/email")), ...walk(path.join(src, "app/admin/email"))];
  const offenders = files.filter((f) => readFileSync(f, "utf8").includes("legacy_accounts"));
  eq("invariant: nothing under src/lib/email or src/app/admin/email reads legacy_accounts", offenders.map((f) => path.relative(root, f)), []);
  check("invariant: the Indy import never reads legacy_accounts", !readFileSync(path.join(root, "scripts/import-indy-users.mjs"), "utf8").includes("legacy_accounts"));
  const migDir = path.join(root, "supabase/migrations");
  const erase = readFileSync(path.join(migDir, "20261001090200_erase_member_email.sql"), "utf8");
  check("erasure: clears prefs and consent-log hashes", /delete from member_email_prefs where member_id = new\.id/.test(erase) && /update email_consent_log set email_hash = null/.test(erase));
  check("erasure: keeps the never-mail list", !/delete from email_suppressions/i.test(erase));
  check("erasure: the app cancels scheduled email first", readFileSync(path.join(src, "lib/member-erase.ts"), "utf8").includes("cancelPendingSends"));
  check("erasure: someone who had unsubscribed goes on the never-mail list (hashed), so no import brings them back", /'unsubscribed'/.test(erase) && /old\.email_opt_in = false/.test(erase) && /insert into email_suppressions/.test(erase));
  check("erasure: their emails' webhook events lose the address hash too", /detail - 'to_hash'/.test(erase));
  check("join form: the free sign-up has the hidden-field and timing bot check", /checkHuman\("membership"/.test(readFileSync(path.join(src, "app/(site)/membership/actions.ts"), "utf8")));
  check("privacy: says an unsubscribed address is kept (hashed) only once the account is deleted", /unsubscribed and then ask us to delete your account/.test(readFileSync(path.join(src, "app/(site)/privacy/page.tsx"), "utf8").replace(/\s+/g, " ")));
  const all = readdirSync(migDir).filter((f) => f >= "20261001090000").map((f) => readFileSync(path.join(migDir, f), "utf8")).join("\n");
  check("invariant: no migration flips email_opt_in's default or mass-updates it", !/alter column email_opt_in set default|update members set email_opt_in|set email_opt_in\s*=\s*false/i.test(all));
  const tables = [...all.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1]);
  check("migrations: RLS on every new table", tables.length >= 7 && tables.every((t) => all.includes(`alter table ${t} enable row level security`)), tables.join(","));
  check("migrations: no client policies", !/create policy/i.test(all));
  const sendCode = readFileSync(path.join(src, "lib/email/campaign-send.ts"), "utf8");
  check("invariant: list email goes per person through the batch API (no broadcasts)", !/broadcast/i.test(readFileSync(path.join(src, "lib/email/resend.ts"), "utf8").replace(/^\s*\/\/.*$/gm, "")) && sendCode.includes("deliver("));
}

// ===================== 11. the Indy import (dry run, offline) =====================
{
  const dir = mkdtempSync(path.join(tmpdir(), "indy-check-"));
  try {
    const head = "id,type,first_name,last_name,email,membership_type.name,created_at,phone,email_showtimes,email_last_chance,email_promotions,email_newsletter,employee,date_of_birth";
    const row = (id, email, yes, extra = {}) =>
      [id, "user", "Pat", "Doe", email, extra.type ?? "Free", "2023-05-01T00:00:00Z", "417-555-0100", yes, yes, yes, yes, extra.employee ?? "false", extra.dob ?? "1990-10-19"].join(",");
    const csv = [
      head,
      row(1, "member0@example.com", "true"),
      row(2, "member1@example.com", "false"),
      row(3, "brandnew@example.com", "true", { dob: "10/31/1985" }),
      row(4, "brandnew2@example.com", "false"),
      row(5, "", "true"),
      row(6, "staff@example.com", "true", { type: "Staff" }),
      row(7, "boss@example.com", "true", { employee: "true" }),
      '8,user,"Pat, Jr",Doe,Member0@Example.com,Free,2023-05-01,,true,true,true,true,false,',
    ].join("\n");
    writeFileSync(path.join(dir, "indy.csv"), csv);
    writeFileSync(path.join(dir, "members.json"), JSON.stringify([{ id: randomUUID(), email: "member0@example.com", indy_user_id: null, birthday: null }, { id: randomUUID(), email: "member1@example.com", indy_user_id: null, birthday: "2000-01-01" }]));
    const out = execFileSync(process.execPath, [path.join(root, "scripts/import-indy-users.mjs"), path.join(dir, "indy.csv"), "--dry", "--members-file", path.join(dir, "members.json")], { encoding: "utf8" });
    check("indy: the dry run prints counts only (no @ anywhere)", !out.includes("@"));
    check("indy: matched 1 yes, 1 no; new 1 yes, 1 no", /1 said yes, 1 said no \(email left/.test(out) && /new to us: 1 said yes, 1 said no/.test(out), out);
    check("indy: staff/owner and no-email rows skipped; a repeated email once", /2 staff\/owner, 1 with no email, 1 repeated/.test(out), out);
    check("indy: birthdays filled only where missing (month and day)", /birthdays filled \(month and day\): 3/.test(out), out);
    const bad = [head, row(1, "a@example.com", "true"), [9, "user", "A", "B", "b@example.com", "Free", "2023", "", "true", "false", "true", "true", "false", ""].join(",")].join("\n");
    writeFileSync(path.join(dir, "bad.csv"), bad);
    let stopped = false;
    try {
      execFileSync(process.execPath, [path.join(root, "scripts/import-indy-users.mjs"), path.join(dir, "bad.csv"), "--dry", "--members-file", path.join(dir, "members.json")], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      stopped = e.status === 1 && !String(e.stderr).includes("@");
    }
    check("indy: stops if a row's four email switches disagree", stopped);
    let refused = false;
    try {
      execFileSync(process.execPath, [path.join(root, "scripts/import-indy-users.mjs"), path.join(dir, "indy.csv"), "--members-file", path.join(dir, "members.json")], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      refused = e.status === 1 && /review screen/.test(String(e.stderr));
    }
    check("indy: without --dry it refuses (the import runs from the review screen, on its own branch)", refused);
    const indySrc = readFileSync(path.join(root, "scripts/import-indy-users.mjs"), "utf8");
    check("indy: the script has no write calls at all", !/\.(insert|update|upsert|delete)\(/.test(indySrc));
    check("indy: everyone from Indy would join with email on (a 'no' is information only)", /email_opt_in: true/.test(indySrc) && !/email_opt_in: yes/.test(indySrc));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

await flushAfter();
console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
