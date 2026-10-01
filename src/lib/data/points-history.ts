import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// A member's points history for the Back office, like a bank statement:
// newest first, a page at a time. Staff see who made a manual change; the
// member's own page (lib/data/member-account.ts getPointsLedger) never
// loads that.

export interface PointsHistoryRow {
  id: string;
  at: string;
  when: string; // "Oct 1, 2026, 3:42 PM", Central time
  delta: number;
  balance: number; // the balance right after this row
  reason: string;
  note: string | null;
  orderId: string | null;
  orderNumber: number | null;
  bookingId: string | null;
  movie: string | null; // a ticket's movie
  staffName: string | null; // whoever recorded it (for manual entries)
}

export const POINTS_HISTORY_PAGE = 25;

// Formatted here, on the server, so the page and "Show more" read the same
// in any browser: the Royale's clock, Central time.
const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export async function getPointsHistory(memberId: string, offset = 0, limit = POINTS_HISTORY_PAGE): Promise<{ rows: PointsHistoryRow[]; total: number }> {
  const { data, error, count } = await createAdminClient()
    .from("points_ledger")
    .select(
      "id, delta, balance_after, reason, note, created_at, order_id, booking_id, order:orders(order_number), booking:bookings(screening:screenings(movie:movies(title))), staff:employees!points_ledger_created_by_fkey(name)",
      { count: "exact" },
    )
    .eq("member_id", memberId)
    // A check-in and its badges share one moment; the bigger balance came
    // after (they only ever add), so the statement reads in order.
    .order("created_at", { ascending: false })
    .order("balance_after", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  type Raw = {
    id: string;
    delta: number | string;
    balance_after: number | string;
    reason: string;
    note: string | null;
    created_at: string;
    order_id: string | null;
    booking_id: string | null;
    order: { order_number: number } | null;
    booking: { screening: { movie: { title: string } | null } | null } | null;
    staff: { name: string } | null;
  };
  const rows = ((data ?? []) as unknown as Raw[]).map((l) => ({
    id: l.id,
    at: l.created_at,
    when: WHEN.format(new Date(l.created_at)),
    delta: Number(l.delta),
    balance: Number(l.balance_after),
    reason: l.reason,
    note: l.note,
    orderId: l.order_id,
    orderNumber: l.order?.order_number ?? null,
    bookingId: l.booking_id,
    movie: l.booking?.screening?.movie?.title ?? null,
    staffName: l.staff?.name ?? null,
  }));
  return { rows, total: count ?? rows.length };
}
