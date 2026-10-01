import { createAdminClient } from "@/lib/supabase/admin";
import { contactForRole } from "@/lib/contact-mask";
import type { CommunityProgram, EmployeeRole, Member } from "@/lib/types";

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
//
// `viewerRole` is whoever is looking: a cashier gets email and phone
// shortened (j•••@gmail.com, ••1234) before the rows leave the server; the
// search itself still matches the full details. See lib/contact-mask.ts.
export async function getMembersPage(opts: {
  query?: string;
  page?: number;
  pageSize?: number;
  compedOnly?: boolean;
  viewerRole: EmployeeRole;
}): Promise<MembersPage> {
  const pageSize = opts.pageSize ?? 25;
  const page = Math.max(1, opts.page ?? 1);
  const supabase = createAdminClient();

  let q = supabase.from("members").select(MEMBER_SELECT, { count: "exact" }).is("erased_at", null);
  const query = opts.query?.trim();
  if (query) {
    // Escape wildcard chars so a search for e.g. "50% off" doesn't become a
    // pattern; commas and parentheses would break the filter itself.
    const escaped = query.replace(/[%_]/g, (c) => `\\${c}`).replace(/[,()]/g, " ");
    const filters = [`name.ilike.%${escaped}%`, `email.ilike.%${escaped}%`];
    // Phone numbers however they're typed ("(417) 555-0100", "4175550100",
    // or just the last four), against the digits-only copy.
    const digits = query.replace(/\D/g, "");
    if (digits.length >= 4) filters.push(`phone_digits.like.%${digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits}%`);
    q = q.or(filters.join(","));
  }
  if (opts.compedOnly) q = q.eq("comped", true);

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  // Most recently active first (a check-in, points, a purchase or a booking;
  // kept by the database, see migration 20261001050000), so whoever just
  // came in is at the top. Everyone with no activity yet follows by name.
  const { data, error, count } = await q
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .order("name")
    .range(from, to);
  if (error) throw error;
  const members = ((data ?? []) as unknown as Member[]).map((m) => contactForRole(m, opts.viewerRole));
  return { members, total: count ?? 0, page, pageSize };
}

// Same masking as getMembersPage for a cashier.
export async function getMemberById(id: string, viewerRole: EmployeeRole): Promise<Member | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("members").select(MEMBER_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? contactForRole(data as unknown as Member, viewerRole) : null;
}

export interface EraseLogEntry {
  requested_on: string | null; // YYYY-MM-DD the person asked, if staff entered it
  erased_at: string;
  erased_by_staff: { name: string } | null;
}

// When a removed member asked and when it was done, for the 30-day promise
// on /data-deletion. Null until the member_erasures migration
// (20260929213000) is applied, or for anyone removed before it.
export async function getEraseLogEntry(memberId: string): Promise<EraseLogEntry | null> {
  const { data, error } = await createAdminClient()
    .from("member_erasures")
    .select("requested_on, erased_at, erased_by_staff:employees!member_erasures_erased_by_fkey(name)")
    .eq("member_id", memberId)
    .order("erased_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as EraseLogEntry;
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
      .select("id, quantity, unit_price, tax_amount, status, stripe_payment_intent_id, created_at, screening:screenings(starts_at, movie:movies(title))")
      .eq("member_id", memberId)
      // Register tickets are part of their order (refunded with it).
      .is("order_id", null)
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
      total: Number(b.unit_price) * b.quantity + Number(b.tax_amount),
      status: b.status,
      paymentMethod: null,
      stripePaymentIntentId: b.stripe_payment_intent_id,
      createdAt: b.created_at,
    };
  });

  return [...orderItems, ...bookingItems].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
