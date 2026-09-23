import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface MemberBooking {
  id: string;
  quantity: number;
  unit_price: number;
  status: string;
  created_at: string;
  screening: {
    id: string;
    starts_at: string;
    movie: { title: string; poster_url: string | null };
    room: { name: string };
  };
}

export interface MemberOrder {
  id: string;
  order_number: number;
  total: number;
  completed_at: string;
  item_count: number;
}

export interface WatchedMovie {
  title: string;
  poster_url: string | null;
  watched_at: string;
}

// All queries here are scoped to a single memberId already confirmed by
// requireMember() -- using the service-role client is safe since members
// has no public-read RLS policy.

export async function getMemberBookings(memberId: string): Promise<MemberBooking[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("id, quantity, unit_price, status, created_at, screening:screenings(id, starts_at, movie:movies(title, poster_url), room:rooms(name))")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as MemberBooking[];
}

export async function getMemberOrders(memberId: string): Promise<MemberOrder[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, total, completed_at, items:order_items(quantity)")
    .eq("member_id", memberId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((o) => ({
    id: o.id,
    order_number: Number(o.order_number),
    total: Number(o.total),
    completed_at: o.completed_at,
    item_count: (o.items as { quantity: number }[]).reduce((s, i) => s + i.quantity, 0),
  }));
}

export async function getWatchedMovies(memberId: string): Promise<WatchedMovie[]> {
  const bookings = await getMemberBookings(memberId);
  const now = Date.now();
  const seen = new Map<string, WatchedMovie>();
  for (const b of bookings) {
    if (b.status !== "confirmed") continue;
    if (new Date(b.screening.starts_at).getTime() > now) continue;
    const key = b.screening.movie.title;
    const existing = seen.get(key);
    if (!existing || new Date(b.screening.starts_at) > new Date(existing.watched_at)) {
      seen.set(key, { title: b.screening.movie.title, poster_url: b.screening.movie.poster_url, watched_at: b.screening.starts_at });
    }
  }
  return [...seen.values()].sort((a, b) => new Date(b.watched_at).getTime() - new Date(a.watched_at).getTime());
}
