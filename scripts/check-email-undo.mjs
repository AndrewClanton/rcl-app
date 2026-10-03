// Checks "one minute to undo" on Ready to send (src/lib/email/undo.ts,
// undoWave in src/lib/email/campaign-send.ts, /api/email/undo and the
// Ready to send actions), one wave a day, what happens when Resend won't
// hold email for later, and that a Send's first wave goes to only 25
// (send-plan.ts FIRST_WAVE), against the same in-memory stand-ins for
// Supabase and Resend as check-email-marketing.mjs
// (scripts/check-email-marketing-fakes.mjs). No database, no network,
// nothing is sent: fetch is replaced before anything loads.
//
// The clock is moved to chosen days and times (Central), so a wave can go
// whatever the real time is. Each section runs on its own: one that
// throws counts as a failure and the rest still run.
//
// Usage: node scripts/check-email-undo.mjs   (Node 23.6+ runs the .ts directly)
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
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

// ---- the clock: real time, moved to a chosen moment ----
const RealDate = Date;
let shift = 0;
class ShiftedDate extends RealDate {
  constructor(...a) {
    if (a.length === 0) super(RealDate.now() + shift);
    else super(...a);
  }
  static now() {
    return RealDate.now() + shift;
  }
}
globalThis.Date = ShiftedDate;
const setClock = (d) => {
  shift = (typeof d === "string" ? RealDate.parse(d) : d.getTime()) - RealDate.now();
};
const advance = (ms) => {
  shift += ms;
};

const fakes = await import(fakesUrl);
const { db, resend, faults, fakeFetch, flushAfter } = fakes;
// The pictures' probe (a HEAD to our own picture server) answers yes;
// everything else goes to the fake Resend, which throws on any other host.
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === "stub.supabase.co" && (init.method ?? "GET") === "HEAD") return new Response(null, { status: 200 });
  return fakeFetch(url, init);
};
// Test-only values, this process only. The keys are fake and fetch is the
// fake above: nothing can reach Resend.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = randomBytes(32).toString("base64url");
process.env.RESEND_API_KEY = "re_test_fake";
process.env.EMAIL_FROM = "Royale Cinema Lounge <hello@royalecinemajoplin.com>";
process.env.EMAIL_TOKEN_SECRET = randomBytes(32).toString("base64url");
process.env.EMAIL_SENDING_ENABLED = "true";
delete process.env.CRON_SECRET;
delete process.env.RESEND_RPS;

const load = (p) => import(pathToFileURL(path.join(src, p)).href);
const sender = await load("lib/email/campaign-send.ts");
const undoLib = await load("lib/email/undo.ts");
const sendPlan = await load("lib/email/send-plan.ts");
const timing = await load("lib/email/timing.ts");
const ready = await load("lib/email/designs/ready.ts");
const actions = await load("app/admin/email/ready/actions.ts");
const undoRoute = await load("app/api/email/undo/route.ts").catch(() => null);

