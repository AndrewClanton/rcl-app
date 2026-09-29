// The print queue end to end, against a running copy of the site and the
// live database, pretending to be the printers. Throwaway printers, jobs and
// one hidden draft order are made for it and always deleted at the end.
//
//  - The Server Direct Print conversation: GetRequest -> job XML ->
//    SetResponse, with Digest (what Epson printers use) and Basic (the Pi
//    relay). Bad and missing passwords, a stale nonce, an ID that doesn't
//    match the login, a switched-off printer.
//  - A printer only ever gets its own jobs, and can't settle another's.
//  - An empty queue is an empty 200. Expired jobs never go out. A failure is
//    retried until it runs out of tries; a job handed out but never answered
//    for goes back in line.
//  - Kitchen order tickets: a tab's held ticket is replaced while it's being
//    rung, later tickets are ADD-ONs with only the new items, items taken
//    off before printing never print, and with no kitchen printer nothing
//    happens.
//  - With --relay: the Pi relay (scripts/pi-print-relay) against a stand-in
//    TM-m30 on this machine.
//
// Usage: node scripts/check-print-queue.mjs [site URL, default http://localhost:3107] [--relay]
//   (the site must be running this branch; Node 23.6+ runs the .ts directly)
import { register } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawnSync, spawn } from "node:child_process";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
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
const { createAdminClient } = await import("../src/lib/supabase/admin.ts");
const { hashPrinterPassword, newNonce } = await import("../src/lib/print/printer-auth.ts");
const { toPrintJobId, fromPrintJobId, parseSdpForm, parseResponseFile } = await import("../src/lib/print/sdp.ts");
const { sendKitchenTicket } = await import("../src/lib/print/kitchen.ts");
const { testPageXml } = await import("../src/lib/print/receipt.ts");

const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:\/\//.test(a)) ?? "http://localhost:3107").replace(/\/$/, "");
const URL_POLL = `${BASE}/api/print/poll`;
const withRelay = args.includes("--relay");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};
const md5 = (s) => createHash("md5").update(s).digest("hex");
const db = createAdminClient();

// ---------- pretend printers ----------
const form = (fields) => new URLSearchParams(fields).toString();
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

async function post(body, headers = {}, url = URL_POLL) {
  const r = await fetch(url, { method: "POST", headers: { ...FORM, ...headers }, body });
  return { status: r.status, text: await r.text(), headers: r.headers };
}
const basic = (user, pass) => ({ Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` });

function challengeParams(h) {
  const out = {};
  for (const m of (h ?? "").matchAll(/(\w+)="?([^",]*)"?/g)) out[m[1].toLowerCase()] = m[2];
  return out;
}

// What an Epson printer does: a bare request, a 401 with a Digest
// challenge, then the real request with the answer.
async function digestPost(user, pass, body, { nonce: forcedNonce, url = URL_POLL } = {}) {
  const first = await post(body, {}, url);
  if (first.status !== 401) return { first, second: null };
  const c = challengeParams(first.headers.get("www-authenticate"));
  const nonce = forcedNonce ?? c.nonce;
  const u = new URL(url);
  const uri = u.pathname + u.search;
  const nc = "00000001";
  const cnonce = randomBytes(8).toString("hex");
  const ha1 = md5(`${user}:${c.realm}:${pass}`);
  const ha2 = md5(`POST:${uri}`);
  const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`);
  const header = `Digest username="${user}", realm="${c.realm}", nonce="${nonce}", uri="${uri}", algorithm=MD5, response="${response}", opaque="${c.opaque}", qop=auth, nc=${nc}, cnonce="${cnonce}"`;
  const second = await post(body, { Authorization: header }, url);
  return { first, second, challenge: c };
}

