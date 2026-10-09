import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Back office > Members > Indy history review. Read-only: what the old Indy
// register's staged history would turn into as points, so the owners can
// check the specifics before anything is given. Nothing here writes.
// Views: supabase/migrations/20261009080000_indy_review_views.sql.

export const OVER_LIMIT = 1000; // proposed points above this need a manual look

export interface IndyReviewMember {
  memberId: string;
  name: string;
  email: string | null;
  matchKinds: string;
  orders: number;
  purchaseCents: number;
  taxCents: number;
  firstAt: string | null;
  lastAt: string | null;
  points: number;
  indyRemaining: number;
  indyPreloaded: number;
  rclPoints: number;
  staff: boolean;
  indyEmployee: boolean;
  fortisPoints: number | null;
  sameName: boolean;
  phoneOther: boolean;
}

export interface IndyUnmatched {
  indyUserId: string;
  name: string | null;
  email: string | null;
  orders: number;
  purchaseCents: number;
  firstAt: string | null;
  lastAt: string | null;
}

export interface IndyReviewData {
  members: IndyReviewMember[];
  unmatched: IndyUnmatched[];
  matching: { indyUsers: number; matched: number; byKind: Record<string, number>; unmatchedBuyers: number; unmatchedCents: number; noUserOrders: number; noUserCents: number };
  giftCards: { id: string; initialCents: number; balanceCents: number; expires: string | null }[];
  vouchers: { id: string; type: string | null; email: string | null; memberName: string | null }[];
  indyLedger: { remaining: number; preloaded: number };
}

type Row = Record<string, unknown>;
const n = (v: unknown) => (v == null ? 0 : Number(v));

async function all(table: string, columns: string, apply?: (q: any) => any): Promise<Row[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const supabase = createAdminClient();
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(columns);
    if (apply) q = apply(q);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) return out;
  }
}

function toMember(r: Row): IndyReviewMember {
  return {
    memberId: String(r.member_id),
    name: (r.name as string) || "(no name)",
    email: (r.email as string) ?? null,
    matchKinds: String(r.match_kinds ?? ""),
    orders: n(r.orders),
    purchaseCents: n(r.purchase_cents),
    taxCents: n(r.tax_cents),
    firstAt: (r.first_at as string) ?? null,
    lastAt: (r.last_at as string) ?? null,
    points: n(r.proposed_points),
    indyRemaining: n(r.indy_remaining),
    indyPreloaded: n(r.indy_preloaded),
    rclPoints: n(r.rcl_points),
    staff: Boolean(r.rcl_staff) || Boolean(r.indy_employee),
    indyEmployee: Boolean(r.indy_employee),
    fortisPoints: r.fortis_points == null ? null : n(r.fortis_points),
    sameName: Boolean(r.same_name_other_member),
    phoneOther: Boolean(r.phone_other_member),
  };
}

export async function getIndyReviewData(): Promise<IndyReviewData> {
  const [memberRows, unmatchedRows, matchRows, userCount, noUser, gifts, vouchers] = await Promise.all([
    all("indy_review_members", "*", (q) => q.order("proposed_points", { ascending: false }).order("member_id")),
    all("indy_review_unmatched", "indy_user_id, name, email_lc, orders, purchase_cents, first_at, last_at", (q) =>
      q.order("purchase_cents", { ascending: false }).order("indy_user_id"),
    ),
    all("indy_user_matches", "indy_user_id, match_kind", (q) => q.order("indy_user_id")),
    createAdminClient().from("indy_users").select("id", { count: "exact", head: true }),
    all("indy_review_purchases", "order_id, amount_cents", (q) => q.is("user_id", null).order("row_no")),
    all("indy_gift_cards", "id, initial_cents, balance_cents, expires_at_local", (q) => q.eq("state", "valid").gt("balance_cents", 0).order("id")),
    all("indy_vouchers", "id, voucher_type_name, email_lc, user_id", (q) => q.eq("state", "valid").order("id")),
  ]);

  const members = memberRows.map(toMember);

  const byKind: Record<string, number> = {};
  for (const m of matchRows) byKind[String(m.match_kind)] = (byKind[String(m.match_kind)] ?? 0) + 1;

  // Which member (if any) holds each open voucher, for the owners' page only.
  const matchByUser = new Map(matchRows.map((m) => [String(m.indy_user_id), true]));
  const voucherUserIds = vouchers.map((v) => v.user_id).filter((u): u is string => typeof u === "string" && matchByUser.has(u));
  const voucherMembers = new Map<string, string>();
  if (voucherUserIds.length) {
    const supabase = createAdminClient();
    const { data } = await supabase.from("indy_user_matches").select("indy_user_id, members(name)").in("indy_user_id", voucherUserIds);
    for (const d of (data ?? []) as unknown as { indy_user_id: string; members: { name: string } | null }[]) voucherMembers.set(d.indy_user_id, d.members?.name ?? "");
  }

  const unmatched: IndyUnmatched[] = unmatchedRows.map((r) => ({
    indyUserId: String(r.indy_user_id),
    name: (r.name as string) ?? null,
    email: (r.email_lc as string) ?? null,
    orders: n(r.orders),
    purchaseCents: n(r.purchase_cents),
    firstAt: (r.first_at as string) ?? null,
    lastAt: (r.last_at as string) ?? null,
  }));

  return {
    members,
    unmatched,
    matching: {
      indyUsers: userCount.count ?? 0,
      matched: matchRows.length,
      byKind,
      unmatchedBuyers: unmatched.length,
      unmatchedCents: unmatched.reduce((s, u) => s + u.purchaseCents, 0),
      noUserOrders: new Set(noUser.map((r) => String(r.order_id))).size,
      noUserCents: noUser.reduce((s, r) => s + n(r.amount_cents), 0),
    },
    giftCards: gifts.map((g) => ({ id: String(g.id), initialCents: n(g.initial_cents), balanceCents: n(g.balance_cents), expires: (g.expires_at_local as string) ?? null })),
    vouchers: vouchers.map((v) => ({
      id: String(v.id),
      type: (v.voucher_type_name as string) ?? null,
      email: (v.email_lc as string) ?? null,
      memberName: typeof v.user_id === "string" ? (voucherMembers.get(v.user_id) ?? null) : null,
    })),
    indyLedger: { remaining: members.reduce((s, m) => s + m.indyRemaining, 0), preloaded: members.reduce((s, m) => s + m.indyPreloaded, 0) },
  };
}

