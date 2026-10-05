import { createAdminClient } from "@/lib/supabase/admin";
import { contactForRole } from "@/lib/contact-mask";
import type { CommunityProgram, EmployeeRole, Member } from "@/lib/types";
import { cardLabel, type CreditHow } from "@/lib/card-match";
import { schemaMissing } from "@/lib/schema-missing";

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
  organization?: string;
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
  // Everyone with this "Group / organization" label (lib/member-notes.ts),
  // any capitals.
  const org = opts.organization?.trim();
  if (org) q = q.ilike("organization", org.replace(/[\\%_]/g, (c) => `\\${c}`));

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
  // The card that paid ("Visa •••• 4242").
  cardLabel?: string | null;
  // Points the card that paid gave them with nobody attached (not staff):
  // how ('card': the card found them; 'picked': a shared card, the cashier
  // asked who; 'given': given after an undo). Null or missing: attached by
  // staff, or bought themselves.
  cardHow?: CreditHow | null;
  // Online tickets a guest bought with their card: only the points are
  // theirs (the booking isn't on their account).
  pointsOnly?: boolean;
  // A card sale they were attached to whose card has never been linked to
  // them: a manager can link it (lib/member-cards.ts).
  canLinkCard?: boolean;
}

type CardPaymentRow = { fingerprint: string; livemode: boolean; brand: string | null; last4: string | null; wallet: string | null; credited_how: CreditHow | null };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

