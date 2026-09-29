// Tickets at the door against the live database, with throwaway rows that
// are always deleted at the end: a movie with no release year (so it's
// never on a public page), a screening a few hours from now, a member with
// no contact details, and bookings in each state. Safe to run anytime.
//
//  - Every refusal: refunded, cancelled, unpaid, forged code, no booking,
//    unknown member card, junk.
//  - A member's tickets for today.
//  - Before the door-ticket migration (20260930000000): a valid ticket says
//    it needs the database update, and nothing is marked.
//  - After it: a valid ticket prints once; a second scan is told when it
//    printed; two registers claiming at the same moment get exactly one
//    winner; a claim given back after a printer failure can be claimed again.
//
// Doesn't scan member cards: that records a real visit (and points) for the
// throwaway member, which would show on the register's "here today".
//
// Usage: node scripts/check-door-tickets-db.mjs   (Node 23.6+ runs the .ts directly)
import { register } from "node:module";
import { randomUUID } from "node:crypto";
import pg from "pg";
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
const { redeemScan, claimBooking, releaseBooking, ticketsForMemberToday } = await import("../src/lib/ticket-scan.ts");
const { ticketCode, readTicketCode } = await import("../src/lib/ticket-code.ts");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

const c = new pg.Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  user: process.env.SUPABASE_DB_USER || "postgres",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const migrated = (await c.query("select count(*)::int as n from information_schema.columns where table_name = 'bookings' and column_name in ('scanned_at', 'scanned_by')")).rows[0].n === 2;
await c.end();
console.log(migrated ? "Door-ticket migration is applied: checking claims for real.\n" : "Door-ticket migration isn't applied yet: checking that scanning waits for it.\n");

const TITLE = "Door-ticket check (delete me)";
const db = createAdminClient();
const made = { movie: null, screening: null, member: null };
try {
  const { data: room } = await db.from("rooms").select("id").eq("is_screening_room", true).limit(1).single();
  const { data: movie, error: movieErr } = await db.from("movies").insert({ title: TITLE }).select("id").single();
  if (movieErr) throw movieErr;
  made.movie = movie.id;
  const { data: show, error: showErr } = await db
    .from("screenings")
    .insert({ movie_id: movie.id, room_id: room.id, starts_at: new Date(Date.now() + 2 * 3_600_000).toISOString(), ticket_price: 0, capacity: 20 })
    .select("id")
    .single();
  if (showErr) throw showErr;
  made.screening = show.id;
  const { data: member, error: memberErr } = await db.from("members").insert({ name: "Doorcheck Test" }).select("id").single();
  if (memberErr) throw memberErr;
  made.member = member.id;
  const booking = async (status, extra = {}) => {
    const { data, error } = await db.from("bookings").insert({ screening_id: show.id, customer_name: "Sam Doorcheck", quantity: 2, unit_price: 0, status, ...extra }).select("id").single();
    if (error) throw error;
    return data.id;
  };
  const memberTicket = await booking("confirmed", { member_id: member.id });
  const guestTicket = await booking("confirmed");
  const raceTicket = await booking("confirmed");

  // ---------- refusals ----------
  const scan = (text) => redeemScan(text, null);
  let r = await scan(ticketCode(await booking("refunded")));
  check("refunded: refused", !r.ok && r.reason === "refunded" && r.ticket?.title === TITLE, r.error);
  r = await scan(ticketCode(await booking("cancelled")));
  check("cancelled: refused", !r.ok && r.reason === "cancelled", r.error);
  r = await scan(ticketCode(await booking("pending")));
  check("checkout never finished: refused", !r.ok && r.reason === "unpaid", r.error);
  r = await scan(ticketCode(randomUUID()));
  check("a real signature with no booking: not found", !r.ok && r.reason === "not_found", r.error);
  const code = ticketCode(guestTicket);
  r = await scan(code.slice(0, -1) + (code.endsWith("0") ? "1" : "0"));
  check("a forged signature: invalid", !r.ok && r.reason === "invalid", r.error);
  r = await scan(`RCL:${randomUUID()}`);
  check("a member card for no account: refused", !r.ok && r.reason === "unknown_member", r.error);
  r = await scan("hello there");
  check("junk: refused", !r.ok && r.reason === "invalid" && r.kind === "unknown", r.error);

  // ---------- a member's tickets for today ----------
  const today = await ticketsForMemberToday(member.id);
  const t = today[0];
  check("member's tickets today: just their confirmed one", today.length === 1 && t.bookingId === memberTicket);
  check("  with the movie, room, seats and first name", t?.title === TITLE && t.room.length > 0 && t.quantity === 2 && t.firstName === "Sam");
  check("  ready to print, with its own code", t?.printable === true && t.atRegister === false && readTicketCode(t.code) === memberTicket);
  check("someone with nothing tonight: an empty list", (await ticketsForMemberToday(randomUUID())).length === 0);

  if (!migrated) {
    r = await scan(code);
    check("a valid ticket waits for the migration", !r.ok && r.reason === "needs_update", r.error);
    const tap = await claimBooking(memberTicket, null);
    check("so does the one-tap Print", !tap.ok && tap.reason === "needs_update");
  } else {
    // ---------- one for one ----------
    r = await scan(code);
    check("a valid ticket prints", r.ok && r.kind === "ticket" && r.print.orderNumber === `T-${guestTicket.slice(0, 8).toUpperCase()}` && r.print.sales[0].qty === 2 && !!r.ticket.scannedAt, r.ok ? "" : r.error);
    const again = await scan(code);
    check("scanning it again: already printed, and when", !again.ok && again.reason === "already_scanned" && /printed at \d/.test(again.error), again.ok ? "" : again.error);
    if (r.ok) {
      check("a claim can be given back (printer failed)", await releaseBooking(guestTicket, r.ticket.scannedAt, null));
      check("  but only that exact claim", !(await releaseBooking(guestTicket, r.ticket.scannedAt, null)));
      const after = await scan(code);
      check("  and then it prints again", after.ok);
    }
    const [x, y] = await Promise.all([claimBooking(raceTicket, null), claimBooking(raceTicket, null)]);
    check("two registers at the same moment: exactly one prints", [x, y].filter((z) => z.ok).length === 1);
    const loser = [x, y].find((z) => !z.ok);
    check("  the other is told it already printed", loser?.reason === "already_scanned", loser?.error);
    const tap = await claimBooking(memberTicket, null);
    check("one-tap Print claims a member's ticket", tap.ok && tap.memberId === member.id);
    const listed = await ticketsForMemberToday(member.id);
    check("  and their list shows it printed", listed[0]?.printable === false && !!listed[0]?.scannedAt);
  }
} catch (e) {
  failures++;
  console.log("ERROR", e.message ?? e);
} finally {
  // Bookings first: a screening with sold tickets refuses to be deleted.
  if (made.screening) await db.from("bookings").delete().eq("screening_id", made.screening);
  if (made.screening) await db.from("screenings").delete().eq("id", made.screening);
  if (made.movie) await db.from("movies").delete().eq("id", made.movie);
  if (made.member) await db.from("members").delete().eq("id", made.member);
  const [movies, members] = await Promise.all([
    db.from("movies").select("id", { count: "exact", head: true }).eq("title", TITLE),
    db.from("members").select("id", { count: "exact", head: true }).eq("name", "Doorcheck Test"),
  ]);
  check("cleaned up after itself", movies.count === 0 && members.count === 0, `movies ${movies.count}, members ${members.count}`);
}
console.log(failures ? `\n${failures} check(s) failed.` : "\nAll door-ticket database checks passed.");
process.exit(failures ? 1 : 0);
