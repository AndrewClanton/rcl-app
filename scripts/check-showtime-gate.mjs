// Checks the proxy's showtime gate (src/lib/showtime-gate.ts) without a
// database: the Supabase lookup is answered by a stand-in fetch that counts
// its calls.
//  1. A browser's fetch() for page data (a tap inside the site, a prefetch
//     of a time chip; Sec-Fetch-Dest: empty) is never checked: no query.
//  2. A whole-page load (Sec-Fetch-Dest: document) and a crawler or link
//     preview (no Sec-Fetch headers at all) are: a past or unknown showtime
//     gets the 404 rewrite, a live one passes.
//  3. The return from checkout (?checkout=success&session_id=...,
//     ?checkout=free&booking_id=...) passes without a query: the page itself
//     shows the ticket, even just after the show started.
//  4. A database that errors or hangs leaves it to the page (no rewrite),
//     and a hanging one is given up on after the timeout.
//
// Usage: node scripts/check-showtime-gate.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";

// showtime-gate.ts imports "@/lib/..." and "next/server" like the rest of
// the app; point those at files plain node can load.
const srcRoot = new URL("../src/", import.meta.url).href;
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        if (s.startsWith("@/")) return next(${JSON.stringify(srcRoot)} + s.slice(2) + ".ts", c);
        if (s === "next/server") return next("next/server.js", c);
        return next(s, c);
      }`,
    ),
);

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "not-a-real-key";

// The stand-in database: what the next lookup answers.
let queries = 0;
let answer = { kind: "row", startsAt: null };
globalThis.fetch = async (input, init) => {
  queries++;
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith("https://example.supabase.test/rest/v1/screenings")) throw new Error(`unexpected fetch ${url}`);
  if (answer.kind === "hang") {
    return new Promise((_, reject) => {
      const signal = init?.signal;
      if (!signal) return; // would hang forever: the check below fails on time
      signal.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")));
    });
  }
  if (answer.kind === "error") return new Response(JSON.stringify({ message: "boom" }), { status: 500, headers: { "content-type": "application/json" } });
  if (answer.kind === "unavailable") return new Response(JSON.stringify({ message: "starting up" }), { status: 503, headers: { "content-type": "application/json" } });
  // PostgREST's answer to a GET: an array of rows (maybeSingle() turns it
  // into the row or null).
  const rows = answer.startsAt === null ? [] : [{ starts_at: answer.startsAt }];
  return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json", "content-range": `0-${rows.length - 1}/${rows.length}` } });
};

const { NextRequest } = await import("next/server.js");
const { rewriteMissingShowtime } = await import("../src/lib/showtime-gate.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const ID = "0b7e9c1a-3f2d-4c5e-8a9b-1c2d3e4f5a6b";
const HOUR = 3_600_000;
const past = new Date(Date.now() - HOUR).toISOString();
const live = new Date(Date.now() + 24 * HOUR).toISOString();
const tooFar = new Date(Date.now() + 30 * 24 * HOUR).toISOString();

const BROWSER_PAGE = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none" };
const BROWSER_FETCH = { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" };
const CRAWLER = { "user-agent": "facebookexternalhit/1.1", accept: "*/*" };

// Runs the gate once; says whether it rewrote to the 404 and how many
// lookups it made.
async function gate(path, headers, db = { kind: "row", startsAt: null }, method = "GET") {
  answer = db;
  queries = 0;
  const res = await rewriteMissingShowtime(new NextRequest(`https://royale.test${path}`, { method, headers }));
  const rewrite = res?.headers.get("x-middleware-rewrite") ?? null;
  return { rewritten: !!rewrite && new URL(rewrite).pathname === "/_missing-showtime", passed: res === null, queries };
}

// ---------- 1. fetch() for page data: never checked ----------
{
  const r = await gate(`/showtimes/${ID}`, BROWSER_FETCH, { kind: "row", startsAt: past });
  check("a client fetch (Sec-Fetch-Dest: empty) of a past showtime passes", r.passed);
  check("...and runs no query", r.queries === 0, `${r.queries} queries`);
}
{
  const r = await gate(`/showtimes/not-a-uuid`, BROWSER_FETCH);
  check("a client fetch of a malformed id passes to the page (its notFound())", r.passed && r.queries === 0);
}
{
  const r = await gate(`/showtimes/${ID}`, { ...BROWSER_FETCH, "sec-fetch-dest": "script" }, { kind: "row", startsAt: past });
  check("any other non-page destination is skipped too", r.passed && r.queries === 0);
}