let failures = 0;
let passed = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail && !ok ? `  (${detail})` : ""}`);
  if (ok) passed++;
  else failures++;
};
const eq = (label, got, want) => check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    check(`${name}: runs to the end`, false, e instanceof Error ? (e.stack ?? e.message).split("\n").slice(0, 3).join(" | ") : String(e));
  }
};
const ct = (date, time) => timing.centralDateTime(date, time); // Central, DST-aware

// Undo, as the page presses it: POST /api/email/undo from our own site.
const SITE = "https://www.royalecinemajoplin.com";
const undoPress = async (key, campaignId, undoKey, headers = { origin: SITE, "content-type": "application/json" }) => {
  if (!undoRoute) {
    // Before /api/email/undo (to show these checks failing on older code):
    // the Server Action it replaced.
    if (typeof actions.undoDesignWave !== "function") throw new Error("there's no /api/email/undo");
    return { status: 200, ...(await actions.undoDesignWave(key, campaignId, undoKey)) };
  }
  const res = await undoRoute.POST(new Request(`${SITE}/api/email/undo`, { method: "POST", headers, body: JSON.stringify({ key, campaignId, undoKey }) }));
  return { status: res.status, ...(await res.json()) };
};
const said = (r) => (r.ok ? r.message : r.error) ?? "";

const KEY = "royale-is-here";
const setPlan = (daily) => {
  const row = db.email_settings.find((x) => x.key === "resend_plan");
  if (row) row.value = { daily, monthly: 100000, reserve: 2 };
  else db.email_settings.push({ key: "resend_plan", value: { daily, monthly: 100000, reserve: 2 } });
};
const setting = (key) => db.email_settings.find((x) => x.key === key);
const dropSetting = (key) => {
  const i = db.email_settings.findIndex((x) => x.key === key);
  if (i >= 0) db.email_settings.splice(i, 1);
};
const setAuto = (on) => {
  dropSetting("design_waves");
  if (on) db.email_settings.push({ key: "design_waves", value: { auto: true } });
};
// Called-back emails count against the day (in case Resend counts them):
// cleared between checks that each need a day's share of their own.
const freshShare = () => dropSetting("undone_at_resend");
const addMembers = (n, prefix) => {
  for (let i = 0; i < n; i++) {
    db.members.push({ id: randomUUID(), name: `${prefix} ${i}`, email: `${prefix.toLowerCase()}${i}@example.com`, tier: "Insiders", email_opt_in: true, erased_at: null, created_at: "2026-09-25T12:00:00Z", legacy_user_id: null, auth_user_id: null, phone: null });
  }
};
// A fresh start: a list of `n` with no login, waves of `daily - 2`.
const fresh = (n, daily) => {
  for (const t of ["email_sends", "email_campaigns", "members", "member_claims"]) db[t].length = 0;
  for (const k of ["undone_at_resend", "resend_scheduling", "recall_lease"]) dropSetting(k);
  Object.assign(resend, { batchRejectsSchedule: false, singleRejectsSchedule: false, ignoreSchedule: false, acceptThenTimeout: 0, rateLimitNext: 0, cancelFailNext: 0, onBatch: null, onCancel: null });
  setAuto(false);
  setPlan(daily);
  addMembers(n, "Guest");
};
const campaign = (key = KEY) => db.email_campaigns.find((c) => c.content?.design === key && c.status !== "cancelled") ?? null;
const rowsOf = (c) => db.email_sends.filter((s) => s.campaign_id === c?.id);
const paceOf = (c) => c?.content?.pace ?? {};
const sentTo = (rows) => resend.sent.filter((e) => rows.some((r) => r.resend_email_id === e.id));
const takenFor = (ids) => resend.sent.filter((e) => e.tags?.some((t) => t.name === "send" && ids.includes(t.value)));
const willSend = async () => (await ready.countAudiences({ [KEY]: campaign() }, new Date(), 4))[KEY].willSend;
const usedToday = async () => (await sendPlan.listUsage(new Date())).today;
const tick = () => advance(5); // waves a few ms apart, as in life
const ONE_A_DAY = /The next wave can go tomorrow, once you've seen how this one did\./;

db.email_settings.push({ key: "sending_switch", value: { on: true, at: new Date().toISOString() }, updated_at: new Date().toISOString() });

// ===================== the hold =====================
await section("hold", async () => {
  // At Resend's pace here (1.5 requests a second unless RESEND_RPS says).
  eq("hold: 25 wait 4 minutes, 80 wait 5, 200 wait 7", [25, 80, 200].map((n) => undoLib.undoHoldMs(n) / 60_000), [4, 5, 7]);
  let ok = true;
  for (let n = 1; n <= undoLib.UNDO_MAX_WAVE; n++) {
    // Undo pressed at the last moment of the minute (and the grace), then
    // waiting for the call-back lease, then a cancel and a check for each at
    // 1.5 a second: still done before Undo stops trying (30 s before due)...
    if (undoLib.UNDO_SECONDS * 1000 + undoLib.undoNeedsMs(n) > undoLib.undoHoldMs(n)) ok = false;
    if (undoLib.UNDO_SECONDS * 1000 + undoLib.UNDO_GRACE_MS + undoLib.UNDO_LEASE_WAIT_MS + n * Math.ceil(1500 / 1.5) + undoLib.UNDO_STOP_BEFORE_MS > undoLib.undoHoldMs(n)) ok = false;
    // ...and inside one press (one request of up to 5 minutes).
    if (undoLib.UNDO_LEASE_WAIT_MS + n * Math.ceil(1000 / 1.5) > undoLib.UNDO_RUN_MS) ok = false;
  }
  check("hold: an Undo at the last second can wait for the lease and call back every one of the biggest wave at 1.5 a second, inside one press, before any is due", ok);
  check("hold: a wave over 200 gets no hold and no Undo (Pause covers it)", undoLib.canUndoWave(200) && !undoLib.canUndoWave(201) && !undoLib.canUndoWave(0));
  process.env.RESEND_RPS = "0.5";
  check("hold: a slower RESEND_RPS gives a longer hold and a smaller biggest wave", undoLib.undoHoldMs(25) > 4 * 60_000 && !undoLib.canUndoWave(200));
  // The fake Resend has no rate limit: the rest go 10 a second.
  process.env.RESEND_RPS = "10";
});

// The list for the dated checks: 20 with no login, waves of 4.
setPlan(6);
addMembers(20, "Member");

// ===================== 1. the first wave, undone inside the minute =====================
await section("first wave", async () => {
  setClock(ct("2026-10-13", "10:00")); // a Tuesday
  const before = { usage: await usedToday(), audience: await willSend() };
  const key1 = randomUUID();
  const s = await actions.sendDesign(KEY, key1);
  const done = Date.now();
  const c = campaign();
  const rows = rowsOf(c);
  const u = paceOf(c).undo;
  check("send: the first wave goes to Resend at once, 4 of them, and says when they arrive", s.ok && rows.length === 4 && rows.every((r) => r.status === "scheduled") && /to arrive about/.test(s.message) && /minute to undo/.test(s.message), JSON.stringify(s));
  const items = sentTo(rows);
  const held = items.map((e) => RealDate.parse(e.scheduled_at) - Date.now());
  check("send: ...each held at Resend (scheduled_at) about 4 minutes, not sent now", items.length === 4 && held.every((ms) => ms > 3.5 * 60_000 && ms <= 4 * 60_000), JSON.stringify(held));
  check("send: ...and its row's deliver_at is that same time (so the caps and Pause see it)", rows.every((r) => r.deliver_at === items.find((e) => e.id === r.resend_email_id)?.scheduled_at));
  check(
    "send: what Undo needs is saved on the email: the press, the arrival, the time it would have gone with no hold, the wave's rows, and that it didn't exist before",
    u?.key === key1 && u.wave === 1 && u.n === 4 && u.first === true && u.before === null && u.arrives === items[0].scheduled_at && !!u.planned && u.after === null && !!u.to,
    JSON.stringify(u),
  );
  const left = RealDate.parse(u.until) - done;
  check("send: the minute starts once the wave is with Resend: about 60 s left when the answer comes back", left > 55_000 && left <= 60_000, String(left));
  eq("send: while it's on its way it counts: today's share and who's had it", [await usedToday(), await willSend()], [before.usage + 4, before.audience - 4]);
  const ids = rows.map((r) => r.resend_email_id);

  advance(30_000);
  check("reload: 30 s in, the minute is still open (from the saved times alone)", undoLib.undoOpen(paceOf(campaign()).undo, Date.now()) && !!sender.undoPending(campaign()));
  const other = await actions.sendDesign(KEY, randomUUID());
  check("send: another tab can't send it again meanwhile", !other.ok && /can still be undone/.test(other.error), JSON.stringify(other));

  const noOrigin = await undoPress(KEY, c.id, key1, { "content-type": "application/json" });
  const notJson = await undoPress(KEY, c.id, key1, { origin: SITE, "content-type": "text/plain" });
  const elsewhere = await undoPress(KEY, c.id, key1, { origin: "https://example.com", "content-type": "application/json" });
  check("undo route: refused without our own site as the origin, or without JSON (nothing done)", noOrigin.status === 403 && notJson.status === 415 && elsewhere.status === 403 && rowsOf(campaign()).length === 4, JSON.stringify([noOrigin, notJson, elsewhere]));

  const cancelledBefore = resend.cancelled.length;
  const r = await undoPress(KEY, c.id, key1);
  check("undo: says exactly how many were called back, and that nobody got it", r.status === 200 && r.ok && /^Undone: all 4 called back before anyone got it\./.test(r.message) && /send it again/.test(r.message), JSON.stringify(r));
  check("undo: every one of the wave is cancelled at Resend", ids.every((id) => resend.cancelled.includes(id)) && resend.cancelled.length - cancelledBefore === 4);
  check("undo: the email is as before Send: no email row, no send rows (Send starts afresh)", !db.email_campaigns.some((x) => x.id === c.id) && !db.email_sends.some((x) => x.campaign_id === c.id) && (await ready.designCampaign(KEY)) === null);
  eq("undo: nobody counts as having had it", await willSend(), before.audience);
  eq("undo: the 4 called back still count against today's share, in case Resend counts them", await usedToday(), before.usage + 4);

  const again = await undoPress(KEY, c.id, key1);
  check("undo twice: harmless (nothing more is cancelled, it says there's nothing to undo)", again.ok && /Nothing to undo/.test(again.message) && resend.cancelled.length - cancelledBefore === 4, JSON.stringify(again));
  freshShare();
});

// ===================== 2. sent again; an Undo after the minute is refused =====================
await section("after the minute", async () => {
  tick();
  const key2 = randomUUID();
  const sentBefore = resend.sent.length;
  const s = await actions.sendDesign(KEY, key2);
  const c = campaign();
  check("send again: a fresh press sends the first wave again, to 4 who haven't had it", s.ok && rowsOf(c).length === 4 && resend.sent.length - sentBefore === 4 && paceOf(c).undo?.first === true, JSON.stringify(s));
  advance(66_000); // the minute and the grace are over
  const cancelledBefore = resend.cancelled.length;
  const late = await undoPress(KEY, c.id, key2);
  check("undo after the minute: refused, by the server's clock", !late.ok && /Too late to undo: the minute is up/.test(late.error) && /Pause still calls back/.test(late.error), JSON.stringify(late));
  check("undo after the minute: nothing cancelled, nothing changed", resend.cancelled.length === cancelledBefore && rowsOf(c).every((r) => r.status === "scheduled") && campaign().status === "scheduled");
  check("after the minute: no Undo, the wave is simply on its way", !sender.undoPending(campaign()) && Date.now() < RealDate.parse(paceOf(campaign()).undo.arrives));
  advance(4 * 60_000); // it arrives
  for (const r of rowsOf(c)) Object.assign(r, { status: "delivered", delivered_at: new Date().toISOString() });
});

// ===================== 3. one wave a day =====================
await section("one wave a day", async () => {
  setPlan(10); // room for a second wave today, so only the one-a-day rule can stop it
  const c = campaign();
  const p = await actions.pauseDesign(KEY);
  const res = await actions.resumeDesign(KEY);
  check("same day: Pause and Carry on sending work as before", p.ok && res.ok && campaign().status === "scheduled", JSON.stringify([p, res]));
  const n = rowsOf(c).length;
  const next = await actions.sendNextWave(KEY, randomUUID());
  check("same day: Send the next wave is refused, so the brake and the results never count two waves as one", !next.ok && ONE_A_DAY.test(next.error) && rowsOf(c).length === n, JSON.stringify(next));
  const when = sender.nextWaveAfter(await sender.lastWave(c.id), new Date());
  check("same day: the next wave can go tomorrow (Wednesday's 10:30), and the screen says the same", !!when && when.toISOString() === ct("2026-10-14", "10:30").toISOString() && sender.waveDayWord(when, new Date()) === "tomorrow", String(when));
  const again = await actions.sendDesign(KEY, randomUUID());
  check("same day: and Send can't start it again either", !again.ok, JSON.stringify(again));
  setPlan(6);
});

// ===================== 4. the next wave, undone =====================
await section("next wave undone", async () => {
  setClock(ct("2026-10-14", "10:00")); // Wednesday: a new day's share
  const before = structuredClone(campaign());
  const audienceBefore = await willSend();
  const key3 = randomUUID();
  const s = await actions.sendNextWave(KEY, key3);
  const c = campaign();
  const u = paceOf(c).undo;
  const wave2 = rowsOf(c).filter((r) => r.status === "scheduled");
  check("next wave: goes to Resend held, wave 2, 4 people, with the email as it was before the press saved", s.ok && wave2.length === 4 && u?.wave === 2 && u.first === false && u.before?.status === "scheduled" && u.before?.pace?.remaining === 16, JSON.stringify([s, u?.before]));
  eq("next wave: today's share is used while it's on its way", await usedToday(), 4);
  const blocked = await actions.sendNextWave(KEY, randomUUID());
  check("next wave: another can't start while this one can be undone", !blocked.ok && /can still be undone/.test(blocked.error), JSON.stringify(blocked));
  advance(59_000); // pressed at second 59
  const r = await undoPress(KEY, c.id, key3);
  const after = campaign();
  check("undo: all 4 of wave 2 called back, and it says it's waiting for Send the next wave again", r.ok && /^Undone: all 4 called back/.test(r.message) && /waiting for Send the next wave again/.test(r.message), JSON.stringify(r));
  check("undo: every one cancelled at Resend, and their rows gone", wave2.every((x) => resend.cancelled.includes(x.resend_email_id)) && rowsOf(after).length === 4 && rowsOf(after).every((x) => x.status === "delivered"));
  eq(
    "undo: back to waiting for Send the next wave, exactly as before (status, note, people left, numbers, wave list)",
    [after.status, after.error, paceOf(after).remaining, paceOf(after).note, paceOf(after).go, after.recipients, after.content.waves.length, after.scheduled_for],
    [before.status, before.error, paceOf(before).remaining, paceOf(before).note, null, before.recipients, before.content.waves.length, before.scheduled_for],
  );
  eq("undo: those 4 are back among who haven't had it", await willSend(), audienceBefore);
  const w = await sender.lastWave(after.id);
  check("undo: the wave-by-wave results and the brake don't see it (the last wave is still wave 1)", w?.n === 1 && w.sent === 4, JSON.stringify(w));
  const res = await ready.designResults(after, KEY);
  eq("undo: results show only wave 1", res.waves.map((x) => [x.n, x.sent]), [[1, 4]]);
  eq("undo: the brake has nothing to stop", await sender.enforceWaveBrake(after), null);
  const stale = await actions.sendNextWave(KEY, key3);
  check("undo: the undone press's page key can't send it again (a reload gives a new one)", !stale.ok && /undone/.test(stale.error), JSON.stringify(stale));
  const twice = await undoPress(KEY, c.id, key3);
  check("undo twice: says what the first did, and calls back nothing more", twice.ok && /^Already undone: 4 called back\./.test(twice.message), JSON.stringify(twice));
  freshShare();
});

// ===================== 5. some had already gone: said honestly, kept =====================
await section("partly gone", async () => {
  tick();
  const audienceBefore = await willSend();
  const remainingBefore = paceOf(campaign()).remaining;
  const key4 = randomUUID();
  const s = await actions.sendNextWave(KEY, key4);
  const c = campaign();
  const wave = rowsOf(c).filter((r) => r.status === "scheduled");
  check("again: the next wave goes (the undone one doesn't count as today's wave)", s.ok && wave.length === 4, JSON.stringify(s));
  resend.cancelGone.add(wave[0].resend_email_id); // Resend had already sent this one
  advance(20_000);
  const r = await undoPress(KEY, c.id, key4);
  const after = campaign();
  const goneRow = db.email_sends.find((x) => x.id === wave[0].id);
  check("partly gone: says 3 of 4 called back and 1 had already gone out", r.ok && /^Called back 3 of 4\. 1 had already gone out, so that person has it/.test(r.message), JSON.stringify(r));
  check("partly gone: that one keeps its row (counted as sent, never sent twice); the 3 are gone", goneRow?.status === "submitted" && wave.slice(1).every((x) => !db.email_sends.some((y) => y.id === x.id)));
  check("partly gone: the email isn't stuck: back to waiting for the next wave, counting the 1", after.status === "scheduled" && after.recipients === 5 && after.content.waves.at(-1).n === 1, JSON.stringify([after.status, after.recipients, after.content.waves]));
  eq("partly gone: the people still to go are one fewer (the one who has it)", paceOf(after).remaining, remainingBefore - 1);
  eq("partly gone: today counts the 1 that went and the 3 called back; only the 1 counts as having had it", [await usedToday(), await willSend()], [4, audienceBefore - 1]);
  resend.cancelGone.clear();
  freshShare();
});

// ===================== 6. two tabs press Undo at once; Resend busy =====================
await section("two tabs", async () => {
  setClock(ct("2026-10-15", "10:00")); // Thursday (Wednesday had a wave)
  const key5 = randomUUID();
  await actions.sendNextWave(KEY, key5);
  const c = campaign();
  const wave = rowsOf(c).filter((r) => r.status === "scheduled");
  advance(10_000);
  resend.cancelFailNext = 2; // Resend busy for the first two cancels
  const cancelledBefore = resend.cancelled.length;
  const [a, b] = await Promise.all([undoPress(KEY, c.id, key5), undoPress(KEY, c.id, key5)]);
  const msgs = [said(a), said(b)];
  check("two tabs: one undoes the wave, the other says it's already done", wave.length === 4 && a.ok && b.ok && msgs.some((m) => m.startsWith("Undone: all 4 called back")) && msgs.some((m) => m.startsWith("Already undone: 4 called back")), JSON.stringify(msgs));
  check("two tabs, Resend busy: every one still called back, each exactly once", resend.cancelled.length - cancelledBefore === 4 && wave.every((x) => resend.cancelled.includes(x.resend_email_id) && !db.email_sends.some((y) => y.id === x.id)));
  check("two tabs: the email is back to waiting for the next wave", campaign().status === "scheduled" && !paceOf(campaign()).undo);
  freshShare();
});

// ===================== 7. Pause in the minute, then Undo =====================
await section("pause then undo", async () => {
  tick();
  const key6 = randomUUID();
  await actions.sendNextWave(KEY, key6);
  const c = campaign();
  const k = rowsOf(c).filter((r) => r.status === "scheduled" && r.created_at > new RealDate(Date.now() - 60_000).toISOString()).length;
  const p = await actions.pauseDesign(KEY);
  check("pause: still works in the minute: paused, the wave called back into the queue", k === 4 && p.ok && campaign().status === "paused" && rowsOf(c).filter((r) => r.status === "queued").length === k && p.message.includes(`${k} called back from Resend`), JSON.stringify(p));
  const r = await undoPress(KEY, c.id, key6);
  check("pause then undo: the whole wave taken back, and it's waiting for the next wave (not left paused)", r.ok && r.message.startsWith(`Undone: all ${k} called back`) && campaign().status === "scheduled" && rowsOf(c).every((x) => x.status !== "queued"), JSON.stringify([r, campaign().status]));
  freshShare();
});

// ===================== 8. Resend says "not found" while it still holds it =====================
await section("cancel answered 404", async () => {
  tick();
  const key7 = randomUUID();
  await actions.sendNextWave(KEY, key7);
  const c = campaign();
  const wave = rowsOf(c).filter((r) => r.status === "scheduled");
  resend.cancel404Once.add(wave[0].resend_email_id); // a 404, though Resend still holds it
  advance(10_000);
  const r = await undoPress(KEY, c.id, key7);
  check("404 but still scheduled at Resend: asked again, called back, not reported as gone", r.ok && /^Undone: all 4 called back/.test(r.message) && wave.every((x) => resend.cancelled.includes(x.resend_email_id)) && !db.email_sends.some((x) => x.id === wave[0].id), JSON.stringify(r));
  freshShare();
});

// ===================== 9. the minute starts after the hand-over =====================
await section("minute after hand-over", async () => {
  tick();
  const key8 = randomUUID();
  resend.onBatch = () => advance(30_000); // a slow hand-over
  const s = await actions.sendNextWave(KEY, key8);
  resend.onBatch = null;
  const c = campaign();
  const left = RealDate.parse(paceOf(c).undo?.until ?? "") - Date.now();
  check("slow hand-over: the minute starts once the wave is with Resend, so the button really shows about 60 s", s.ok && left > 55_000 && left <= 60_000, JSON.stringify([s, left]));
  advance(50_000);
  const r = await undoPress(KEY, c.id, key8);
  check("slow hand-over: Undo 50 s after the answer still works", r.ok && /^Undone: all 4/.test(r.message), JSON.stringify(r));
  freshShare();
});

// ===================== 10. Resend doesn't answer: said so, and Undo again finishes it =====================
await section("Resend not answering", async () => {
  tick();
  const key10 = randomUUID();
  await actions.sendNextWave(KEY, key10);
  const c = campaign();
  const wave = rowsOf(c).filter((r) => r.status === "scheduled");
  const before = structuredClone(paceOf(c).undo.before);
  // Every cancel fails, and each takes 15 s (the clock moves on with it).
  resend.cancelFailNext = 10_000;
  resend.onCancel = () => advance(15_000);
  const r1 = await undoPress(KEY, c.id, key10);
  resend.cancelFailNext = 0;
  resend.onCancel = null;
  check(
    "Resend not answering: says none called back yet and how many are still waiting, and when they'd arrive",
    !r1.ok && r1.error.startsWith(`Called back 0. ${wave.length} couldn't be called back yet`) && /Press Undo again, or they arrive about/.test(r1.error),
    JSON.stringify(r1),
  );
  check(
    "Resend not answering: nothing deleted that's still at Resend; the email waits, paused, for Undo again",
    wave.length === 4 && wave.every((x) => db.email_sends.some((y) => y.id === x.id && y.status === "scheduled")) && campaign().status === "paused" && campaign().error.startsWith(sender.UNDO_PREFIX),
  );
  check("Resend not answering: Carry on isn't blocked (only an Undo that's running blocks it)", !sender.undoUnderWay(campaign()));
  const r2 = await undoPress(KEY, c.id, key10);
  check(
    "Undo again: calls back the rest and puts the email back as before",
    r2.ok && r2.message.startsWith(`Undone: all ${wave.length} called back`) && wave.every((x) => resend.cancelled.includes(x.resend_email_id)) && campaign().status === before.status && campaign().error === before.error,
    JSON.stringify([r2, campaign().status, campaign().error]),
  );
  freshShare();
});

