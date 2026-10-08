import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay, businessDayWindow, clock, shiftDate, shortDay } from "@/lib/ops/time";
import { readTicketCode, ticketCode } from "@/lib/ticket-code";
import { recordVisit } from "@/lib/visits-server";
import { firstNameOf } from "@/lib/checkin";
import {
  bookingNumber,
  printJobFor,
  type ClaimResult,
  type DoorTicket,
  type MemberScanned,
  type ScanRefusal,
  type ScanRefused,
  type ScanResult,
} from "@/lib/door-tickets";

// Tickets at the door. An online ticket's QR code (lib/ticket-code.ts) or a
// member card is scanned at the register; this decides what happens:
//
// - A ticket code for a paid online booking, for a showing today or
//   tomorrow (business days, 4 a.m. to 4 a.m.), is claimed and its keepsake
//   tickets print on the register's printer. Claiming sets bookings.scanned_at
//   only while it's empty, so the same code prints once: a second scan (even
//   on the other register at the same moment) is told when it was printed.
// - A member card checks the member in for today and brings up any tickets
//   they have for today, which the register can print with one tap.
//
// The staff check and the rate limit are in the register's actions
// (app/pos/scan-actions.ts); everything here trusts its caller.

const MEMBER_CODE = /^RCL:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// Showings that start this long past the business day's 4 a.m. end still
// count as today's, for a late-night scan.
const AHEAD_HOURS = 3;

// `*` rather than a column list, so reading still works before the
// door-ticket migration adds scanned_at (it's just missing until then).
const BOOKING_SELECT = "*, screening:screenings(id, starts_at, movie:movies(title, poster_url), room:rooms(name))";

export type BookingRow = {
  id: string;
  screening_id: string;
  order_id: string | null;
  member_id: string | null;
  customer_name: string | null;
  quantity: number;
  status: string;
  scanned_at?: string | null;
  scanned_by?: string | null;
  screening: { id: string; starts_at: string; movie: { title: string; poster_url: string | null } | null; room: { name: string } | null } | null;
};

const OFFLINE = "Couldn't reach the database. Check the connection and try again.";
const NEEDS_UPDATE = "Ticket scanning needs its database update first. Until then, check the confirmation on their phone.";

