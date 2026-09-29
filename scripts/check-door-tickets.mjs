// Checks tickets at the door without a database, printer or scanner:
//  1. The signed ticket code (src/lib/ticket-code.ts): round trip, Caps
//     Lock, tampering, another key, and that its QR stays small.
//  2. When a booking can print at the door (refusalFor in
//     src/lib/ticket-scan.ts): refunds, cancellations, unpaid, register
//     sales, already printed, and the today/tomorrow business-day window.
//  3. The scanner's timing rules (createScanDetector in
//     src/app/pos/useScanner.ts): a scanner's burst vs. a person typing.
//  4. What the customer screen gets: never a code or a booking id.
//
// Usage: node scripts/check-door-tickets.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";
import { randomUUID } from "node:crypto";

// The app's "@/..." imports point at src/, and "server-only" (which throws
// outside Next's server build) is a no-op here.
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

// A made-up key: nothing here talks to the database.
process.env.SUPABASE_SERVICE_ROLE_KEY = "check-door-tickets-key";
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost:9";

const { ticketCode, readTicketCode } = await import("../src/lib/ticket-code.ts");
const { refusalFor } = await import("../src/lib/ticket-scan.ts");
const { createScanDetector, scanKind } = await import("../src/app/pos/useScanner.ts");
const { tabletTickets, printJobFor, bookingNumber } = await import("../src/lib/door-tickets.ts");
const QRCode = (await import("qrcode")).default;

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

// ---------- 1. the code ----------
const id = randomUUID();
const code = ticketCode(id);
check("code looks like RCLT:<32 hex>.<16 hex>", /^RCLT:[0-9A-F]{32}\.[0-9A-F]{16}$/.test(code), code);
check("code reads back to its booking", readTicketCode(code) === id);
check("reads with Caps Lock on (lower case)", readTicketCode(code.toLowerCase()) === id);
check("reads with a stray space or newline", readTicketCode(`  ${code}\n`) === id);
const flip = (s, i) => s.slice(0, i) + (s[i] === "0" ? "1" : "0") + s.slice(i + 1);
check("one changed digit in the booking id is refused", readTicketCode(flip(code, 9)) === null);
check("one changed digit in the signature is refused", readTicketCode(flip(code, code.length - 1)) === null);
const other = ticketCode(randomUUID());
check("another booking's signature is refused", readTicketCode(code.slice(0, 38) + other.slice(38)) === null);
check("a code without a signature is refused", readTicketCode(code.slice(0, 37)) === null);
check("a member card isn't a ticket", readTicketCode(`RCL:${id}`) === null);
check("junk isn't a ticket", readTicketCode("RCLT:hello") === null && readTicketCode("") === null);
check("two bookings get different codes", ticketCode(randomUUID()) !== ticketCode(randomUUID()));
check("the same booking always gets the same code", ticketCode(id) === code && ticketCode(id.toUpperCase()) === code);
process.env.SUPABASE_SERVICE_ROLE_KEY = "some-other-key";
check("a code made under another key is refused", readTicketCode(code) === null);
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
let threw = false;
try {
  ticketCode(id);
} catch {
  threw = true;
}
check("with no key, no code is made and none reads", threw && readTicketCode(code) === null);
process.env.SUPABASE_SERVICE_ROLE_KEY = "check-door-tickets-key";
const qr = QRCode.create(code, { errorCorrectionLevel: "M" });
check("its QR is a small version 3 (29 x 29)", qr.version === 3 && qr.modules.size === 29, `version ${qr.version}`);

// ---------- 2. when a booking can print ----------
// Friday Oct 2, 2026, 8:00 PM Central (CDT, UTC-5).
const now = new Date("2026-10-03T01:00:00Z");
const show = (iso) => ({ id: "s1", starts_at: iso, movie: { title: "Clue", poster_url: null }, room: { name: "Main Theater" } });
const booking = (over = {}) => ({
  id,
  screening_id: "s1",
  order_id: null,
  member_id: null,
  customer_name: "Sam Rivera",
  quantity: 2,
  status: "confirmed",
  scanned_at: null,
  scanned_by: null,
  screening: show("2026-10-03T02:00:00Z"), // 9:00 PM tonight
  ...over,
});
const reason = (b) => refusalFor(b, now)?.reason ?? "ok";
check("paid, tonight, not printed: prints", reason(booking()) === "ok");
check("before the migration (no scanned_at at all): prints", reason({ ...booking(), scanned_at: undefined }) === "ok");
check("refunded: refused", reason(booking({ status: "refunded" })) === "refunded");
check("cancelled: refused", reason(booking({ status: "cancelled" })) === "cancelled");
check("checkout never finished: refused", reason(booking({ status: "pending" })) === "unpaid");
check("bought at the register: refused", reason(booking({ order_id: randomUUID() })) === "at_register");
const printed = refusalFor(booking({ scanned_at: "2026-10-03T00:02:00Z" }), now);
check("already printed: refused, saying when", printed?.reason === "already_scanned" && printed.error.includes("7:02 PM"), printed?.error);
const printedYesterday = refusalFor(booking({ scanned_at: "2026-10-02T00:02:00Z" }), now);
check("printed on another day: says which day", printedYesterday?.error.includes("Thu, Oct 1"), printedYesterday?.error);
check("tomorrow's showing: prints", reason(booking({ screening: show("2026-10-04T01:00:00Z") })) === "ok");
check("after midnight tonight (still today's business day): prints", reason(booking({ screening: show("2026-10-03T06:30:00Z") })) === "ok");
const later = refusalFor(booking({ screening: show("2026-10-05T01:00:00Z") }), now);
check("two days out: refused, too early", later?.reason === "not_today" && later.error.includes("Sun, Oct 4") && later.error.includes("too early"), later?.error);
const past = refusalFor(booking({ screening: show("2026-10-02T01:00:00Z") }), now);
check("yesterday's showing: refused, has passed", past?.reason === "not_today" && past.error.includes("passed"), past?.error);
check("3:30 AM this morning belongs to yesterday's business day", reason(booking({ screening: show("2026-10-02T08:30:00Z") })) === "not_today");
check("a refund wins over already printed", reason(booking({ status: "refunded", scanned_at: "2026-10-03T00:02:00Z" })) === "refunded");