// ===================== 11. pressed after hours: held to the morning, still undoable =====================
await section("after hours", async () => {
  setClock(ct("2026-10-15", "19:30")); // Thursday 7:30 PM Central (Friday in UTC, Resend's day)
  const key11 = randomUUID();
  const s = await actions.sendNextWave(KEY, key11);
  const c = campaign();
  const u = paceOf(c).undo;
  const wave = rowsOf(c).filter((r) => r.status === "scheduled");
  check("after hours: the wave is held to 10:30 the next morning, and can be undone for a minute", s.ok && wave.length === 4 && u?.arrives === ct("2026-10-16", "10:30").toISOString() && /10:30 AM/.test(s.message), JSON.stringify([s, u?.arrives]));
  advance(45_000);
  const r = await undoPress(KEY, c.id, key11);
  check("after hours: Undo calls them all back", r.ok && /^Undone: all 4/.test(r.message) && wave.every((x) => resend.cancelled.includes(x.resend_email_id)), JSON.stringify(r));
  freshShare();
});

// ===================== 12. waves that go by themselves get no Undo =====================
await section("morning run", async () => {
  setClock(ct("2026-10-16", "08:05")); // Friday's morning run
  setAuto(true);
  const c = campaign();
  const r = await sender.runCampaign(c.id, Date.now() + 30_000); // as the cron does
  const now = campaign();
  const wave = rowsOf(now).filter((x) => x.status === "scheduled" && x.created_at >= new RealDate(Date.now() - 60_000).toISOString());
  check("morning run: a wave goes (at the 10:30 slot), with no hold and no Undo", r.submitted === 4 && wave.length === 4 && !paceOf(now).undo && wave.every((x) => x.deliver_at === ct("2026-10-16", "10:30").toISOString()), JSON.stringify([r, paceOf(now).undo, wave.map((x) => x.deliver_at)]));
  const none = await undoPress(KEY, now.id, randomUUID());
  check("morning run: there's nothing to undo", none.ok && /Nothing to undo/.test(none.message), JSON.stringify(none));
  setAuto(false);
  for (const x of wave) Object.assign(x, { status: "delivered", delivered_at: ct("2026-10-16", "10:31").toISOString() }); // it arrives
});