// Unified purchase history (POS/web orders + ticket bookings) for a single
// member's detail page -- lets staff spot "they were charged twice" at a
// glance and refund the extra one from the same screen. Before migration
// 20261001220000, without the card details.
export async function getMemberPurchaseHistory(memberId: string): Promise<MemberPurchase[]> {
  const supabase = createAdminClient();
  const orderBase = "id, order_number, total, status, payment_method, stripe_payment_intent_id, created_at, items:order_items(quantity)";
  const ordersFor = (columns: string) => supabase.from("orders").select(columns).eq("member_id", memberId).in("status", ["completed", "refunded"]).order("created_at", { ascending: false });
  const [ordersRes, { data: bookings, error: bookingsErr }, linkedRes, creditedRes] = await Promise.all([
    ordersFor(`${orderBase}, member_source, card:card_payments(fingerprint, livemode, brand, last4, wallet, credited_how)`),
    supabase
      .from("bookings")
      .select("id, quantity, unit_price, tax_amount, status, stripe_payment_intent_id, created_at, screening:screenings(starts_at, movie:movies(title))")
      .eq("member_id", memberId)
      // Register tickets are part of their order (refunded with it).
      .is("order_id", null)
      .order("created_at", { ascending: false }),
    // Every card on them, removed ones too (those go back through "Link
    // again" under Linked cards, which asks first).
    supabase.from("member_cards").select("fingerprint, livemode").eq("member_id", memberId),
    // Online tickets a guest bought with a card linked to them: the points
    // are theirs, the booking stays the guest's.
    supabase
      .from("card_payments")
      .select("brand, last4, wallet, credited_how, booking:bookings(id, quantity, unit_price, tax_amount, status, stripe_payment_intent_id, created_at, screening:screenings(starts_at, movie:movies(title)))")
      .eq("credited_member_id", memberId)
      .is("undone_at", null)
      .not("booking_id", "is", null),
  ]);
  let { data: orders, error: ordersErr } = ordersRes;
  if (schemaMissing(ordersErr)) ({ data: orders, error: ordersErr } = await ordersFor(orderBase));
  if (ordersErr) throw ordersErr;
  if (bookingsErr) throw bookingsErr;
  const linked = new Set(linkedRes.error ? [] : (linkedRes.data ?? []).map((c) => `${c.fingerprint}|${c.livemode}`));

  type OrderRow = {
    id: string;
    order_number: number;
    total: number;
    status: string;
    payment_method: string | null;
    stripe_payment_intent_id: string | null;
    created_at: string;
    items: { quantity: number }[];
    member_source?: string | null;
    card?: CardPaymentRow | CardPaymentRow[] | null;
  };
  const orderItems: MemberPurchase[] = ((orders ?? []) as unknown as OrderRow[]).map((o) => {
    const itemCount = o.items.reduce((s, i) => s + i.quantity, 0);
    const card = one(o.card);
    const byCard = !!o.member_source;
    return {
      kind: "order",
      id: o.id,
      label: `Order #${o.order_number} · ${itemCount} item${itemCount === 1 ? "" : "s"}`,
      total: Number(o.total),
      status: o.status,
      paymentMethod: o.payment_method,
      stripePaymentIntentId: o.stripe_payment_intent_id,
      createdAt: o.created_at,
      cardLabel: card ? cardLabel(card) : null,
      cardHow: byCard ? (card?.credited_how ?? "card") : null,
      canLinkCard: !!card && !byCard && o.status === "completed" && !linked.has(`${card.fingerprint}|${card.livemode}`),
    };
  });

  const ticketLabel = (b: { quantity: number; screening: unknown }) => {
    const screening = b.screening as { starts_at: string; movie: { title: string } } | null;
    return screening ? `${b.quantity}x ticket — ${screening.movie.title}` : `${b.quantity}x ticket`;
  };
  const bookingItems: MemberPurchase[] = (bookings ?? []).map((b) => ({
    kind: "booking",
    id: b.id,
    label: ticketLabel(b),
    total: Number(b.unit_price) * b.quantity + Number(b.tax_amount),
    status: b.status,
    paymentMethod: null,
    stripePaymentIntentId: b.stripe_payment_intent_id,
    createdAt: b.created_at,
  }));

  type CreditedRow = {
    brand: string | null;
    last4: string | null;
    wallet: string | null;
    credited_how: CreditHow | null;
    booking: { id: string; quantity: number; unit_price: number; tax_amount: number; status: string; stripe_payment_intent_id: string | null; created_at: string; screening: unknown } | null;
  };
  const creditedItems: MemberPurchase[] = (creditedRes.error ? [] : ((creditedRes.data ?? []) as unknown as CreditedRow[])).flatMap((c) => {
    const b = one(c.booking);
    if (!b) return [];
    return [
      {
        kind: "booking" as const,
        id: b.id,
        label: `${ticketLabel(b)} (bought as a guest)`,
        total: Number(b.unit_price) * b.quantity + Number(b.tax_amount),
        status: b.status,
        paymentMethod: null,
        stripePaymentIntentId: b.stripe_payment_intent_id,
        createdAt: b.created_at,
        cardLabel: cardLabel(c),
        cardHow: c.credited_how ?? "card",
        pointsOnly: true,
      },
    ];
  });

  return [...orderItems, ...bookingItems, ...creditedItems].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// ---------- linked cards (lib/member-cards.ts) ----------

// A member's linked cards for their page in Back office: the ones in use,
// then the ones removed (by them or by staff), with who linked each and how
// many of the member's sales it paid. Never the fingerprint. Empty before
// migration 20261001220000.
export interface MemberCard {
  id: string;
  label: string; // "Visa •••• 4242"; just "Card" once the member removed it
  wallet: boolean;
  source: string; // register | online | plus | staff
  linkedAt: string;
  linkedBy: string | null; // the cashier, for a register link; the manager, for one linked by hand
  lastUsedAt: string | null;
  sales: number;
  test: boolean; // a test-mode card (from trying things out)
  removedAt: string | null;
  removedByMember: boolean;
  removedBy: string | null;
}

export async function getMemberCards(memberId: string): Promise<MemberCard[]> {
  const supabase = createAdminClient();
  const [{ data, error }, { data: sales }] = await Promise.all([
    supabase
      .from("member_cards")
      .select(
        "id, fingerprint, livemode, brand, last4, wallet, source, created_at, last_used_at, removed_at, removed_by_member, linked_by_staff:employees!member_cards_linked_by_fkey(name), removed_by_staff:employees!member_cards_removed_by_fkey(name)",
      )
      .eq("member_id", memberId)
      .order("created_at", { ascending: false }),
    supabase.from("card_payments").select("fingerprint, livemode, order:orders!inner(member_id, status)").eq("order.member_id", memberId).eq("order.status", "completed"),
  ]);
  if (schemaMissing(error)) return [];
  if (error) throw error;
  const count = new Map<string, number>();
  for (const s of sales ?? []) {
    const k = `${s.fingerprint}|${s.livemode}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  type Row = {
    id: string;
    fingerprint: string;
    livemode: boolean;
    brand: string | null;
    last4: string | null;
    wallet: string | null;
    source: string;
    created_at: string;
    last_used_at: string | null;
    removed_at: string | null;
    removed_by_member: boolean;
    linked_by_staff: { name: string } | null;
    removed_by_staff: { name: string } | null;
  };
  return ((data ?? []) as unknown as Row[])
    .map((c) => ({
      id: c.id,
      label: cardLabel({ brand: c.brand, last4: c.last4, wallet: c.wallet }),
      wallet: !!c.wallet && c.wallet !== "link",
      source: c.source,
      linkedAt: c.created_at,
      linkedBy: c.linked_by_staff?.name ?? null,
      lastUsedAt: c.last_used_at,
      sales: count.get(`${c.fingerprint}|${c.livemode}`) ?? 0,
      test: !c.livemode,
      removedAt: c.removed_at,
      removedByMember: c.removed_by_member,
      removedBy: c.removed_by_staff?.name ?? null,
    }))
    .sort((a, b) => Number(!!a.removedAt) - Number(!!b.removedAt));
}
