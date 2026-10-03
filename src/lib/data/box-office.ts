import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay, businessDayWindow, clock } from "@/lib/ops/time";
import { bookingSeats, fetchAll } from "./reports";

// Reports -> Box office: tickets per movie and per showing, for the film
// distributors (so nobody types it up by hand). Counted by when the show
// is, not when the ticket was sold: a showing belongs to its business day
// (4 a.m. to 4 a.m. Central), so a 12:30 a.m. show is the night before's.
//
// Where the admissions come from:
//   online    bookings bought on the website (order_id empty), confirmed.
//             Paid seats only; an Insiders+ free seat on the same booking
//             is free (bookingSeats in ./reports).
//   register  movie-ticket lines (order_items.screening_id) on completed
//             register orders. Their price is the line's, less the order's
//             member discounts in proportion; their tax is the order's tax
//             in proportion (discounts and tax are both figured on the whole
//             order at the register, lib/register-totals.ts). An Insiders+
//             daily coffee is taken off a coffee, never a ticket, so the
//             proportion is of the order less that.
//   free      $0 tickets: Insiders+ free seats, free screenings, $0 register
//             tickets.
// Refunds: a refunded order or booking isn't counted (a full refund also
// gives its seats back). A partial refund leaves the seats sold, so its
// tickets are counted in full; the partial refunds on orders that had
// tickets are totaled separately to check.

export interface BoxOfficeShow {
  screeningId: string;
  startsAt: string;
  date: string; // business date
  time: string; // "7:00 PM"
  room: string;
  capacity: number;
  ticketPrice: number;
  upcoming: boolean; // hasn't started yet: sales so far
  online: number;
  register: number;
  free: number;
  admissions: number;
  gross: number; // before tax, after member discounts
  tax: number;
  discounts: number; // member discounts taken off register tickets
  handCount: number | null; // attendance typed in by hand on the Showtimes page
  handRevenue: number | null;
}

export interface BoxOfficeTotals {
  shows: number;
  online: number;
  register: number;
  free: number;
  admissions: number;
  gross: number;
  tax: number;
  discounts: number;
  capacity: number;
  avgTicket: number | null; // gross per paid admission
}

export interface BoxOfficeMovie extends BoxOfficeTotals {
  movieId: string;
  title: string;
  releaseYear: number | null;
  showings: BoxOfficeShow[];
}

export interface BoxOfficeReport {
  start: string;
  end: string;
  movies: BoxOfficeMovie[];
  totals: BoxOfficeTotals;
  refundedTickets: number; // refunded or cancelled after payment: not counted
  partialRefunds: { orders: number; amount: number }; // on orders with tickets for these shows
}

type ScreeningRow = {
  id: string;
  movie_id: string;
  starts_at: string;
  ticket_price: number;
  capacity: number;
  attendance_reported: boolean;
  attendance_count: number | null;
  box_office_revenue: number | null;
  movie: { title: string; release_year: number | null } | null;
  room: { name: string } | null;
};

type BookingRow = { screening_id: string; order_id: string | null; quantity: number; unit_price: number; tax_amount: number; status: string };