// ===================== 13. the guards =====================
await section("guards", async () => {
  const c = campaign();
  const bad = await undoPress(KEY, c.id, "not-a-key");
  const wrongEmail = await undoPress("come-in", c.id, randomUUID());
  check("guards: a malformed key, or another email's id, is refused", !bad.ok && !wrongEmail.ok);
  setClock(ct("2026-10-17", "10:00")); // Saturday
  const key9 = randomUUID();
  await actions.sendNextWave(KEY, key9);
  setAuto(true);
  const queuedBefore = rowsOf(campaign()).length;
  const run = await sender.runCampaign(campaign().id, Date.now() + 30_000);
  check("guards: a run during the minute starts no new wave", rowsOf(campaign()).length === queuedBefore && run.submitted === 0, JSON.stringify(run));
  setAuto(false);
  const resumed = await actions.resumeDesign(KEY);
  check("guards: Carry on has nothing to do while it isn't paused", !resumed.ok);
  advance(5_000);
  const r = await undoPress(KEY, campaign().id, key9);
  check("guards: ...and the Undo still works after that run", r.ok && /^Undone: all 4/.test(r.message), JSON.stringify(r));
  freshShare();
});

// ===================== 14. a hand-over with no clear answer =====================
await section("unclear hand-over", async () => {
  // Resend took the batch, but the answer was lost; the retries got "slow
  // down". The same key is kept, so the next try gets the ids back.
  tick();
  const keyA = randomUUID();
  resend.acceptThenTimeout = 1;
  resend.rateLimitNext = 3;
  const s = await actions.sendNextWave(KEY, keyA);
  const c = campaign();
  const wave = rowsOf(c).filter((r) => r.created_at > new RealDate(Date.now() - 60_000).toISOString());
  const taken = takenFor(wave.map((r) => r.id));
  check("lost answer, then 429s: the batch is asked for again under the same key, so every row has Resend's id (nothing sent twice)", s.ok && wave.length === 4 && taken.length === 4 && wave.every((r) => r.status === "scheduled" && taken.some((e) => e.id === r.resend_email_id)), JSON.stringify([s, wave.map((r) => [r.status, !!r.resend_email_id]), taken.length]));
  advance(10_000);
  const r = await undoPress(KEY, c.id, keyA);
  check("lost answer: Undo calls back every email Resend took for the wave (none left to arrive unseen)", r.ok && /^Undone: all 4/.test(r.message) && taken.every((e) => resend.cancelled.includes(e.id)), JSON.stringify(r));
  freshShare();

  // The same, but Resend keeps saying "slow down": the rows keep the key,
  // and Undo can't find them at Resend, so it says they may have gone.
  tick();
  const keyB = randomUUID();
  resend.acceptThenTimeout = 1;
  resend.rateLimitNext = 7;
  await actions.sendNextWave(KEY, keyB);
  resend.rateLimitNext = 0;
  const c2 = campaign();
  const wave2 = rowsOf(c2).filter((r) => r.created_at > new RealDate(Date.now() - 60_000).toISOString());
  const taken2 = takenFor(wave2.map((r) => r.id));
  check("no answer at all: the rows keep their key (not put back as never sent)", wave2.length === 4 && taken2.length === 4 && wave2.every((r) => r.status === "queued" && !!r.batch_key), JSON.stringify(wave2.map((r) => [r.status, r.batch_key])));
  advance(10_000);
  const r2 = await undoPress(KEY, c2.id, keyB);
  check("no answer at all: Undo says honestly that 4 may have gone out, and keeps their rows", /4 may have gone out/.test(said(r2)) && wave2.every((x) => db.email_sends.some((y) => y.id === x.id && y.error === sender.UNDO_MAYBE)), JSON.stringify(r2));
  const sentBefore = resend.sent.length;
  await sender.runCampaign(c2.id, Date.now() + 30_000);
  check("no answer at all: and they're never sent again", takenFor(wave2.map((x) => x.id)).length === 4 && resend.sent.length === sentBefore);
  freshShare();
});