const jobIdsIn = (xml) => [...xml.matchAll(/<printjobid>([^<]+)<\/printjobid>/g)].map((m) => fromPrintJobId(m[1]));
function responseFile(results) {
  const parts = results
    .map(
      ([id, ok, code = ""]) =>
        `<ePOSPrint><Parameter><devid>local_printer</devid><printjobid>${toPrintJobId(id)}</printjobid></Parameter><PrintResponse><response xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print" success="${ok}" code="${code}" status="251854870" battery="0"/></PrintResponse></ePOSPrint>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?><PrintResponseInfo Version="2.00">${parts}</PrintResponseInfo>`;
}

// ---------- throwaway rows ----------
const made = { printers: [], orderId: null };
async function makePrinter(label, kind) {
  const login = `rcl-test-${randomBytes(4).toString("hex")}`;
  const password = randomBytes(12).toString("base64url");
  const { data, error } = await db
    .from("printers")
    .insert({ name: `Print queue check ${label} (delete me)`, kind, login_id: login, ...hashPrinterPassword(login, password), poll_interval_seconds: 5 })
    .select("id")
    .single();
  if (error) throw new Error(`test printer not made: ${error.message}`);
  made.printers.push(data.id);
  return { id: data.id, login, password };
}
async function addJob(printerId, extra = {}) {
  const { data, error } = await db
    .from("print_jobs")
    .insert({ printer_id: printerId, kind: "test", label: "check", xml: testPageXml(new Date().toISOString()), expires_at: new Date(Date.now() + 600_000).toISOString(), max_attempts: 2, ...extra })
    .select("id")
    .single();
  if (error) throw new Error(`test job not made: ${error.message}`);
  return data.id;
}
const job = async (id) => (await db.from("print_jobs").select("*").eq("id", id).single()).data;

async function cleanup() {
  if (made.orderId) await db.from("orders").delete().eq("id", made.orderId); // its tickets and state go with it
  if (made.printers.length) await db.from("printers").delete().in("id", made.printers); // and their jobs
  // The failed-password counts from this run (nothing else uses these keys yet).
  await db.from("rate_limit_hits").delete().like("key", "print-auth-fail:%");
  const left = await db.from("printers").select("id", { count: "exact", head: true }).like("name", "Print queue check%");
  console.log(`\nCleaned up: test printers left = ${left.count ?? "?"}`);
}

try {
  const ping = await fetch(`${BASE}/api/version`).catch(() => null);
  if (!ping) throw new Error(`Nothing answering at ${BASE}. Start the site first (npx next dev -p 3107).`);

  const A = await makePrinter("A", "sdp");
  const B = await makePrinter("B", "relay");
  const getA = form({ ConnectionType: "GetRequest", ID: A.login, Name: "KitchenTest" });

  // ---- pure protocol pieces ----
  const someId = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
  check("job id survives the 22-character printer form", fromPrintJobId(toPrintJobId(someId)) === someId && toPrintJobId(someId).length === 22);
  check("raw (not URL-encoded) ResponseFile is read whole", parseSdpForm(`ConnectionType=SetResponse&ID=x&ResponseFile=${responseFile([[someId, true]]).replace("status=", "a=\"&amp;\" status=")}`).ResponseFile.endsWith("</PrintResponseInfo>"));
  const v3 = parseResponseFile(`<PrintResponseInfo Version="3.00"><ServerDirectPrint><Response Success="false"><ErrorSummary>Data size is exceeded</ErrorSummary><ErrorDetail>Too big print request</ErrorDetail></Response></ServerDirectPrint></PrintResponseInfo>`);
  check("a refused envelope is noticed", v3.envelopeError === "Data size is exceeded: Too big print request");

  // ---- bad auth ----
  const bare = await post(getA);
  const ch = challengeParams(bare.headers.get("www-authenticate"));
  check("no password: 401 with a Digest challenge", bare.status === 401 && /^Digest /.test(bare.headers.get("www-authenticate") ?? "") && !!ch.nonce && ch.qop === "auth");
  const bareBasic = await post(getA, {}, `${URL_POLL}?auth=basic`);
  check("?auth=basic: challenged with Basic instead", bareBasic.status === 401 && /^Basic /.test(bareBasic.headers.get("www-authenticate") ?? ""));
  check("wrong password (Basic): 401", (await post(getA, basic(A.login, "not-the-password"))).status === 401);
  check("wrong password (Digest): 401", (await digestPost(A.login, "not-the-password", getA)).second?.status === 401);
  check("unknown printer: 401", (await post(getA, basic("rcl-nobody", A.password))).status === 401);
  check("A's password doesn't open B", (await post(form({ ConnectionType: "GetRequest", ID: B.login }), basic(B.login, A.password))).status === 401);
  const old = await digestPost(A.login, A.password, getA, { nonce: newNonce(Date.now() - 11 * 60_000) });
  check("expired nonce: challenged again with stale=true", old.second?.status === 401 && /stale=true/.test(old.second.headers.get("www-authenticate") ?? ""));
  check("form ID not matching the login: 403", (await post(form({ ConnectionType: "GetRequest", ID: B.login }), basic(A.login, A.password))).status === 403);

  // ---- empty queue ----
  const empty = await digestPost(A.login, A.password, getA);
  check("Digest login works; empty queue is an empty 200", empty.second?.status === 200 && empty.second.text === "", `${empty.second?.status} ${empty.second?.text.slice(0, 60)}`);
  const seen = (await db.from("printers").select("last_seen_at, reported_name").eq("id", A.id).single()).data;
  check("poll marks the printer seen and keeps its Name", !!seen.last_seen_at && Date.now() - Date.parse(seen.last_seen_at) < 60_000 && seen.reported_name === "KitchenTest");

  // ---- a printer gets only its own jobs ----
  const a1 = await addJob(A.id);
  const a2 = await addJob(A.id);
  const b1 = await addJob(B.id);
  const gotA = await post(getA, basic(A.login, A.password));
  const idsA = jobIdsIn(gotA.text);
  check("GetRequest returns this printer's jobs as PrintRequestInfo 2.00", gotA.status === 200 && /<PrintRequestInfo Version="2.00">/.test(gotA.text) && gotA.headers.get("content-type")?.startsWith("text/xml"));
  check("both of A's jobs, in order, and never B's", idsA.join() === [a1, a2].join() && !idsA.includes(b1), idsA.join());
  check("job XML goes in PrintData as-is", gotA.text.includes("<PrintData><epos-print xmlns=") && gotA.text.includes("PRINTER TEST"));
  check("handed-out jobs are marked sent", (await job(a1)).status === "sent" && (await job(a1)).attempts === 1);
  check("asking again doesn't hand them out twice", (await post(getA, basic(A.login, A.password))).text === "");
  const gotB = await post(form({ ConnectionType: "GetRequest", ID: B.login }), basic(B.login, B.password));
  check("B gets only B's job", jobIdsIn(gotB.text).join() === b1);

  // ---- results, and retries ----
  await post(form({ ConnectionType: "SetResponse", ID: B.login, ResponseFile: responseFile([[a2, true]]) }), basic(B.login, B.password));
  check("B can't settle A's job", (await job(a2)).status === "sent");
  const set = await post(form({ ConnectionType: "SetResponse", ID: A.login, ResponseFile: responseFile([[a1, true], [a2, false, "EPTR_REC_EMPTY"]]) }), basic(A.login, A.password));
  const j1 = await job(a1);
  const j2 = await job(a2);
  check("SetResponse answered with an empty 200", set.status === 200 && set.text === "");
  check("success marked printed", j1.status === "printed" && !!j1.done_at);
  check("failure goes back in line, a little later, with the reason", j2.status === "queued" && Date.parse(j2.not_before) > Date.now() && /out of paper/.test(j2.error ?? ""), `${j2.status} ${j2.error}`);
  check("not handed out again before its retry time", (await post(getA, basic(A.login, A.password))).text === "");
  await db.from("print_jobs").update({ not_before: new Date(Date.now() - 60_000).toISOString() }).eq("id", a2);
  const retry = await digestPost(A.login, A.password, getA);
  check("retried once its time comes", jobIdsIn(retry.second?.text ?? "").join() === a2 && (await job(a2)).attempts === 2);
  await post(form({ ConnectionType: "SetResponse", ID: A.login, ResponseFile: responseFile([[a2, false, "EPTR_COVER_OPEN"]]) }), basic(A.login, A.password));
  const j2b = await job(a2);
  check("out of tries: failed for good", j2b.status === "failed" && /cover is open/.test(j2b.error ?? ""), `${j2b.status} ${j2b.error}`);
  const bad = await addJob(A.id);
  await post(getA, basic(A.login, A.password));
  await post(form({ ConnectionType: "SetResponse", ID: A.login, ResponseFile: responseFile([[bad, false, "SchemaError"]]) }), basic(A.login, A.password));
  check("a job the printer can't read isn't retried", (await job(bad)).status === "failed");

  // ---- expiry and lost answers ----
  const late = await addJob(A.id, { expires_at: new Date(Date.now() - 1000).toISOString() });
  check("an expired job never goes out", (await post(getA, basic(A.login, A.password))).text === "" && (await job(late)).status === "expired");
  const lost = await addJob(A.id, { status: "sent", attempts: 1, sent_at: new Date(Date.now() - 3 * 60_000).toISOString() });
  const again = await post(getA, basic(A.login, A.password));
  check("handed out but never answered for: sent again", jobIdsIn(again.text).join() === lost && (await job(lost)).attempts === 2);
  await post(form({ ConnectionType: "SetResponse", ID: A.login, ResponseFile: responseFile([[lost, true]]) }), basic(A.login, A.password));

  // An older-format answer with no job ids settles what's out, in order.
  const o1 = await addJob(A.id);
  await post(getA, basic(A.login, A.password));
  await post(form({ ConnectionType: "SetResponse", ID: A.login, ResponseFile: `<PrintResponseInfo Version="1.00"><response xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print" success="true" code="" status="1" battery="0"/></PrintResponseInfo>` }), basic(A.login, A.password));
  check("a version 1.00 answer (no job ids) still settles the job", (await job(o1)).status === "printed");

  // ---- switched off ----
  await db.from("printers").update({ active: false }).eq("id", B.id);
  check("a printer switched off here is refused", (await post(form({ ConnectionType: "GetRequest", ID: B.login }), basic(B.login, B.password))).status === 401);
  await db.from("printers").update({ active: true }).eq("id", B.id);

  // ---- kitchen order tickets ----
  const { data: kitchenNow } = await db.from("printers").select("id").eq("active", true).eq("order_tickets", true);
  if (kitchenNow?.length) {
    console.log("SKIP  kitchen tickets: a real kitchen printer is already set up, so the check won't borrow the job.");
  } else {
    const { data: order, error } = await db
      .from("orders")
      .insert({ order_number: -(100000000 + Math.floor(Math.random() * 1e8)), source: "pos", status: "draft", order_name: "Print queue check (delete me)" })
      .select("id, order_number")
      .single();
    if (error) throw new Error(`test order not made: ${error.message}`);
    made.orderId = order.id;
    const K = { orderId: order.id, orderNumber: 4242, name: "Check", tab: true, station: "outdoor" };
    const line = (name, quantity, modifiers = []) => ({ name, quantity, modifiers });
    const queued = async () => (await db.from("print_jobs").select("id, status, xml, label, not_before").eq("order_id", order.id).eq("status", "queued")).data ?? [];
    const state = async () => (await db.from("order_ticket_state").select("*").eq("order_id", order.id).maybeSingle()).data;

    await sendKitchenTicket({ ...K, lines: [line("Burger", 1)] }, "hold");
    check("no kitchen printer: nothing queued, no state", (await queued()).length === 0 && !(await state()));

    await db.from("printers").update({ order_tickets: true }).eq("id", A.id);
    await sendKitchenTicket({ ...K, lines: [line("Burger", 1, ["No onion"]), { ...line("Movie ticket", 2), screening_id: "x" }] }, "hold");
    let q = await queued();
    check("a tab's first ticket waits a moment", q.length === 1 && Date.parse(q[0].not_before) - Date.now() > 20_000 && q[0].label === "Kitchen #4242");
    check("movie tickets aren't on the kitchen ticket", !q[0].xml.includes("Movie ticket"));
    await sendKitchenTicket({ ...K, lines: [line("Burger", 1, ["No onion"]), line("Fries", 1)] }, "hold");
    q = await queued();
    check("more rung while it waits: one ticket with everything", q.length === 1 && q[0].xml.includes("Burger") && q[0].xml.includes("Fries") && !q[0].xml.includes("ADD-ON"));
    check("state: one ticket, held", (await state()).tickets === 1 && (await state()).pending_job_id === q[0].id);
    check("held ticket isn't handed out early", (await post(getA, basic(A.login, A.password))).text === "");
    await db.from("print_jobs").update({ not_before: new Date(Date.now() - 60_000).toISOString() }).eq("id", q[0].id);
    const kt = await post(getA, basic(A.login, A.password));
    check("then the printer gets it", jobIdsIn(kt.text).join() === q[0].id && kt.text.includes("OUTDOOR STAND"));
    await post(form({ ConnectionType: "SetResponse", ID: A.login, ResponseFile: responseFile([[q[0].id, true]]) }), basic(A.login, A.password));

    await sendKitchenTicket({ ...K, lines: [line("Burger", 1, ["No onion"]), line("Fries", 1), line("Beer", 2)] }, "hold");
    q = await queued();
    check("added after it printed: an ADD-ON with only the new item", q.length === 1 && q[0].xml.includes("ADD-ON") && q[0].xml.includes("2 x Beer") && !q[0].xml.includes("Burger") && q[0].label === "Kitchen #4242 add-on");
    await sendKitchenTicket({ ...K, lines: [line("Burger", 1, ["No onion"]), line("Fries", 1)] }, "hold");
    check("taken back off before it printed: never prints", (await queued()).length === 0 && (await state()).tickets === 1);
    await sendKitchenTicket({ ...K, lines: [line("Burger", 2, ["No onion"]), line("Fries", 1)] }, "now");
    q = await queued();
    check("put away / paid: prints right away, only what's new", q.length === 1 && Date.parse(q[0].not_before) <= Date.now() + 1000 && q[0].xml.includes("1 x Burger") && q[0].xml.includes("ADD-ON"));
    await sendKitchenTicket({ ...K, tab: true, lines: [line("Burger", 2, ["No onion"]), line("Fries", 1)] }, "now");
    check("closing the tab with nothing new prints nothing more", (await queued()).length === 1);
  }

  // ---- the Pi relay ----
  if (withRelay) {
    const py = ["python3", "py", "python"].find((c) => spawnSync(c, ["--version"]).status === 0);
    if (!py) console.log("SKIP  relay: no python on this machine");
    else {
      // A stand-in TM-m30: answers like the real one's ePOS-Print service.
      const got = [];
      let answer = "true";
      const fake = createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          got.push({ url: req.url, body, soap: req.headers.soapaction });
          res.writeHead(200, { "Content-Type": "text/xml" });
          res.end(`<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><response success="${answer}" code="${answer === "true" ? "" : "EPTR_REC_EMPTY"}" status="251658262" battery="0" xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"/></s:Body></s:Envelope>`);
        });
      });
      await new Promise((r) => fake.listen(0, "127.0.0.1", r));
      const port = fake.address().port;
      const env = { ...process.env, RCL_POLL_URL: URL_POLL, RCL_PRINTER_ID: B.login, RCL_PRINTER_PASSWORD: B.password, RCL_PRINTER_URL: `http://127.0.0.1:${port}/cgi-bin/epos/service.cgi`, RCL_INTERVAL: "2" };
      const runOnce = () =>
        new Promise((resolve) => {
          const p = spawn(py, ["scripts/pi-print-relay/rcl_print_relay.py", "--once"], { env });
          let out = "";
          p.stdout.on("data", (d) => (out += d));
          p.stderr.on("data", (d) => (out += d));
          p.on("close", (code) => resolve({ code, out }));
        });
      await db.from("print_jobs").update({ status: "cancelled" }).eq("printer_id", B.id).in("status", ["queued", "sent"]);
      const r1 = await addJob(B.id);
      const run1 = await runOnce();
      check("relay: prints the job on the TM-m30 over plain HTTP", got.length === 1 && got[0].url === "/cgi-bin/epos/service.cgi?devid=local_printer&timeout=20000" && got[0].body.includes("<s:Body><epos-print xmlns=") && got[0].soap === '""', run1.out.trim());
      check("relay: reports it printed", (await job(r1)).status === "printed");
      answer = "false";
      const r2 = await addJob(B.id);
      await runOnce();
      const jr2 = await job(r2);
      check("relay: passes the printer's error back for a retry", jr2.status === "queued" && /out of paper/.test(jr2.error ?? ""), `${jr2.status} ${jr2.error}`);
      const wrong = await new Promise((resolve) => {
        const p = spawn(py, ["scripts/pi-print-relay/rcl_print_relay.py", "--once"], { env: { ...env, RCL_PRINTER_PASSWORD: "wrong" } });
        let out = "";
        p.stdout.on("data", (d) => (out += d));
        p.on("close", () => resolve(out));
      });
      check("relay: says so when its password is wrong", /didn't accept/.test(wrong));
      fake.close();
    }
  }
} catch (e) {
  failures++;
  console.error("ERROR", e);
} finally {
  await cleanup();
}

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll print queue checks passed.");
process.exit(failures ? 1 : 0);