// ---------- 3. the scanner ----------
// Feeds text one key at a time, `gap` ms apart, then Enter after `enterGap`.
function feed(text, gap, enterGap = gap, start = 1000) {
  const d = createScanDetector();
  let t = start;
  for (const ch of text) {
    d.key(ch, t);
    t += gap;
  }
  return d.enter(t - gap + enterGap);
}
const member = `RCL:${id}`;
check("a scanner's burst (8 ms a key) is a scan", feed(code, 8) === code);
check("a member card burst is a scan", feed(member, 8) === member && scanKind(member) === "member" && scanKind(code) === "ticket");
check("Caps Lock burst (lower case) is still a scan", feed(code.toLowerCase(), 8) === code.toLowerCase());
check("a person typing (120 ms a key) is not", feed(code, 120) === null);
check("fast but not quite (40 ms a key) is not", feed(code, 40) === null);
check("an Enter pressed a second later is not", feed(code, 8, 1000) === null);
check("a short burst isn't a code", feed("RCL:12", 5) === null);
check("a fast burst without our prefix isn't a code", feed("HELLO-WORLD-1234567890", 5) === null);
{
  // A person types "ab", pauses, then the scanner fires.
  const d = createScanDetector();
  d.key("a", 0);
  d.key("b", 200);
  let t = 900;
  for (const ch of code) d.key(ch, (t += 7));
  check("typing, a pause, then a scan: just the scan", d.enter(t + 10) === code);
}
{
  // A stray key lands 10 ms before the scanner starts.
  const d = createScanDetector();
  let t = 500;
  d.key("x", t);
  for (const ch of code) d.key(ch, (t += 10));
  check("a stray key just before a scan: just the scan", d.enter(t + 10) === code);
}
{
  // A Bluetooth scanner that's mostly quick with a few late keys.
  const d = createScanDetector();
  let t = 0;
  [...code].forEach((ch, i) => d.key(ch, (t += i % 10 === 5 ? 60 : 10)));
  check("a scanner with a few late keys (60 ms) is still a scan", d.enter(t + 10) === code);
}
{
  // A person-length pause in the middle breaks the burst.
  const d = createScanDetector();
  let t = 0;
  [...code].forEach((ch, i) => d.key(ch, (t += i === 20 ? 300 : 8)));
  check("a burst with a person-length pause inside is not a scan", d.enter(t + 8) === null);
}

// ---------- 4. the customer screen and the printer ----------
const door = {
  bookingId: id,
  number: bookingNumber(id),
  screeningId: "s1",
  title: "Clue",
  posterUrl: null,
  startsAt: "2026-10-03T02:00:00Z",
  room: "Main Theater",
  quantity: 2,
  firstName: "Sam",
  scannedAt: null,
  atRegister: false,
  printable: true,
  code,
};
const tablet = tabletTickets([door, { ...door, printable: false }]);
check(
  "the customer screen gets no code or booking id",
  !JSON.stringify(tablet).includes(code.slice(5, 37)) && !JSON.stringify(tablet).includes(id) && Object.keys(tablet[0]).sort().join() === "posterUrl,quantity,room,startsAt,status,title",
);
check("printed or not, the screen says which", tablet[0].status === "to_print" && tablet[1].status === "printed");
const job = printJobFor(door);
check("the print job is what printTickets takes", job.orderNumber === `T-${id.slice(0, 8).toUpperCase()}` && job.sales.length === 1 && job.sales[0].qty === 2 && job.sales[0].screeningId === "s1");

console.log(failures ? `\n${failures} check(s) failed.` : "\nAll door-ticket checks passed.");
process.exit(failures ? 1 : 0);