// ===================== 15. the first wave goes to 25 =====================
await section("first wave of 25", async () => {
  fresh(60, 102); // waves of 100
  // The three who came in lately are the most engaged: first in line.
  const active = db.members.slice(57).map((m) => m.id);
  db.members.slice(57).forEach((m) => (m.last_activity_at = "2026-10-19T18:00:00Z"));
  setClock(ct("2026-10-20", "10:00")); // a Tuesday
  eq("first wave: 25, or the wave size if that's smaller", [sendPlan.FIRST_WAVE, sendPlan.firstWaveSize({ daily: 102, monthly: 3000, reserve: 2 }), sendPlan.firstWaveSize({ daily: 12, monthly: 3000, reserve: 2 })], [25, 25, 10]);
  eq("first wave: the estimate counts it (60 at 100 a day: 25, then 35 the next day; the old figures unchanged)", [sendPlan.sendingDays(60, 100, 100, 25), sendPlan.sendingDays(300, 80, 50), sendPlan.sendingDays(300, 80, 0, 25)], [2, 5, 5]);
  const counts = await ready.countAudiences({ [KEY]: null }, new Date(), { [KEY]: 25 });
  eq("first wave: the screen's 'who's first' is 25 of the 60", [counts[KEY].next.n, counts[KEY].willSend], [25, 60]);

  const k1 = randomUUID();
  const s1 = await actions.sendDesign(KEY, k1);
  let c = campaign();
  check("first wave: Send sends to 25, not a full wave", s1.ok && rowsOf(c).length === 25 && s1.message.startsWith("25 handed to Resend"), JSON.stringify(s1));
  check("first wave: most engaged first (the three who came in lately are in it)", active.every((id) => rowsOf(c).some((r) => r.member_id === id)));
  check("first wave: once it's gone, the next is a full one", !paceOf(c).firstWave);
  const u1 = await undoPress(KEY, c.id, k1);
  check("first wave undone: all 25 called back", u1.ok && u1.message.startsWith("Undone: all 25 called back"), JSON.stringify(u1));
  tick();
  const s2 = await actions.sendDesign(KEY, randomUUID());
  c = campaign();
  check("first wave undone: Send again is a first wave of 25 again", s2.ok && rowsOf(c).length === 25, JSON.stringify(s2));
  advance(10 * 60_000); // it arrives
  for (const r of rowsOf(c)) Object.assign(r, { status: "delivered", delivered_at: new Date().toISOString() });
  setClock(ct("2026-10-21", "10:00"));
  const s3 = await actions.sendNextWave(KEY, randomUUID());
  check("next wave: a full one (the 35 left, under the wave size of 100)", s3.ok && rowsOf(campaign()).length === 60, JSON.stringify([s3, rowsOf(campaign()).length]));
  advance(10 * 60_000);
  for (const r of rowsOf(campaign())) Object.assign(r, { status: "delivered", delivered_at: new Date().toISOString() });

  // Sent before: the same email again to whoever's new starts with 25 again.
  addMembers(40, "New");
  campaign().status = "sent"; // as when its last wave went
  setClock(ct("2026-10-22", "10:00"));
  const before = rowsOf(campaign()).length;
  const s4 = await actions.sendDesign(KEY, randomUUID());
  check("send again: a Send of one that went before starts with 25 again", s4.ok && rowsOf(campaign()).length - before === 25, JSON.stringify([s4, rowsOf(campaign()).length - before]));

  // Waves that go by themselves: the first is 25 too, and no full wave
  // follows the same day.
  fresh(60, 102);
  setAuto(true);
  setClock(ct("2026-10-26", "10:00")); // a Monday
  const a1 = await actions.sendDesign(KEY, randomUUID());
  c = campaign();
  check("automatic waves: the first wave is 25 too", a1.ok && rowsOf(c).length === 25, JSON.stringify(a1));
  advance(10 * 60_000);
  const sameDay = await sender.runCampaign(c.id, Date.now() + 30_000);
  check("automatic waves: no full wave the same day as the first (75 of today's share left)", rowsOf(campaign()).length === 25 && /The next wave goes Tuesday/.test(campaign().error ?? ""), JSON.stringify([sameDay, campaign().error]));
  setClock(ct("2026-10-27", "08:05")); // Tuesday's morning run
  await sender.runCampaign(c.id, Date.now() + 30_000);
  check("automatic waves: the next morning, a full wave (the 35 left)", rowsOf(campaign()).length === 60, String(rowsOf(campaign()).length));
  setAuto(false);

  // Waves set smaller than 25: the first is that size.
  fresh(60, 12);
  setClock(ct("2026-10-28", "10:00"));
  const w1 = await actions.sendDesign(KEY, randomUUID());
  check("wave size 10: the first wave is 10, not 25", w1.ok && rowsOf(campaign()).length === 10, JSON.stringify(w1));
});

