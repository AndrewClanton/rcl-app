// Movies and screenings aren't readable with the public key (older MPLC
// titles must never be listable), so every read goes through the server.
import { unstable_cache } from "next/cache";
import { connection } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRestrictedRelease } from "@/lib/mplc";
import { PUBLIC_SCHEDULE_WINDOW_DAYS, isWithinPublicWindow } from "@/lib/public-window";
import type { Screening } from "@/lib/types";

export { PUBLIC_SCHEDULE_WINDOW_DAYS, isWithinPublicWindow };

// Upcoming screenings (now and later), soonest first, with movie + room
// joined. Unwindowed -- for staff/admin tools that need to see and manage
// the full future schedule regardless of what's public yet.
export async function getUpcomingScreenings(): Promise<Screening[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("screenings")
    .select("*, movie:movies(*), room:rooms(*, addons:room_addons(*))")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at");

  if (error) throw error;
  return (data ?? []) as unknown as Screening[];
}

// For in-venue countdown screens: every screening from `sinceMinutes` ago
// onward, so the film that just started stays up while latecomers arrive.
// Unfiltered by MPLC restriction -- only call this from a staff-gated page,
// or run the result through excludeRestrictedReleases first (as the public
// box-office TV does).
// Also returns the server's clock at fetch time, which the screen uses as
// its time reference instead of the TV's own clock.
export async function getScreeningsForCountdown(sinceMinutes: number, limit = 40): Promise<{ screenings: Screening[]; fetchedAt: number }> {
  const supabase = createAdminClient();
  const fetchedAt = Date.now();
  const since = new Date(fetchedAt - sinceMinutes * 60 * 1000);

  const { data, error } = await supabase
    .from("screenings")
    .select("*, movie:movies(*), room:rooms(*, addons:room_addons(*))")
    .gte("starts_at", since.toISOString())
    .order("starts_at")
    .limit(limit);

  if (error) throw error;
  return { screenings: (data ?? []) as unknown as Screening[], fetchedAt };
}

// ---------- tickets sold, for the Showtimes page ----------

// Online checkout holds a seat as a 'pending' booking for 30 minutes (the
// Stripe Checkout page's expiry, see the showtime booking action). A
// pending booking younger than this may be someone paying right now.
const PAYING_WINDOW_MINUTES = 35;

export interface TicketCount {
  sold: number; // tickets on confirmed (paid, or free) bookings
  bookings: number; // how many confirmed bookings those are
  paying: number; // tickets in a checkout that may still go through
}

// Tickets per screening, for the given screening ids. Confirmed bookings
// count as sold; a recent pending one counts as "paying"; refunded and
// cancelled ones don't count.
export async function getTicketCounts(screeningIds: string[]): Promise<Record<string, TicketCount>> {
  const out: Record<string, TicketCount> = {};
  if (screeningIds.length === 0) return out;
  const supabase = createAdminClient();
  const payingSince = Date.now() - PAYING_WINDOW_MINUTES * 60_000;
  // A few dozen ids at a time keeps the request URL short.
  for (let i = 0; i < screeningIds.length; i += 50) {
    const ids = screeningIds.slice(i, i + 50);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("bookings")
        .select("screening_id, quantity, status, created_at")
        .in("screening_id", ids)
        .in("status", ["confirmed", "pending"])
        .order("id")
        .range(from, from + 999);
      if (error) throw error;
      for (const b of data ?? []) {
        const c = (out[b.screening_id as string] ??= { sold: 0, bookings: 0, paying: 0 });
        if (b.status === "confirmed") {
          c.sold += b.quantity;
          c.bookings += 1;
        } else if (Date.parse(b.created_at as string) >= payingSince) c.paying += b.quantity;
      }
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}

export async function getTicketCount(screeningId: string): Promise<TicketCount> {
  return (await getTicketCounts([screeningId]))[screeningId] ?? { sold: 0, bookings: 0, paying: 0 };
}

export interface ScreeningTicket {
  id: string;
  name: string | null;
  email: string | null;
  quantity: number;
  unitPrice: number;
  tax: number;
  status: string; // confirmed | pending | refunded | cancelled
  // Online tickets are refunded one booking at a time; a ticket sold at the
  // register is refunded with its order (Reports).
  orderNumber: number | null;
  paidByCard: boolean;
  createdAt: string;
}

// Everyone holding (or who held) a ticket to one screening, newest first.
// Abandoned checkouts are left out.
export async function getScreeningTickets(screeningId: string): Promise<ScreeningTicket[]> {
  const { data, error } = await createAdminClient()
    .from("bookings")
    .select("id, customer_name, customer_email, quantity, unit_price, tax_amount, status, stripe_payment_intent_id, created_at, member:members(name, email), order:orders(order_number)")
    .eq("screening_id", screeningId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false });
  if (error) throw error;
  type Row = {
    id: string;
    customer_name: string | null;
    customer_email: string | null;
    quantity: number;
    unit_price: number;
    tax_amount: number | null;
    status: string;
    stripe_payment_intent_id: string | null;
    created_at: string;
    member: { name: string; email: string | null } | null;
    order: { order_number: number } | null;
  };
  const payingSince = Date.now() - PAYING_WINDOW_MINUTES * 60_000;
  const rows = ((data ?? []) as unknown as Row[]).filter((b) => b.status !== "pending" || Date.parse(b.created_at) >= payingSince);
  return rows.map((b) => ({
    id: b.id,
    name: b.customer_name ?? b.member?.name ?? null,
    email: b.customer_email ?? b.member?.email ?? null,
    quantity: b.quantity,
    unitPrice: Number(b.unit_price),
    tax: Number(b.tax_amount ?? 0),
    status: b.status,
    orderNumber: b.order ? Number(b.order.order_number) : null,
    paidByCard: !!b.stripe_payment_intent_id,
    createdAt: b.created_at,
  }));
}

