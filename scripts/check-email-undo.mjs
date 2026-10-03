// Checks "one minute to undo" on Ready to send (src/lib/email/undo.ts,
// undoWave in src/lib/email/campaign-send.ts, and the Ready to send
// actions) against the same in-memory stand-ins for Supabase and Resend as
// check-email-marketing.mjs (scripts/check-email-marketing-fakes.mjs). No
// database, no network, nothing is sent: fetch is replaced before anything
// loads.
//
// The clock is moved to a Tuesday morning, Central (and moved on by the
// checks), so a wave can always go whatever the real time is.
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
const setClock = (iso) => {
  shift = RealDate.parse(iso) - RealDate.now();
};
const advance = (ms) => {
  shift += ms;
};

const fakes = await import(fakesUrl);
const { db, resend, fakeFetch, flushAfter } = fakes;
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

setClock("2026-10-13T10:00:00-05:00"); // a Tuesday, 10 AM Central
db.email_settings.push({ key: "sending_switch", value: { on: true, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
db.email_settings.push({ key: "resend_plan", value: { daily: 6, monthly: 3000, reserve: 2 } }); // waves of 4

const load = (p) => import(pathToFileURL(path.join(src, p)).href);
const sender = await load("lib/email/campaign-send.ts");
const undoLib = await load("lib/email/undo.ts");
const sendPlan = await load("lib/email/send-plan.ts");
const ready = await load("lib/email/designs/ready.ts");
const actions = await load("app/admin/email/ready/actions.ts");

let failures = 0;
let passed = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail && !ok ? `  (${detail})` : ""}`);
  if (ok) passed++;
  else failures++;
};
const eq = (label, got, want) => check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const KEY = "royale-is-here";
// 20 members with no website login: the invite's audience.
for (let i = 0; i < 20; i++) {
  db.members.push({ id: randomUUID(), name: `Member ${i}`, email: `member${i}@example.com`, tier: "Insiders", email_opt_in: true, erased_at: null, created_at: "2026-09-25T12:00:00Z", legacy_user_id: null, auth_user_id: null, phone: "(417) 555-0100" });
}
const campaign = () => db.email_campaigns.find((c) => c.content?.design === KEY && c.status !== "cancelled") ?? null;
const rowsOf = (c) => db.email_sends.filter((s) => s.campaign_id === c?.id);
const paceOf = (c) => c?.content?.pace ?? {};
const sentTo = (rows) => resend.sent.filter((e) => rows.some((r) => r.resend_email_id === e.id));
const willSend = async () => (await ready.countAudiences({ [KEY]: campaign() }, new Date(), 4))[KEY].willSend;
const usedToday = async () => (await sendPlan.listUsage(new Date())).today;
const tick = () => advance(5); // waves a few ms apart, as in life

// ===================== the hold =====================
{
  eq("hold: 25 wait 4 minutes, 80 wait 5, 200 wait 7", [25, 80, 200].map((n) => undoLib.undoHoldMs(n) / 60_000), [4, 5, 7]);
  let ok = true;
  for (let n = 1; n <= undoLib.UNDO_MAX_WAVE; n++) {
    // Undo pressed at the last moment (the minute and the grace), then the
    // waits, then a whole second per email, still ends before Undo stops
    // trying (and that's well before the wave is due).
    const lastPress = undoLib.UNDO_SECONDS * 1000 + undoLib.UNDO_GRACE_MS;
    if (lastPress + 50_000 + n * 1000 > undoLib.undoHoldMs(n) - undoLib.UNDO_STOP_BEFORE_MS) ok = false;
    if (n * 1000 > undoLib.UNDO_RUN_MS) ok = false;
  }
  check("hold: an Undo at the last second can call back every one of the biggest wave at 1 a second, inside one press, before any is due", ok);
  check("hold: a wave over 200 gets no hold and no Undo (Pause covers it)", undoLib.canUndoWave(200) && !undoLib.canUndoWave(201) && !undoLib.canUndoWave(0));
}

// ===================== 1. the first wave, undone inside the minute =====================
let firstIds;
{
  const before = { usage: await usedToday(), audience: await willSend() };
  const key1 = randomUUID();
  const s = await actions.sendDesign(KEY, key1);
  const c = campaign();
  const rows = rowsOf(c);
  const u = paceOf(c).undo;
  check("send: the first wave goes to Resend at once, 4 of them, and says when they arrive", s.ok && rows.length === 4 && rows.every((r) => r.status === "scheduled") && /to arrive about/.test(s.message) && /minute to undo/.test(s.message), JSON.stringify(s));
  const items = sentTo(rows);
  const held = items.map((e) => RealDate.parse(e.scheduled_at) - Date.now());
  check("send: ...each held at Resend (scheduled_at) about 4 minutes, not sent now", items.length === 4 && held.every((ms) => ms > 3.5 * 60_000 && ms <= 4 * 60_000), JSON.stringify(held));
  check("send: ...and its row's deliver_at is that same time (so the caps and Pause see it)", rows.every((r) => r.deliver_at === items.find((e) => e.id === r.resend_email_id)?.scheduled_at));
  check(
    "send: what Undo needs is saved on the email: the press, the minute (60 s by the server's clock), the arrival, the wave's rows, and that it didn't exist before",
    u?.key === key1 && u.wave === 1 && u.n === 4 && u.first === true && u.before === null && RealDate.parse(u.until) - RealDate.parse(u.at) === 60_000 && u.arrives === items[0].scheduled_at && u.after === null && !!u.to,
    JSON.stringify(u),
  );
  eq("send: while it's on its way it counts: today's share and who's had it", [await usedToday(), await willSend()], [before.usage + 4, before.audience - 4]);
  firstIds = rows.map((r) => r.resend_email_id);

  // A reload partway through the minute: worked out from what's saved.
  advance(30_000);
  check("reload: 30 s in, the minute is still open (from the saved times alone)", undoLib.undoOpen(paceOf(campaign()).undo, Date.now()) && !!sender.undoPending(campaign()));
  const other = await actions.sendDesign(KEY, randomUUID());
  check("send: another tab can't send it again meanwhile", !other.ok && /can still be undone/.test(other.error), JSON.stringify(other));

  const cancelledBefore = resend.cancelled.length;
  const r = await actions.undoDesignWave(KEY, c.id, key1);
  check("undo: says exactly how many were called back, and that nobody got it", r.ok && /^Undone: all 4 called back before anyone got it\./.test(r.message) && /send it again/.test(r.message), JSON.stringify(r));
  check("undo: every one of the wave is cancelled at Resend", firstIds.every((id) => resend.cancelled.includes(id)) && resend.cancelled.length - cancelledBefore === 4);
  check("undo: the email is as before Send: no email row, no send rows (Send starts afresh)", !db.email_campaigns.some((x) => x.id === c.id) && !db.email_sends.some((x) => x.campaign_id === c.id) && (await ready.designCampaign(KEY)) === null);
  eq("undo: nobody counts as having had it, and none of today's share is used", [await usedToday(), await willSend()], [before.usage, before.audience]);

  const again = await actions.undoDesignWave(KEY, c.id, key1);
  check("undo twice: harmless (nothing more is cancelled, it says there's nothing to undo)", again.ok && /Nothing to undo/.test(again.message) && resend.cancelled.length - cancelledBefore === 4, JSON.stringify(again));
}

// ===================== 2. sent again; an Undo after the minute is refused =====================
let c2;
{
  tick();
  const key2 = randomUUID();
  const sentBefore = resend.sent.length;
  const s = await actions.sendDesign(KEY, key2);
  c2 = campaign();
  check("send again: a fresh press sends the first wave again, to 4 who haven't had it", s.ok && rowsOf(c2).length === 4 && resend.sent.length - sentBefore === 4 && paceOf(c2).undo?.first === true, JSON.stringify(s));
  advance(66_000); // the minute and the grace are over
  const cancelledBefore = resend.cancelled.length;
  const late = await actions.undoDesignWave(KEY, c2.id, key2);
  check("undo after the minute: refused, by the server's clock", !late.ok && /Too late to undo: the minute is up/.test(late.error) && /Pause still calls back/.test(late.error), JSON.stringify(late));
  check("undo after the minute: nothing cancelled, nothing changed", resend.cancelled.length === cancelledBefore && rowsOf(c2).every((r) => r.status === "scheduled") && campaign().status === "scheduled");
  check("after the minute: no Undo, the wave is simply on its way", !sender.undoPending(campaign()) && Date.now() < RealDate.parse(paceOf(campaign()).undo.arrives));
  // It arrives.
  advance(4 * 60_000);
  for (const r of rowsOf(c2)) Object.assign(r, { status: "delivered", delivered_at: new Date().toISOString() });
}

// ===================== 3. the next wave, undone =====================
{
  setClock("2026-10-14T10:00:00-05:00"); // Wednesday: a new day's share
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
  const r = await actions.undoDesignWave(KEY, c.id, key3);
  const after = campaign();
  check("undo: all 4 of wave 2 called back, and it says it's waiting for Send the next wave again", r.ok && /^Undone: all 4 called back/.test(r.message) && /waiting for Send the next wave again/.test(r.message), JSON.stringify(r));
  check("undo: every one cancelled at Resend, and their rows gone", wave2.every((x) => resend.cancelled.includes(x.resend_email_id)) && rowsOf(after).length === 4 && rowsOf(after).every((x) => x.status === "delivered"));
  eq(
    "undo: back to waiting for Send the next wave, exactly as before (status, note, people left, numbers, wave list)",
    [after.status, after.error, paceOf(after).remaining, paceOf(after).note, paceOf(after).go, after.recipients, after.content.waves.length, after.scheduled_for],
    [before.status, before.error, paceOf(before).remaining, paceOf(before).note, null, before.recipients, before.content.waves.length, before.scheduled_for],
  );
  eq("undo: none of today's share used, and those 4 are back among who haven't had it", [await usedToday(), await willSend()], [0, audienceBefore]);
  const w = await sender.lastWave(after.id);
  check("undo: the wave-by-wave results and the brake don't see it (the last wave is still wave 1)", w?.n === 1 && w.sent === 4, JSON.stringify(w));
  const res = await ready.designResults(after, KEY);
  eq("undo: results show only wave 1", res.waves.map((x) => [x.n, x.sent]), [[1, 4]]);
  // A wave in which the people undone had bounced would have tripped it.
  eq("undo: the brake has nothing to stop", await sender.enforceWaveBrake(after), null);
  const stale = await actions.sendNextWave(KEY, key3);
  check("undo: the undone press's page key can't send it again (a reload gives a new one)", !stale.ok && /undone/.test(stale.error), JSON.stringify(stale));
  const twice = await actions.undoDesignWave(KEY, c.id, key3);
  check("undo twice: says what the first did, and calls back nothing more", twice.ok && /^Already undone: 4 called back\./.test(twice.message), JSON.stringify(twice));
}

// ===================== 4. some had already gone: said honestly, kept =====================
{
  tick();
  const audienceBefore = await willSend();
  const key4 = randomUUID();
  const s = await actions.sendNextWave(KEY, key4);
  const c = campaign();
  const wave = rowsOf(c).filter((r) => r.status === "scheduled");
  check("again: the next wave goes", s.ok && wave.length === 4, JSON.stringify(s));
  resend.cancelGone.add(wave[0].resend_email_id); // Resend had already sent this one
  advance(20_000);
  const r = await actions.undoDesignWave(KEY, c.id, key4);
  const after = campaign();
  const goneRow = db.email_sends.find((x) => x.id === wave[0].id);
  check("partly gone: says 3 of 4 called back and 1 had already gone out", r.ok && /^Called back 3 of 4\. 1 had already gone out, so that person has it/.test(r.message), JSON.stringify(r));
  check("partly gone: that one keeps its row (counted as sent, never sent twice); the 3 are gone", goneRow?.status === "submitted" && wave.slice(1).every((x) => !db.email_sends.some((y) => y.id === x.id)));
  check("partly gone: the email isn't stuck: back to waiting for the next wave, counting the 1", after.status === "scheduled" && after.recipients === 5 && after.content.waves.at(-1).n === 1, JSON.stringify([after.status, after.recipients, after.content.waves]));
  eq("partly gone: today's share counts the 1 that went, and only they count as having had it", [await usedToday(), await willSend()], [1, audienceBefore - 1]);
  resend.cancelGone.clear();
}

// ===================== 5. two tabs press Undo at once; Resend busy =====================
{
  tick();
  const key5 = randomUUID();
  await actions.sendNextWave(KEY, key5);
  const c = campaign();
  const wave = rowsOf(c).filter((r) => r.status === "scheduled");
  advance(10_000);
  resend.cancelFailNext = 2; // Resend busy for the first two cancels
  const cancelledBefore = resend.cancelled.length;
  const [a, b] = await Promise.all([actions.undoDesignWave(KEY, c.id, key5), actions.undoDesignWave(KEY, c.id, key5)]);
  const msgs = [a, b].map((x) => (x.ok ? x.message : x.error));
  const k = wave.length; // 3: one of today's 4 went in the wave before
  check("two tabs: one undoes the wave, the other says it's already done", k === 3 && a.ok && b.ok && msgs.some((m) => m.startsWith(`Undone: all ${k} called back`)) && msgs.some((m) => m.startsWith(`Already undone: ${k} called back`)), JSON.stringify(msgs));
  check("two tabs, Resend busy: every one still called back, each exactly once", resend.cancelled.length - cancelledBefore === k && wave.every((x) => resend.cancelled.includes(x.resend_email_id) && !db.email_sends.some((y) => y.id === x.id)));
  check("two tabs: the email is back to waiting for the next wave", campaign().status === "scheduled" && !paceOf(campaign()).undo);
}

// ===================== 6. Pause in the minute, then Undo =====================
{
  tick();
  const key6 = randomUUID();
  await actions.sendNextWave(KEY, key6);
  const c = campaign();
  const k = rowsOf(c).filter((r) => r.status === "scheduled").length;
  const p = await actions.pauseDesign(KEY);
  check("pause: still works in the minute: paused, the wave called back into the queue", k === 3 && p.ok && campaign().status === "paused" && rowsOf(c).filter((r) => r.status === "queued").length === k && p.message.includes(`${k} called back from Resend`), JSON.stringify(p));
  const r = await actions.undoDesignWave(KEY, c.id, key6);
  check("pause then undo: the whole wave taken back, and it's waiting for the next wave (not left paused)", r.ok && r.message.startsWith(`Undone: all ${k} called back`) && campaign().status === "scheduled" && rowsOf(c).every((x) => x.status !== "queued"), JSON.stringify([r, campaign().status]));
}

// ===================== 7. pressed after hours: held to the morning, still undoable =====================
{
  setClock("2026-10-14T19:30:00-05:00"); // Wednesday 7:30 PM Central (Thursday in UTC, Resend's day)
  const key7 = randomUUID();
  const s = await actions.sendNextWave(KEY, key7);
  const c = campaign();
  const u = paceOf(c).undo;
  const wave = rowsOf(c).filter((r) => r.status === "scheduled");
  check("after hours: the wave is held to 10:30 the next morning, and can be undone for a minute", s.ok && wave.length === 4 && u?.arrives === new RealDate("2026-10-15T10:30:00-05:00").toISOString() && /10:30 AM/.test(s.message), JSON.stringify([s, u?.arrives]));
  advance(45_000);
  const r = await actions.undoDesignWave(KEY, c.id, key7);
  check("after hours: Undo calls them all back", r.ok && /^Undone: all 4/.test(r.message) && wave.every((x) => resend.cancelled.includes(x.resend_email_id)), JSON.stringify(r));
}

// ===================== 8. waves that go by themselves get no Undo =====================
{
  setClock("2026-10-15T08:05:00-05:00"); // Thursday's morning run
  db.email_settings.push({ key: "design_waves", value: { auto: true } });
  const c = campaign();
  const r = await sender.runCampaign(c.id, Date.now() + 30_000); // as the cron does
  const now = campaign();
  const wave = rowsOf(now).filter((x) => x.status === "scheduled" && x.created_at >= new Date(Date.now() - 60_000).toISOString());
  check("morning run: a wave goes (at the 10:30 slot), with no hold and no Undo", r.submitted === 4 && wave.length === 4 && !paceOf(now).undo && wave.every((x) => x.deliver_at === new RealDate("2026-10-15T10:30:00-05:00").toISOString()), JSON.stringify([r, paceOf(now).undo, wave.map((x) => x.deliver_at)]));
  const none = await actions.undoDesignWave(KEY, now.id, randomUUID());
  check("morning run: there's nothing to undo", none.ok && /Nothing to undo/.test(none.message), JSON.stringify(none));
  db.email_settings.splice(db.email_settings.findIndex((x) => x.key === "design_waves"), 1);
  for (const x of wave) Object.assign(x, { status: "delivered", delivered_at: new RealDate("2026-10-15T10:31:00-05:00").toISOString() }); // it arrives
}

// ===================== 9. the guards =====================
{
  const c = campaign();
  const bad = await actions.undoDesignWave(KEY, c.id, "not-a-key");
  const wrongEmail = await actions.undoDesignWave("come-in", c.id, randomUUID());
  check("guards: a malformed key, or another email's id, is refused", !bad.ok && !wrongEmail.ok);
  // The morning run mustn't start a wave over one that can still be undone.
  setClock("2026-10-16T10:00:00-05:00"); // Friday
  const key9 = randomUUID();
  await actions.sendNextWave(KEY, key9);
  db.email_settings.push({ key: "design_waves", value: { auto: true } });
  const queuedBefore = rowsOf(campaign()).length;
  const run = await sender.runCampaign(campaign().id, Date.now() + 30_000);
  check("guards: a run during the minute starts no new wave", rowsOf(campaign()).length === queuedBefore && run.submitted === 0, JSON.stringify(run));
  db.email_settings.splice(db.email_settings.findIndex((x) => x.key === "design_waves"), 1);
  const resumed = await actions.resumeDesign(KEY);
  check("guards: Carry on has nothing to do while it isn't paused", !resumed.ok);
  advance(5_000);
  const r = await actions.undoDesignWave(KEY, campaign().id, key9);
  check("guards: ...and the Undo still works after that run", r.ok && /^Undone: all 4/.test(r.message), JSON.stringify(r));
}

// ===================== 10. Resend doesn't answer: said so, and Undo again finishes it =====================
{
  tick();
  const key10 = randomUUID();
  await actions.sendNextWave(KEY, key10);
  const c = campaign();
  const wave = rowsOf(c).filter((r) => r.status === "scheduled");
  const before = structuredClone(paceOf(c).undo.before);
  // Every cancel fails, and each takes 15 s (the clock moves on with it).
  resend.cancelFailNext = 10_000;
  resend.onCancel = () => advance(15_000);
  const r1 = await actions.undoDesignWave(KEY, c.id, key10);
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
  check("Resend not answering: the minute is over, but Undo is still taken (it was started in time)", Date.now() > RealDate.parse(paceOf(campaign()).undo.until) + 5_000 && !!sender.undoPending(campaign()));
  const r2 = await actions.undoDesignWave(KEY, c.id, key10);
  check(
    "Undo again: calls back the rest and puts the email back as before",
    r2.ok && r2.message.startsWith(`Undone: all ${wave.length} called back`) && wave.every((x) => resend.cancelled.includes(x.resend_email_id)) && campaign().status === before.status && campaign().error === before.error,
    JSON.stringify([r2, campaign().status, campaign().error]),
  );
}

await flushAfter();
console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