// ===================== 16. near 7 PM =====================
await section("near 7 PM", async () => {
  // A weekday, waves by themselves: the 25 are held to tomorrow's 10:30,
  // and the morning run doesn't add a full wave for the same slot. (In
  // summer time, when 6:57 PM is still the same day in UTC.)
  fresh(60, 102);
  setAuto(true);
  setClock(ct("2026-10-29", "18:57")); // a Thursday
  const s = await actions.sendDesign(KEY, randomUUID());
  const c = campaign();
  check("6:57 PM: the first 25 are held to 10:30 tomorrow, and can be undone", s.ok && rowsOf(c).length === 25 && paceOf(c).undo?.arrives === ct("2026-10-30", "10:30").toISOString(), JSON.stringify([s, paceOf(c).undo?.arrives]));
  setClock(ct("2026-10-30", "08:05")); // Friday's morning run
  await sender.runCampaign(c.id, Date.now() + 30_000);
  check("6:57 PM: the next morning's run adds no wave on the day the first one arrives", rowsOf(campaign()).length === 25 && /The next wave goes Saturday/.test(campaign().error ?? ""), JSON.stringify([rowsOf(campaign()).length, campaign().error]));
  setAuto(false);

  // Saturday: the next 10:30 is Monday, past what's handed over now. No
  // hold, no Undo, and the confirm step (the same rule) doesn't promise one.
  fresh(60, 102);
  const sat = ct("2026-10-31", "18:57");
  setClock(sat);
  check("Saturday 6:57 PM: no Undo is possible (the screen asks the same rule as the send)", sender.undoHoldAt(25, new Date()) === null && sender.undoHoldAt(25, ct("2026-10-31", "17:00")) !== null);
  const s2 = await actions.sendDesign(KEY, randomUUID());
  const c2 = campaign();
  check("Saturday 6:57 PM: the wave goes now, with no Undo and no promise of one", s2.ok && rowsOf(c2).length === 25 && !paceOf(c2).undo && !/undo/i.test(s2.message), JSON.stringify([s2, paceOf(c2).undo]));
});