// ---------- 2. whole-page loads and crawlers: checked ----------
{
  const r = await gate(`/showtimes/${ID}`, BROWSER_PAGE, { kind: "row", startsAt: past });
  check("an opened link to a past showtime gets the 404", r.rewritten, `${r.queries} queries`);
  check("...with one query", r.queries === 1);
}
{
  const r = await gate(`/showtimes/${ID}`, BROWSER_PAGE, { kind: "row", startsAt: live });
  check("an opened link to a live showtime passes", r.passed && r.queries === 1);
}
{
  const r = await gate(`/showtimes/${ID}`, BROWSER_PAGE, { kind: "row", startsAt: tooFar });
  check("an opened link to a showtime past the public window gets the 404", r.rewritten);
}
{
  const r = await gate(`/showtimes/${ID}`, BROWSER_PAGE, { kind: "row", startsAt: null });
  check("an opened link to an unknown showtime gets the 404", r.rewritten && r.queries === 1);
}
{
  const r = await gate(`/showtimes/${ID}/`, { ...BROWSER_PAGE, "sec-fetch-dest": "iframe" }, { kind: "row", startsAt: past });
  check("a page loaded in a frame (and a trailing slash) is checked", r.rewritten);
}
{
  const r = await gate(`/showtimes/${ID}`, CRAWLER, { kind: "row", startsAt: past });
  check("a crawler/link preview (no Sec-Fetch headers, Accept */*) gets the 404", r.rewritten && r.queries === 1);
}
{
  const r = await gate(`/showtimes/${ID}`, CRAWLER, { kind: "row", startsAt: live });
  check("a crawler on a live showtime passes", r.passed);
}
{
  const r = await gate(`/showtimes/not-a-uuid`, CRAWLER);
  check("a malformed id gets the 404 without a query", r.rewritten && r.queries === 0);
}
{
  const r = await gate(`/showtimes/${ID}`, CRAWLER, { kind: "row", startsAt: past }, "HEAD");
  check("HEAD is checked like GET", r.rewritten);
}
{
  const r = await gate(`/showtimes/${ID}`, BROWSER_PAGE, { kind: "row", startsAt: past }, "POST");
  check("a POST (a Server Action) is never touched", r.passed && r.queries === 0);
}
{
  const r = await gate(`/showtimes`, BROWSER_PAGE);
  const r2 = await gate(`/showtimes/${ID}/opengraph-image`, CRAWLER);
  check("other addresses are never touched", r.passed && r2.passed && r.queries + r2.queries === 0);
}

// ---------- 3. back from checkout ----------
{
  const r = await gate(`/showtimes/${ID}?checkout=success&session_id=cs_test_123`, BROWSER_PAGE, { kind: "row", startsAt: past });
  check("a paid checkout's return passes after the start time", r.passed && r.queries === 0);
}
{
  const r = await gate(`/showtimes/${ID}?checkout=free&booking_id=abc`, BROWSER_PAGE, { kind: "row", startsAt: past });
  check("a free booking's return passes after the start time", r.passed && r.queries === 0);
}
{
  const r = await gate(`/showtimes/${ID}?checkout=success`, BROWSER_PAGE, { kind: "row", startsAt: past });
  check("?checkout=success without a session is checked as usual", r.rewritten);
}
{
  const r = await gate(`/showtimes/${ID}?checkout=cancelled`, BROWSER_PAGE, { kind: "row", startsAt: past });
  check("a cancelled checkout's return is checked as usual", r.rewritten);
}

// ---------- 4. a database in trouble: the page decides ----------
{
  const r = await gate(`/showtimes/${ID}`, BROWSER_PAGE, { kind: "error" });
  check("a database error leaves it to the page", r.passed);
}
{
  const started = Date.now();
  const r = await gate(`/showtimes/${ID}`, BROWSER_PAGE, { kind: "unavailable" });
  check("a 503 leaves it to the page, asked once (no 1-2-4 s retries)", r.passed && r.queries === 1 && Date.now() - started < 1000, `${r.queries} queries, ${Date.now() - started} ms`);
}
{
  // AbortSignal.timeout's timer doesn't keep node running on its own (a
  // server always has something else going); this does, for 5 seconds.
  const keepAlive = setTimeout(() => {}, 5000);
  const started = Date.now();
  const r = await Promise.race([gate(`/showtimes/${ID}`, BROWSER_PAGE, { kind: "hang" }), new Promise((resolve) => setTimeout(() => resolve({ passed: false }), 4500))]);
  const took = Date.now() - started;
  clearTimeout(keepAlive);
  check("a database that hangs leaves it to the page", r.passed);
  check("...after the timeout, not forever", took < 5000, `${took} ms`);
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