export { isRestrictedRelease };

export function excludeRestrictedReleases(screenings: Screening[]): Screening[] {
  return screenings.filter((s) => !isRestrictedRelease(s.movie));
}

// ---------- the public listings (Home, Showtimes, the sitemap) ----------

// The tag on the cached rows below. admin/screenings/actions.ts expires it
// whenever a showing or a film changes, so an edit shows at once.
export const PUBLIC_SCREENINGS_TAG = "public-screenings";

// The cached rows are only trusted this long. unstable_cache is
// stale-while-revalidate: past its 60 seconds it still hands back the old
// copy and refreshes in the background, so on a quiet night the copy can be
// hours old. Older than this, the rows are read again before anything is shown.
const ROWS_MAX_AGE_MS = 2 * 60_000;

type PublicRows = { rows: Screening[]; fetchedAt: number };

// The rows only: every showing from now to a day past the public window,
// unfiltered. Everything that depends on the clock -- started or not, inside
// the window or not, this year's release or not (MPLC) -- is decided per
// request in getPubliclyVisibleScreenings, never from a cached answer.
async function readPublicRows(): Promise<PublicRows> {
  const fetchedAt = Date.now();
  const { data, error } = await createAdminClient()
    .from("screenings")
    .select("*, movie:movies(*), room:rooms(*, addons:room_addons(*))")
    .gte("starts_at", new Date(fetchedAt).toISOString())
    .lte("starts_at", new Date(fetchedAt + (PUBLIC_SCHEDULE_WINDOW_DAYS + 1) * 86_400_000).toISOString())
    .order("starts_at");
  if (error) throw error;
  return { rows: (data ?? []) as unknown as Screening[], fetchedAt };
}

// About one database read a minute while people are browsing, shared by
// every visitor and page (plus one after a quiet spell, see ROWS_MAX_AGE_MS).
const cachedPublicRows = unstable_cache(readPublicRows, ["public-screening-rows-v1"], { revalidate: 60, tags: [PUBLIC_SCREENINGS_TAG] });

// Same as getUpcomingScreenings, but only screenings starting within the
// next PUBLIC_SCHEDULE_WINDOW_DAYS, and excluding anything our MPLC license
// doesn't allow us to advertise -- this is what the public site (and
// anything a visitor can see without being in the building) shows. Matches
// the "we don't publish a full public schedule" policy: the schedule can be
// entered into the system as far out as staff like, but times only appear
// on the public site once they're within the window.
//
// Filtered on every request (connection() makes the calling page render per
// request), so a page never shows a showing that has started, and at
// midnight Central on Jan 1 last year's releases drop off for the very next
// visitor -- fail closed, like the rest of the MPLC checks. Only the raw rows
// are cached.
export async function getPubliclyVisibleScreenings(): Promise<Screening[]> {
  await connection();
  const cached = await cachedPublicRows();
  // Too old to trust after a quiet spell: read them now.
  const { rows } = Date.now() - cached.fetchedAt > ROWS_MAX_AGE_MS ? await readPublicRows() : cached;
  return excludeRestrictedReleases(rows.filter((s) => isWithinPublicWindow(s.starts_at)));
}