// ===================== 17. Resend won't take scheduled_at on a batch =====================
await section("batch refuses scheduled_at", async () => {
  fresh(60, 102);
  setClock(ct("2026-11-02", "10:00")); // a Monday
  resend.batchRejectsSchedule = true;
  const before = resend.sent.length;
  const s = await actions.sendDesign(KEY, randomUUID());
  const c = campaign();
  const mine = resend.sent.slice(before);
  check(
    "batch refuses scheduled_at: not a bad address: the wave goes one by one (POST /emails), still held, and can be undone",
    s.ok && mine.length === 25 && mine.every((e) => e.single && e.scheduled_at) && rowsOf(c).every((r) => r.status === "scheduled") && !!paceOf(c).undo && c.status !== "paused",
    JSON.stringify([s, c.status, c.error, mine.length]),
  );
  check("batch refuses scheduled_at: nobody is marked failed", !rowsOf(c).some((r) => r.status === "failed"));
  const r = await undoPress(KEY, c.id, paceOf(c).undo?.key);
  check("batch refuses scheduled_at: Undo still calls them all back", r.ok && /^Undone: all 25/.test(r.message), JSON.stringify(r));
  // A wave of one.
  fresh(1, 102);
  tick();
  resend.batchRejectsSchedule = true;
  const one = await actions.sendDesign(KEY, randomUUID());
  check("batch refuses scheduled_at: a wave of one isn't marked failed for good", one.ok && rowsOf(campaign()).length === 1 && rowsOf(campaign())[0].status === "scheduled", JSON.stringify([one, rowsOf(campaign()).map((x) => x.status)]));

  // POST /emails won't take it either: sent without a hold, no Undo, said so.
  fresh(60, 102);
  tick();
  resend.batchRejectsSchedule = true;
  resend.singleRejectsSchedule = true;
  const b2 = resend.sent.length;
  const s2 = await actions.sendDesign(KEY, randomUUID());
  const c2 = campaign();
  const mine2 = resend.sent.slice(b2);
  check(
    "neither takes scheduled_at: the wave goes now without a hold, there's no Undo, and the screen says so",
    s2.ok && mine2.length === 25 && mine2.every((e) => !e.scheduled_at) && rowsOf(c2).every((r) => r.status === "submitted") && !paceOf(c2).undo && /can't be undone/.test(s2.message),
    JSON.stringify([s2, mine2.length, rowsOf(c2).map((r) => r.status).slice(0, 3)]),
  );
  check("neither takes scheduled_at: that's remembered, so later sends don't try", setting("resend_scheduling")?.value?.works === false && !(await sender.holdsWork()));
  resend.batchRejectsSchedule = false;
  resend.singleRejectsSchedule = false;
  // An after-hours wave, with no hold possible: it waits for its time
  // (queued), not handed over to arrive at night.
  setClock(ct("2026-11-02", "19:30"));
  const b3 = resend.sent.length;
  const s3 = await actions.sendDesign("come-in", randomUUID());
  const c3 = campaign("come-in");
  check("no holds: an after-hours wave isn't handed over early (it waits, queued, for 10:30)", s3.ok && resend.sent.length === b3 && rowsOf(c3).length > 0 && rowsOf(c3).every((r) => r.status === "queued"), JSON.stringify([s3, rowsOf(c3).length]));

  // Resend takes scheduled_at but sends at once (asked about the first).
  fresh(60, 102);
  setClock(ct("2026-11-03", "10:00"));
  resend.ignoreSchedule = true;
  const s4 = await actions.sendDesign(KEY, randomUUID());
  resend.ignoreSchedule = false;
  const c4 = campaign();
  check(
    "Resend ignores scheduled_at: noticed (it asks about the first), the wave counts as gone now, no Undo is offered, and the screen says so",
    s4.ok && rowsOf(c4).every((r) => r.status === "submitted") && !paceOf(c4).undo && /can't be undone/.test(s4.message) && setting("resend_scheduling")?.value?.works === false,
    JSON.stringify([s4, rowsOf(c4).map((r) => r.status).slice(0, 3), paceOf(c4).undo]),
  );
  dropSetting("resend_scheduling");
});

// ===================== 18. putting the email back fails partway =====================
await section("put back fails", async () => {
  fresh(60, 102);
  setClock(ct("2026-11-16", "10:00")); // a Monday
  const k = randomUUID();
  await actions.sendDesign(KEY, k);
  const c = campaign();
  advance(10_000);
  faults.push({ table: "email_campaigns", op: "delete" });
  const r1 = await undoPress(KEY, c.id, k);
  const left = db.email_campaigns.find((x) => x.id === c.id);
  check(
    "put back fails: it says so, and leaves the email paused as being undone (not stuck, not half put back)",
    !r1.ok && /Couldn't put the email back as it was\. Press Undo again\./.test(r1.error) && left?.status === "paused" && left.error.startsWith(sender.UNDO_PREFIX) && paceOf(left).undo?.key === k && !rowsOf(c).length,
    JSON.stringify([r1, left?.status, left?.error]),
  );
  const r2 = await undoPress(KEY, c.id, k);
  check("put back fails: pressing Undo again finishes it, and it can be sent again", r2.ok && !db.email_campaigns.some((x) => x.id === c.id) && (await ready.designCampaign(KEY)) === null, JSON.stringify(r2));
});

await flushAfter();
console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