type TicketLineRow = {
  order_id: string;
  screening_id: string;
  quantity: number;
  unit_price: number;
  // daily_perk_discount: the Insiders+ daily coffee, missing until its
  // migration is applied.
  orders: { status: string; subtotal: number; tax: number; tier_discount: number; monthly_discount: number; redemption_discount: number; daily_perk_discount?: number | null };
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// Long lists of ids go in pieces, so no one request's address gets too long.
function chunks<T>(list: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function emptyTotals(): BoxOfficeTotals {
  return { shows: 0, online: 0, register: 0, free: 0, admissions: 0, gross: 0, tax: 0, discounts: 0, capacity: 0, avgTicket: null };
}

function addTo(t: BoxOfficeTotals, s: BoxOfficeShow) {
  t.shows++;
  t.online += s.online;
  t.register += s.register;
  t.free += s.free;
  t.admissions += s.admissions;
  t.gross = round2(t.gross + s.gross);
  t.tax = round2(t.tax + s.tax);
  t.discounts = round2(t.discounts + s.discounts);
  t.capacity += s.capacity;
  const paid = t.online + t.register;
  t.avgTicket = paid > 0 ? round2(t.gross / paid) : null;
}

// start and end are business dates, both included.
export async function getBoxOfficeReport(start: string, end: string, now = new Date()): Promise<BoxOfficeReport> {
  const supabase = createAdminClient();
  const from = businessDayWindow(start).start;
  const to = businessDayWindow(end).end;

  const screenings = await fetchAll<ScreeningRow>((a, b) =>
    supabase
      .from("screenings")
      .select("id, movie_id, starts_at, ticket_price, capacity, attendance_reported, attendance_count, box_office_revenue, movie:movies(title, release_year), room:rooms(name)")
      .gte("starts_at", from)
      .lt("starts_at", to)
      .order("starts_at")
      .order("id")
      .range(a, b),
  );
  const ids = screenings.map((s) => s.id);

  const [bookings, lines] = await Promise.all([
    Promise.all(
      chunks(ids).map((part) =>
        fetchAll<BookingRow>((a, b) =>
          supabase
            .from("bookings")
            .select("screening_id, order_id, quantity, unit_price, tax_amount, status")
            .in("screening_id", part)
            .in("status", ["confirmed", "refunded"])
            .order("id")
            .range(a, b),
        ),
      ),
    ).then((p) => p.flat()),
    Promise.all(
      chunks(ids).map((part) =>
        fetchAll<TicketLineRow>((a, b) =>
          supabase
            .from("order_items")
            // The order's own columns are "*", so this keeps working before
            // the daily coffee's migration adds daily_perk_discount.
            .select("order_id, screening_id, quantity, unit_price, orders!inner(*)")
            .in("screening_id", part)
            .eq("orders.status", "completed")
            .order("id")
            .range(a, b),
        ),
      ),
    ).then((p) => p.flat()),
  ]);

  const orderIds = [...new Set(lines.map((l) => l.order_id))];
  const partials = (
    await Promise.all(
      chunks(orderIds).map(async (part) => {
        const { data, error } = await supabase.from("order_partial_refunds").select("order_id, amount").in("order_id", part);
        return error ? [] : (data ?? []); // not there until its migration is applied
      }),
    )
  ).flat();

  const shows = new Map<string, BoxOfficeShow>();
  const nowMs = now.getTime();
  for (const s of screenings) {
    shows.set(s.id, {
      screeningId: s.id,
      startsAt: s.starts_at,
      date: businessDay(new Date(s.starts_at)).date,
      time: clock(s.starts_at).replace(/ /g, " "), // a plain space before AM/PM, for spreadsheets
      room: (s.room?.name ?? "").split(" — ")[0],
      capacity: s.capacity,
      ticketPrice: Number(s.ticket_price),
      upcoming: new Date(s.starts_at).getTime() > nowMs,
      online: 0,
      register: 0,
      free: 0,
      admissions: 0,
      gross: 0,
      tax: 0,
      discounts: 0,
      handCount: s.attendance_count ?? null,
      handRevenue: s.box_office_revenue === null ? null : Number(s.box_office_revenue),
    });
  }

  let refundedTickets = 0;
  for (const b of bookings) {
    const show = shows.get(b.screening_id);
    if (!show) continue;
    if (b.status === "refunded") {
      refundedTickets += b.quantity;
      continue;
    }
    if (b.order_id) continue; // register tickets are counted from their order lines below
    const { paid, free } = bookingSeats(b);
    show.online += paid;
    show.free += free;
    show.gross += paid * Number(b.unit_price);
    show.tax += Number(b.tax_amount);
  }

  for (const l of lines) {
    const show = shows.get(l.screening_id);
    if (!show) continue;
    const amount = Number(l.unit_price) * l.quantity;
    const o = l.orders;
    // An Insiders+ daily coffee comes off a coffee, never a ticket, and the
    // other discounts and the tax are figured on what's left after it.
    const base = Number(o.subtotal) - Number(o.daily_perk_discount ?? 0);
    const subtotal = base > 0 ? base : amount;
    const share = subtotal > 0 ? amount / subtotal : 0;
    const discount = Math.min(subtotal, Number(o.tier_discount) + Number(o.monthly_discount) + Number(o.redemption_discount)) * share;
    if (Number(l.unit_price) > 0) show.register += l.quantity;
    else show.free += l.quantity;
    show.gross += amount - discount;
    show.discounts += discount;
    show.tax += Number(o.tax) * share;
  }

  const byMovie = new Map<string, BoxOfficeMovie>();
  for (const s of screenings) {
    const show = shows.get(s.id)!;
    show.admissions = show.online + show.register + show.free;
    show.gross = round2(show.gross);
    show.tax = round2(show.tax);
    show.discounts = round2(show.discounts);
    let movie = byMovie.get(s.movie_id);
    if (!movie) {
      movie = { movieId: s.movie_id, title: s.movie?.title ?? "Untitled", releaseYear: s.movie?.release_year ?? null, showings: [], ...emptyTotals() };
      byMovie.set(s.movie_id, movie);
    }
    movie.showings.push(show);
    addTo(movie, show);
  }

  const totals = emptyTotals();
  for (const m of byMovie.values()) for (const s of m.showings) addTo(totals, s);

  return {
    start,
    end,
    movies: [...byMovie.values()].sort((a, b) => b.gross - a.gross || b.admissions - a.admissions || a.title.localeCompare(b.title)),
    totals,
    refundedTickets,
    partialRefunds: { orders: new Set(partials.map((p) => p.order_id)).size, amount: round2(partials.reduce((s, p) => s + Number(p.amount), 0)) },
  };
}