// A column the door-ticket migration adds isn't there yet: "column does not
// exist" from Postgres, or PostgREST not knowing it.
function missingColumn(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

function refuse(kind: ScanRefused["kind"], reason: ScanRefusal, error: string, ticket?: DoorTicket): ScanRefused {
  return ticket ? { ok: false, kind, reason, error, ticket } : { ok: false, kind, reason, error };
}

const when = (iso: string) => `${shortDay(iso)} at ${clock(iso)}`;

function toDoorTicket(b: BookingRow): DoorTicket {
  const scannedAt = b.scanned_at ?? null;
  const atRegister = !!b.order_id;
  return {
    bookingId: b.id,
    number: bookingNumber(b.id),
    screeningId: b.screening_id,
    title: b.screening?.movie?.title ?? "Movie",
    posterUrl: b.screening?.movie?.poster_url ?? null,
    startsAt: b.screening?.starts_at ?? "",
    room: (b.screening?.room?.name ?? "").split(" — ")[0],
    quantity: b.quantity,
    firstName: b.customer_name?.trim() ? firstNameOf(b.customer_name) : null,
    scannedAt,
    atRegister,
    printable: b.status === "confirmed" && !atRegister && !scannedAt,
    code: ticketCode(b.id),
  };
}

async function loadBooking(id: string): Promise<{ ok: true; booking: BookingRow | null } | { ok: false }> {
  const { data, error } = await createAdminClient().from("bookings").select(BOOKING_SELECT).eq("id", id).maybeSingle();
  if (error) return { ok: false };
  return { ok: true, booking: (data as unknown as BookingRow) ?? null };
}

// Why this booking can't print at the door right now, or null if it can.
// Exported for the checks in scripts/.
export function refusalFor(b: BookingRow, now = new Date()): { reason: ScanRefusal; error: string } | null {
  if (b.status === "refunded") return { reason: "refunded", error: "These tickets were refunded, so they can't be used." };
  if (b.status === "cancelled") return { reason: "cancelled", error: "This booking was cancelled, so it isn't a ticket." };
  if (b.status !== "confirmed") {
    return { reason: "unpaid", error: "This booking's payment hasn't come through. If they just paid, wait a minute and scan again." };
  }
  if (b.order_id) {
    return { reason: "at_register", error: "These tickets were bought at the register and printed with that sale. Reprint them from Recent orders if they're lost." };
  }
  if (b.scanned_at) return { reason: "already_scanned", error: alreadyPrinted(b.scanned_at, null, now) };
  if (!b.screening) return { reason: "not_found", error: "That showing isn't on the schedule anymore. Check with a manager." };
  const today = businessDay(now).date;
  const showDay = businessDay(new Date(b.screening.starts_at)).date;
  if (showDay < today) return { reason: "not_today", error: `These tickets were for ${when(b.screening.starts_at)}. That showing has passed.` };
  if (showDay > shiftDate(today, 1)) return { reason: "not_today", error: `These tickets are for ${when(b.screening.starts_at)}, too early to print. They'll print from the day before.` };
  return null;
}

// "...printed at 7:02 PM by Sam", with the date too if it wasn't today.
function alreadyPrinted(scannedAt: string, by: string | null, now: Date): string {
  const at = businessDay(new Date(scannedAt)).date === businessDay(now).date ? `at ${clock(scannedAt)}` : `on ${when(scannedAt)}`;
  return `These tickets were already printed ${at}${by ? ` by ${by}` : ""}, so they won't print again.`;
}

async function scannerName(employeeId: string | null | undefined): Promise<string | null> {
  if (!employeeId) return null;
  const { data } = await createAdminClient().from("employees").select("name").eq("id", employeeId).maybeSingle();
  return (data?.name as string | undefined)?.trim().split(/\s+/)[0] ?? null;
}

async function refusedBooking(b: BookingRow, r: { reason: ScanRefusal; error: string }): Promise<ScanRefused> {
  const error = r.reason === "already_scanned" && b.scanned_at ? alreadyPrinted(b.scanned_at, await scannerName(b.scanned_by), new Date()) : r.error;
  return refuse("ticket", r.reason, error, toDoorTicket(b));
}

// Claims a booking's tickets for printing: checks it can print, then marks
// it scanned in one conditional update (only while scanned_at is empty), so
// of two registers claiming it at the same moment exactly one wins. Used by
// a ticket-code scan and by the one-tap Print on a member's check-in.
export async function claimBooking(bookingId: string, by: string | null): Promise<ClaimResult> {
  const loaded = await loadBooking(bookingId);
  if (!loaded.ok) return refuse("ticket", "offline", OFFLINE);
  const b = loaded.booking;
  if (!b) return refuse("ticket", "not_found", "No booking goes with that ticket anymore. Check with a manager.");
  const why = refusalFor(b);
  if (why) return refusedBooking(b, why);

  const at = new Date().toISOString();
  const { data, error } = await createAdminClient()
    .from("bookings")
    .update({ scanned_at: at, scanned_by: by })
    .eq("id", b.id)
    .eq("status", "confirmed")
    .is("order_id", null)
    .is("scanned_at", null)
    .select("id");
  if (error) return missingColumn(error) ? refuse("ticket", "needs_update", NEEDS_UPDATE) : refuse("ticket", "offline", OFFLINE);
  if (!data?.length) {
    // Lost to another scan a moment ago (or it was refunded meanwhile):
    // say what it is now.
    const again = await loadBooking(b.id);
    const current = again.ok ? again.booking : null;
    const whyNow = current ? refusalFor(current) : null;
    if (current && whyNow) return refusedBooking(current, whyNow);
    return refuse("ticket", "offline", OFFLINE);
  }

  const ticket: DoorTicket = { ...toDoorTicket(b), scannedAt: at, printable: false };
  return { ok: true, ticket, print: printJobFor(ticket), memberId: b.member_id };
}

// Gives a claim back when its tickets didn't print (printer off, out of
// paper), so scanning again works. Only undoes that exact claim: if it was
// released and claimed again since, this changes nothing.
export async function releaseBooking(bookingId: string, scannedAt: string, by: string | null): Promise<boolean> {
  let q = createAdminClient().from("bookings").update({ scanned_at: null, scanned_by: null }).eq("id", bookingId).eq("scanned_at", scannedAt);
  q = by ? q.eq("scanned_by", by) : q.is("scanned_by", null);
  const { data, error } = await q.select("id");
  return !error && !!data?.length;
}

// A member's confirmed tickets for today's showings (the business day, plus
// anything starting in the next few hours past its 4 a.m. end), soonest
// first. Includes ones already printed and register sales, flagged, so the
// customer screen can show the whole night. Throws if the database can't be
// reached.
export async function ticketsForMemberToday(memberId: string, now = new Date()): Promise<DoorTicket[]> {
  const supabase = createAdminClient();
  const day = businessDayWindow(businessDay(now).date);
  const end = new Date(Math.max(new Date(day.end).getTime(), now.getTime() + AHEAD_HOURS * 3_600_000)).toISOString();
  const { data: shows, error: showsErr } = await supabase.from("screenings").select("id").gte("starts_at", day.start).lt("starts_at", end);
  if (showsErr) throw showsErr;
  if (!shows?.length) return [];
  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_SELECT)
    .eq("member_id", memberId)
    .eq("status", "confirmed")
    .in(
      "screening_id",
      shows.map((s) => s.id as string),
    );
  if (error) throw error;
  return ((data ?? []) as unknown as BookingRow[])
    .map(toDoorTicket)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

async function scanTicket(text: string, by: string | null): Promise<ScanResult> {
  const bookingId = readTicketCode(text);
  if (!bookingId) return refuse("ticket", "invalid", "That ticket code isn't valid. Ask them to open the ticket again and rescan it.");
  const claim = await claimBooking(bookingId, by);
  if (!claim.ok) return claim;
  // They're here: a booking with a member counts as today's visit.
  const visit = claim.memberId ? await recordVisit(claim.memberId, by, new Date(), `door:${by ?? "staff"}`) : null;
  return { ok: true, kind: "ticket", ticket: claim.ticket, print: claim.print, memberId: claim.memberId, visit };
}

async function scanMember(memberId: string, by: string | null): Promise<ScanResult> {
  const { data: m, error } = await createAdminClient().from("members").select("id, name, points").eq("id", memberId).is("erased_at", null).maybeSingle();
  if (error) return refuse("member", "offline", OFFLINE);
  if (!m) return refuse("member", "unknown_member", "That member card isn't on an account anymore. Look them up by name or phone.");
  const visit = await recordVisit(memberId, by, new Date(), `door:${by ?? "staff"}`);
  // The check-in counts even if their tickets can't be listed just now.
  const tickets = await ticketsForMemberToday(memberId).catch(() => []);
  const result: MemberScanned = {
    ok: true,
    kind: "member",
    memberId,
    firstName: firstNameOf(m.name as string),
    points: visit?.balance ?? Number(m.points),
    visit,
    tickets,
  };
  return result;
}

// One scan at the register: an online ticket (RCLT:...) or a member card
// (RCL:<member id>). `by` is the staff member scanning.
export async function redeemScan(text: string, by: string | null): Promise<ScanResult> {
  const t = text.trim();
  if (/^RCLT:/i.test(t)) return scanTicket(t, by);
  const member = t.match(MEMBER_CODE);
  if (member) return scanMember(member[1].toLowerCase(), by);
  return refuse("unknown", "invalid", "That isn't a Royale Cinema ticket or member card.");
}