// ---------- one member's Indy orders ----------

export interface IndyOrderLine {
  type: string | null;
  state: string | null;
  description: string;
  priceCents: number;
  taxCents: number;
  discountCents: number;
  voucherCents: number;
  counts: boolean; // part of the proposed points
}

export interface IndyOrder {
  orderId: string;
  paidAt: string | null;
  orderState: string | null;
  showing: string | null;
  lines: IndyOrderLine[];
  countedCents: number;
  taxCents: number;
  payments: { type: string | null; subtype: string | null; state: string | null; amountCents: number; lastFour: string | null; cardType: string | null }[];
}

const COUNTED_TYPES = new Set(["item", "ticket", "misc-item", "booking-fee"]);

export async function getIndyMemberOrders(memberId: string): Promise<{ member: IndyReviewMember | null; orders: IndyOrder[] }> {
  const supabase = createAdminClient();
  const { data: mrow, error: me } = await supabase.from("indy_review_members").select("*").eq("member_id", memberId).maybeSingle();
  if (me) throw new Error(me.message);
  const { data: matches, error: mErr } = await supabase.from("indy_user_matches").select("indy_user_id").eq("member_id", memberId);
  if (mErr) throw new Error(mErr.message);
  const userIds = (matches ?? []).map((m) => m.indy_user_id as string);
  if (!userIds.length) return { member: null, orders: [] };

  const items = await all(
    "indy_order_items",
    "row_no, order_id, type, state, order_state, price_cents, tax_cents, discount_cents, voucher_cents, paid_at_local, description:raw->>description, movie_name:raw->>movie_name, showing_start:raw->>showing_start_time, ticket_type:raw->>ticket_type_name",
    (q) => q.in("user_id", userIds).order("paid_at_local", { ascending: false }).order("row_no"),
  );
  const orderIds = [...new Set(items.map((i) => String(i.order_id)))];
  const pays: Row[] = [];
  for (let i = 0; i < orderIds.length; i += 150) {
    pays.push(
      ...(await all("indy_payments", "order_id, type, subtype, state, amount_cents, last_four, card_type", (q) => q.in("order_id", orderIds.slice(i, i + 150)).order("id"))),
    );
  }

  const orders = new Map<string, IndyOrder>();
  for (const it of items) {
    const id = String(it.order_id);
    let o = orders.get(id);
    if (!o) {
      o = { orderId: id, paidAt: (it.paid_at_local as string) ?? null, orderState: (it.order_state as string) ?? null, showing: null, lines: [], countedCents: 0, taxCents: 0, payments: [] };
      orders.set(id, o);
    }
    if (!o.paidAt && it.paid_at_local) o.paidAt = it.paid_at_local as string;
    const type = (it.type as string) ?? null;
    const state = (it.state as string) ?? null;
    if (type === "ticket" && it.movie_name && !o.showing) o.showing = `${it.movie_name}${it.showing_start ? ` · ${String(it.showing_start).slice(0, 16)}` : ""}`;
    const counts = state === "paid" && type != null && COUNTED_TYPES.has(type);
    const line: IndyOrderLine = {
      type,
      state,
      description: String(it.description || it.ticket_type || it.movie_name || type || ""),
      priceCents: n(it.price_cents),
      taxCents: n(it.tax_cents),
      discountCents: n(it.discount_cents),
      voucherCents: n(it.voucher_cents),
      counts,
    };
    o.lines.push(line);
    if (counts) {
      o.countedCents += line.priceCents + line.taxCents - line.discountCents;
      o.taxCents += line.taxCents;
    }
  }
  for (const p of pays) {
    orders.get(String(p.order_id))?.payments.push({
      type: (p.type as string) ?? null,
      subtype: (p.subtype as string) ?? null,
      state: (p.state as string) ?? null,
      amountCents: n(p.amount_cents),
      lastFour: (p.last_four as string) ?? null,
      cardType: (p.card_type as string) ?? null,
    });
  }

  const r = mrow as Row | null;
  const member = r ? { ...toMember(r), memberId } : null;
  return { member, orders: [...orders.values()] };
}
