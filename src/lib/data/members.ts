import { createAdminClient } from "@/lib/supabase/admin";
import type { CommunityProgram, Member } from "@/lib/types";

const MEMBER_SELECT =
  "*, community_program:community_programs(name), rate_set_by:employees!members_price_tier_set_by_fkey(name), erased_by_staff:employees!members_erased_by_fkey(name)";

export interface MembersPage {
  members: Member[];
  total: number;
  page: number;
  pageSize: number;
}

// Members has no public-read RLS policy (unlike movies/menu/rooms) since
// it holds contact info -- always read via the service-role client. Only
// call this from admin/staff-only surfaces.
//
// Paginated + searched at the DB level (not fetch-all-then-filter) --
// the business has ~3,000 members, too many to reasonably mount as
// editable rows in the browser at once.
export async function getMembersPage(opts: { query?: string; page?: number; pageSize?: number; compedOnly?: boolean }): Promise<MembersPage> {
  const pageSize = opts.pageSize ?? 25;
  const page = Math.max(1, opts.page ?? 1);
  const supabase = createAdminClient();

  let q = supabase.from("members").select(MEMBER_SELECT, { count: "exact" }).is("erased_at", null);
  const query = opts.query?.trim();
  if (query) {
    // Escape wildcard chars so a search for e.g. "50% off" doesn't become a pattern.
    const escaped = query.replace(/[%_]/g, (c) => `\\${c}`);
    q = q.or(`name.ilike.%${escaped}%,email.ilike.%${escaped}%`);
  }
  if (opts.compedOnly) q = q.eq("comped", true);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data, error, count } = await q.order("name").range(from, to);
  if (error) throw error;
  return { members: (data ?? []) as unknown as Member[], total: count ?? 0, page, pageSize };
}

export async function getMemberById(id: string): Promise<Member | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("members").select(MEMBER_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as unknown as Member) ?? null;
}

export async function getCommunityPrograms(): Promise<CommunityProgram[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("community_programs").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export interface MemberPurchase {
  kind: "order" | "booking";
  id: string;
  label: string;
  total: number;
  status: string;
  paymentMethod: string | null;
  stripePaymentIntentId: string | null;
  createdAt: string;
}

// Unified purchase history (POS/web orders + ticket bookings) for a single
// member's detail page -- lets staff spot "they were charged twice" at a
// glance and refund the extra one from the same screen.
export async function getMemberPurchaseHistory(memberId: string): Promise<MemberPurchase[]> {
  const supabase = createAdminClient();
  const [{ data: orders, error: ordersErr }, { data: bookings, error: bookingsErr }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_number, total, status, payment_method, stripe_payment_intent_id, created_at, items:order_items(quantity)")
      .eq("member_id", memberId)
      .in("status", ["completed", "refunded"])
      .order("created_at", { ascending: false }),
    supabase
      .from("bookings")
      .select("id, quantity, unit_price, status, stripe_payment_intent_id, created_at, screening:screenings(starts_at, movie:movies(title))")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false }),
  ]);
  if (ordersErr) throw ordersErr;
  if (bookingsErr) throw bookingsErr;

  const orderItems: MemberPurchase[] = (orders ?? []).map((o) => {
    const itemCount = (o.items as { quantity: number }[]).reduce((s, i) => s + i.quantity, 0);
    return {
      kind: "order",
      id: o.id,
      label: `Order #${o.order_number} · ${itemCount} item${itemCount === 1 ? "" : "s"}`,
      total: Number(o.total),
      status: o.status,
      paymentMethod: o.payment_method,
      stripePaymentIntentId: o.stripe_payment_intent_id,
      createdAt: o.created_at,
    };
  });

  const bookingItems: MemberPurchase[] = (bookings ?? []).map((b) => {
    const screening = b.screening as unknown as { starts_at: string; movie: { title: string } } | null;
    return {
      kind: "booking",
      id: b.id,
      label: screening ? `${b.quantity}x ticket — ${screening.movie.title}` : `${b.quantity}x ticket`,
      total: Number(b.unit_price) * b.quantity,
      status: b.status,
      paymentMethod: null,
      stripePaymentIntentId: b.stripe_payment_intent_id,
      createdAt: b.created_at,
    };
  });

  return [...orderItems, ...bookingItems].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
