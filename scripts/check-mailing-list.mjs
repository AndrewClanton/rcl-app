// Checks the members' mailing list code (src/lib/mailing-list.ts,
// src/lib/lineup-send.ts, the lineup email and the Resend webhook) against
// in-memory stand-ins for Supabase and Resend
// (scripts/check-mailing-list-fakes.mjs). No database, no network, nothing
// is sent.
//
// Usage: node scripts/check-mailing-list.mjs   (Node 23.6+ runs the .ts
// directly; its "module type" warning is harmless)
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const fakesUrl = new URL("./check-mailing-list-fakes.mjs", import.meta.url).href;
const STUBBED = { "server-only": fakesUrl, "next/server": fakesUrl, "@/lib/supabase/admin": fakesUrl, "@/lib/data/lineup": fakesUrl };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBBED[specifier]) return { url: STUBBED[specifier], shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const base = path.join(root, "src", specifier.slice(2));
      for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(base + ext)) return { url: pathToFileURL(base + ext).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { db, resend, fakeFetch, flushAfter, setLineup } = await import(fakesUrl);
globalThis.fetch = fakeFetch;
process.env.RESEND_API_KEY = "re_test";
process.env.EMAIL_FROM = "Royale Cinema Lounge <hello@royalecinemajoplin.com>";
delete process.env.RESEND_SEGMENT_ID;

const load = (p) => import(pathToFileURL(path.join(root, "src", p)).href);
const ml = await load("lib/mailing-list.ts");
const sig = await load("lib/email/webhook-signature.ts");
const send = await load("lib/lineup-send.ts");
const email = await load("lib/email/lineup-email.ts");
const hook = await load("app/api/resend/webhook/route.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const member = (id, name, email, optIn, changedAt, extra = {}) => ({ id, name, email, email_opt_in: optIn, email_opt_in_changed_at: changedAt, erased_at: null, ...extra });
const contactsInSeg = () => {
  const seg = resend.segments[0]?.id;
  return [...resend.contacts.values()].filter((c) => c.segments.has(seg)).map((c) => c.email.toLowerCase()).sort();
};

// ---------------------------------------------------------------------------
await test("webhook signature: Svix's published example verifies", () => {
  const ok = sig.verifyResendSignature(
    '{"test": 2432232314}',
    { id: "msg_p5jXN8AQM9LWM0D4loKWxJek", timestamp: "1614265330", signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=" },
    "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
    1614265330 * 1000,
  );
  assert.equal(ok, true);
});

await test("webhook signature: tampered body, wrong secret, stale timestamp all refused", () => {
  const h = { id: "msg_p5jXN8AQM9LWM0D4loKWxJek", timestamp: "1614265330", signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=" };
  assert.equal(sig.verifyResendSignature('{"test": 2432232315}', h, "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", 1614265330 * 1000), false);
  assert.equal(sig.verifyResendSignature('{"test": 2432232314}', h, "whsec_AAAAr8GKYqrTwjUPD8ILPZIo2LaLaSw", 1614265330 * 1000), false);
  assert.equal(sig.verifyResendSignature('{"test": 2432232314}', h, "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", (1614265330 + 600) * 1000), false);
  assert.equal(sig.verifyResendSignature('{"test": 2432232314}', { ...h, signature: null }, "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", 1614265330 * 1000), false);
});

await test("first name for Resend is stripped of markup", () => {
  assert.equal(ml.firstNameOf("Sam <b>Jones"), "Sam");
  assert.equal(ml.firstNameOf("<script>x"), "scriptx");
  assert.equal(ml.firstNameOf("{{{RESEND_UNSUBSCRIBE_URL}}}"), "RESEND_UNSUBSCRIBE_URL");
  assert.equal(ml.firstNameOf(""), null);
});

// ---------------------------------------------------------------------------
await test("backfill: only explicit, un-erased opt-ins with an email go to Resend", async () => {
  db.members.push(
    member("m1", "Ada Lovelace", "ada@example.com", true, ago(60)),
    member("m2", "Default Dan", "dan@example.com", true, null), // old "on by default"
    member("m3", "Opted Out", "out@example.com", false, ago(30)),
    member("m4", "Removed member", null, false, ago(5), { erased_at: ago(5) }),
    member("m5", "No Email", null, true, ago(5)),
    member("m6", "Bea Kiosk", "Bea@Example.com", true, ago(10)),
  );
  const r = await ml.reconcileMailingList("manual");
  assert.equal(r.complete, true, JSON.stringify(r));
  assert.equal(r.added, 2);
  assert.equal(r.subscribers, 2);
  assert.deepEqual(contactsInSeg(), ["ada@example.com", "bea@example.com"]);
  assert.equal(resend.segments.length, 1);
  assert.equal(resend.segments[0].name, "Royale Insiders (website)");
  assert.equal(resend.contacts.get("ada@example.com").first_name, "Ada");
  assert.equal(db.mailing_list_syncs.at(-1).complete, true);
  assert.equal(await ml.countSubscribers(), 2);
});

await test("second sync with nothing changed makes no changes", async () => {
  const before = resend.calls.length;
  const r = await ml.reconcileMailingList("cron");
  assert.equal(r.complete, true);
  assert.equal(r.added + r.removed + r.optedOut, 0);
  // Just the one list call (the segment id is cached).
  assert.deepEqual(resend.calls.slice(before), [`GET /segments/${resend.segments[0].id}/contacts`]);
});

await test("sync removes strays and honors an unsubscribe the webhook missed", async () => {
  const seg = resend.segments[0].id;
  resend.contacts.set("stranger@example.com", { id: "c_x", email: "stranger@example.com", first_name: null, unsubscribed: false, segments: new Set([seg]) });
  resend.contacts.get("ada@example.com").unsubscribed = true; // clicked unsubscribe in an email
  const r = await ml.reconcileMailingList("manual");
  assert.equal(r.complete, true, JSON.stringify(r));
  assert.equal(r.optedOut, 1);
  assert.equal(r.removed, 2);
  assert.deepEqual(contactsInSeg(), ["bea@example.com"]);
  const ada = db.members.find((m) => m.id === "m1");
  assert.equal(ada.email_opt_in, false);
  assert.ok(ada.email_opt_in_changed_at);
});

await test("opting back in on the site re-adds them (fresh opt-in)", async () => {
  const ada = db.members.find((m) => m.id === "m1");
  Object.assign(ada, { email_opt_in: true, email_opt_in_changed_at: new Date().toISOString() });
  const r = await ml.syncMember("m1", { freshOptIn: true });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(contactsInSeg(), ["ada@example.com", "bea@example.com"]);
  assert.equal(resend.contacts.get("ada@example.com").unsubscribed, false);
});

await test("a fresh opt-in overrides an older Resend unsubscribe; a routine sync doesn't", async () => {
  const seg = resend.segments[0].id;
  // Contact still marked unsubscribed in Resend (never cleaned up).
  resend.contacts.set("cy@example.com", { id: "c_cy", email: "cy@example.com", first_name: "Cy", unsubscribed: true, segments: new Set() });
  db.members.push(member("m7", "Cy Young", "cy@example.com", true, new Date().toISOString()));
  assert.deepEqual(await ml.syncMember("m7", { freshOptIn: true }), { ok: true });
  assert.equal(resend.contacts.get("cy@example.com").unsubscribed, false);
  assert.ok(resend.contacts.get("cy@example.com").segments.has(seg));

  resend.contacts.get("cy@example.com").unsubscribed = true;
  assert.deepEqual(await ml.syncMember("m7"), { ok: true });
  assert.equal(db.members.find((m) => m.id === "m7").email_opt_in, false);
  assert.equal(resend.contacts.has("cy@example.com"), false);
});

await test("email change moves the contact; opt-out and erase delete it", async () => {
  const bea = db.members.find((m) => m.id === "m6");
  bea.email = "bea.new@example.com";
  assert.deepEqual(await ml.syncMember("m6", { previousEmail: "Bea@Example.com" }), { ok: true });
  assert.deepEqual(contactsInSeg(), ["ada@example.com", "bea.new@example.com"]);

  const ada = db.members.find((m) => m.id === "m1");
  Object.assign(ada, { email_opt_in: false, email_opt_in_changed_at: new Date().toISOString() });
  assert.deepEqual(await ml.syncMember("m1"), { ok: true });
  assert.deepEqual(contactsInSeg(), ["bea.new@example.com"]);

  // Personal info removed: the row no longer has the email.
  Object.assign(bea, { email: null, email_opt_in: false, erased_at: new Date().toISOString(), name: "Removed member" });
  assert.deepEqual(await ml.syncMember(null, { removeEmail: "bea.new@example.com" }), { ok: true });
  assert.deepEqual(contactsInSeg(), []);
});

await test("sync that runs out of time stops, then finishes on the next pass", async () => {
  for (let i = 0; i < 6; i++) db.members.push(member(`b${i}`, `Bulk ${i}`, `bulk${i}@example.com`, true, ago(1)));
  const first = await ml.reconcileMailingList("manual", 300);
  assert.equal(first.complete, false);
  assert.ok(first.added < 6, `added ${first.added}`);
  let r = first;
  for (let i = 0; i < 10 && !r.complete; i++) r = await ml.reconcileMailingList("manual", 300);
  assert.equal(r.complete, true);
  assert.equal(contactsInSeg().length, 6);
});

await test("a Resend outage is reported, not treated as an empty list", async () => {
  resend.failCount = 2;
  resend.failNext = (method, p) => method === "GET" && p.includes("/contacts");
  const before = resend.contacts.size;
  const r = await ml.reconcileMailingList("manual");
  assert.equal(r.complete, false);
  assert.ok(r.errors.length > 0);
  assert.equal(resend.contacts.size, before);
});

// ---------------------------------------------------------------------------
const hookSecret = "whsec_" + Buffer.from("test-secret-for-webhook-32bytes!").toString("base64");
process.env.RESEND_WEBHOOK_SECRET = hookSecret;
function signedRequest(payload, { secret = hookSecret, ts = Math.floor(Date.now() / 1000) } = {}) {
  const body = JSON.stringify(payload);
  const id = `msg_${Math.random().toString(36).slice(2)}`;
  const key = Buffer.from(secret.slice(6), "base64");
  const s = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return new Request("https://rcl-app.vercel.app/api/resend/webhook", {
    method: "POST",
    headers: { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": `v1,${s}` },
    body,
  });
}

await test("webhook: bad signature is refused and changes nothing", async () => {
  db.members.find((m) => m.id === "b0").email_opt_in_changed_at = ago(60);
  const res = await hook.POST(signedRequest({ type: "contact.updated", data: { email: "bulk0@example.com", unsubscribed: true } }, { secret: "whsec_" + Buffer.from("wrong").toString("base64") }));
  assert.equal(res.status, 400);
  assert.equal(db.members.find((m) => m.id === "b0").email_opt_in, true);
});

await test("webhook: unsubscribe turns email off and takes the contact off Resend", async () => {
  resend.contacts.get("bulk0@example.com").unsubscribed = true;
  const res = await hook.POST(
    signedRequest({ type: "contact.updated", created_at: new Date().toISOString(), data: { email: "BULK0@example.com", unsubscribed: true, updated_at: new Date().toISOString() } }),
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).optedOut, 1);
  await flushAfter();
  assert.equal(db.members.find((m) => m.id === "b0").email_opt_in, false);
  assert.equal(resend.contacts.has("bulk0@example.com"), false);
});

await test("webhook: an unsubscribe older than a newer yes on our site is ignored", async () => {
  const b1 = db.members.find((m) => m.id === "b1");
  b1.email_opt_in_changed_at = new Date().toISOString();
  const res = await hook.POST(signedRequest({ type: "contact.updated", data: { email: "bulk1@example.com", unsubscribed: true, updated_at: ago(30) } }));
  assert.equal((await res.json()).optedOut, 0);
  await flushAfter();
  assert.equal(b1.email_opt_in, true);
  assert.equal(resend.contacts.has("bulk1@example.com"), true);
});

await test("webhook: spam complaint turns email off; resubscribe in Resend never turns it on", async () => {
  const res = await hook.POST(signedRequest({ type: "email.complained", data: { to: ["bulk2@example.com"], broadcast_id: "b" } }));
  assert.equal((await res.json()).optedOut, 1);
  await flushAfter();
  assert.equal(db.members.find((m) => m.id === "b2").email_opt_in, false);

  const res2 = await hook.POST(signedRequest({ type: "contact.updated", data: { email: "bulk2@example.com", unsubscribed: false, updated_at: new Date().toISOString() } }));
  assert.equal((await res2.json()).optedOut, 0);
  assert.equal(db.members.find((m) => m.id === "b2").email_opt_in, false);
});

// ---------------------------------------------------------------------------
setLineup({
  films: [
    { movieId: "mv1", title: "New Release", posterUrl: "https://example.com/p.jpg", rating: "PG-13", runtime: 112, archive: false, showtimes: [{ id: "s1", startsAt: "2026-10-02T00:00:00Z" }, { id: "s2", startsAt: "2026-10-03T02:30:00Z" }] },
    { movieId: "mv2", title: "Labyrinth", posterUrl: null, rating: "PG", runtime: 101, archive: true, showtimes: [{ id: "s3", startsAt: "2026-10-04T00:00:00Z" }] },
  ],
  happenings: [{ id: "h1", title: "Trivia night", note: "Teams of up to 6", startsAt: "2026-10-06T00:00:00Z" }],
});
const input = { start: "2026-10-01", days: 7, skipMovieIds: [], skipHappeningIds: [], includeArchive: true, subject: "", intro: "Big week!\n\nSee you there <3" };
db.employees.push({ id: "emp1", name: "Andrew" });

await test("lineup email: archive titles only in their own section; CAN-SPAM footer; placeholders", async () => {
  const built = await send.composeLineup(input);
  assert.equal(built.ok, true);
  assert.equal(built.subject, "This week at the Royale: Oct 1–7");
  const html = email.lineupEmailHtml(built.email, { mode: "broadcast" });
  assert.ok(html.includes("{{{RESEND_UNSUBSCRIBE_URL}}}"));
  assert.ok(html.includes("{{{contact.first_name|there}}}"));
  assert.ok(html.includes("715 E Broadway, Joplin, MO 64801"));
  assert.ok(html.includes("From the film archive"));
  assert.ok(html.indexOf("Labyrinth") > html.indexOf("From the film archive"));
  assert.ok(html.includes("See you there &lt;3"), "intro escaped");
  assert.ok(html.includes("https://rcl-app.vercel.app/showtimes/s1"));
  // The inbox preview line carries only this year's titles.
  const pre = html.match(/<div style="display:none[^>]*>([^<]*)<\/div>/)[1];
  assert.equal(pre, "New Release");
  const test = email.lineupEmailHtml(built.email, { mode: "test", firstName: "Andrew" });
  assert.ok(!test.includes("{{{"), "no placeholders left in a test");
  assert.ok(test.includes("Hi Andrew,"));
  const noArchive = await send.composeLineup({ ...input, includeArchive: false });
  assert.ok(!email.lineupEmailHtml(noArchive.email, { mode: "broadcast" }).includes("Labyrinth"));
  const text = email.lineupEmailText(built.email, { mode: "broadcast" });
  assert.ok(text.includes("{{{RESEND_UNSUBSCRIBE_URL}}}") && text.includes("715 E Broadway"));
});

await test("send: refuses without a verified-domain sender", async () => {
  process.env.EMAIL_FROM = "Royale Cinema Lounge <onboarding@resend.dev>";
  const r = await send.sendLineupToList(input, { sendKey: "11111111-1111-4111-8111-111111111111", sendAgain: false, employeeId: "emp1" });
  assert.equal(r.ok, false);
  assert.match(r.error, /test address/);
  process.env.EMAIL_FROM = "Royale Cinema Lounge <hello@royalecinemajoplin.com>";
});

await test("send: syncs the list first, sends one broadcast, and a double click doesn't send twice", async () => {
  // Someone opted in at the register kiosk (no website sync ran).
  db.members.push(member("k1", "Kiosk Kim", "kim@example.com", true, ago(2)));
  const key = "22222222-2222-4222-8222-222222222222";
  const r = await send.sendLineupToList(input, { sendKey: key, sendAgain: false, employeeId: "emp1" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const broadcasts = [...resend.broadcasts.values()];
  assert.equal(broadcasts.length, 1);
  const b = broadcasts[0];
  assert.equal(b.status, "queued");
  assert.equal(b.from, "Royale Cinema Lounge <hello@royalecinemajoplin.com>");
  assert.equal(b.reply_to, "info@royalecinemajoplin.com");
  assert.ok(b.recipients.includes("kim@example.com"));
  assert.ok(!b.recipients.includes("bulk0@example.com") && !b.recipients.includes("bulk2@example.com"));
  assert.equal(r.recipients, b.recipients.length);
  const row = db.mailing_sends.find((s) => s.send_key === key);
  assert.equal(row.status, "sent");
  assert.equal(row.resend_broadcast_id, b.id);

  const again = await send.sendLineupToList(input, { sendKey: key, sendAgain: false, employeeId: "emp1" });
  assert.equal(again.ok, true);
  assert.match(again.message, /Already sent/);
  assert.equal(resend.broadcasts.size, 1);
});

await test("send: same week again needs 'send again'; only one send in flight", async () => {
  const r = await send.sendLineupToList(input, { sendKey: "33333333-3333-4333-8333-333333333333", sendAgain: false, employeeId: "emp1" });
  assert.equal(r.ok, false);
  assert.equal(r.alreadySent, true);
  assert.equal(resend.broadcasts.size, 1);

  db.mailing_sends.push({ id: "stuck", send_key: "44444444-4444-4444-8444-444444444444", status: "sending", created_at: ago(1), range_start: "2026-10-08" });
  const busy = await send.sendLineupToList({ ...input, start: "2026-10-08" }, { sendKey: "55555555-5555-4555-8555-555555555555", sendAgain: false, employeeId: "emp1" });
  assert.equal(busy.ok, false);
  assert.match(busy.error, /Another send/);

  // After 10 minutes a stuck send with no broadcast is written off.
  db.mailing_sends.find((s) => s.id === "stuck").created_at = ago(11);
  const ok = await send.sendLineupToList({ ...input, start: "2026-10-08" }, { sendKey: "66666666-6666-4666-8666-666666666666", sendAgain: false, employeeId: "emp1" });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(db.mailing_sends.find((s) => s.id === "stuck").status, "failed");
  assert.equal(resend.broadcasts.size, 2);
});

await test("send: a failed list sync stops the send and frees the slot", async () => {
  resend.failCount = 2;
  resend.failNext = (method, p) => method === "GET" && p.includes("/contacts");
  const r = await send.sendLineupToList({ ...input, start: "2026-10-15" }, { sendKey: "77777777-7777-4777-8777-777777777777", sendAgain: false, employeeId: "emp1" });
  assert.equal(r.ok, false);
  assert.match(r.error, /nothing was sent/);
  assert.equal(resend.broadcasts.size, 2);
  assert.equal(db.mailing_sends.find((s) => s.send_key === "77777777-7777-4777-8777-777777777777").status, "failed");
  assert.equal(db.mailing_sends.filter((s) => s.status === "sending").length, 0);
});

console.log(`\n${passed} passed`);
