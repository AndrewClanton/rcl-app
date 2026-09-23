import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Everything a signed-in member sees about themselves. Every query is
// scoped to a memberId already confirmed by requireMember() (or the PDF
// routes' equivalent) -- using the service-role client is safe since
// members, orders and bookings have no public-read RLS policy.

const TZ = "America/Chicago";

export function yearOf(iso: string) {
  return Number(new Date(iso).toLocaleDateString("en-US", { year: "numeric", timeZone: TZ }));
}

// ---------- purchases ----------

export type PurchaseKind = "order" | "ticket";

export interface PurchaseRow {
  kind: PurchaseKind;
  id: string;
  date: string;
  label: string;
  detail: string;
  amount: number;
  tax: number;
  status: "completed" | "refunded";
}

export async function getPurchases(memberId: string): Promise<PurchaseRow[]> {
  const supabase = createAdminClient();
  const [orders, bookings] = await Promise.all([
    supabase
      .from("orders")
      .select("id, order_number, total, tax, status, completed_at, items:order_items(name, quantity)")
      .eq("member_id", memberId)
      .in("status", ["completed", "refunded"])
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false }),
    supabase
      .from("bookings")
      .select("id, quantity, unit_price, status, created_at, screening:screenings(starts_at, movie:movies(title))")
      .eq("member_id", memberId)
      .in("status", ["confirmed", "refunded"])
      .order("created_at", { ascending: false }),
  ]);
  if (orders.error) throw orders.error;
  if (bookings.error) throw bookings.error;

  const rows: PurchaseRow[] = [];
  for (const o of orders.data ?? []) {
    const items = o.items as { name: string; quantity: number }[];
    const count = items.reduce((s, i) => s + i.quantity, 0);
    rows.push({
      kind: "order",
      id: o.id,
      date: o.completed_at,
      label: `Order #${o.order_number}`,
      detail: items.length ? `${items.slice(0, 3).map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.name}` : i.name)).join(", ")}${items.length > 3 ? ` +${items.length - 3} more` : ""}` : `${count} items`,
      amount: Number(o.total),
      tax: Number(o.tax),
      status: o.status === "refunded" ? "refunded" : "completed",
    });
  }
  for (const b of bookings.data ?? []) {
    const s = b.screening as unknown as { starts_at: string; movie: { title: string } } | null;
    rows.push({
      kind: "ticket",
      id: b.id,
      date: b.created_at,
      label: s ? `${b.quantity}× ${s.movie.title}` : `${b.quantity} ticket${b.quantity === 1 ? "" : "s"}`,
      detail: s ? `Screening ${new Date(s.starts_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ })}` : "Tickets",
      amount: Number(b.unit_price) * b.quantity,
      tax: 0,
      status: b.status === "refunded" ? "refunded" : "completed",
    });
  }
  return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// ---------- receipts ----------

export interface ReceiptLine {
  name: string;
  quantity: number;
  unitPrice: number;
  modifiers: string[];
}

export interface Receipt {
  kind: PurchaseKind;
  id: string;
  number: string;
  date: string;
  status: "completed" | "refunded";
  lines: ReceiptLine[];
  subtotal: number;
  discounts: { label: string; amount: number }[];
  tax: number;
  taxFree: boolean;
  tip: number;
  total: number;
  payment: string;
  pointsEarned: number;
  pointsRedeemed: number;
  screening: { title: string; startsAt: string; room: string; posterUrl: string | null } | null;
  memberName: string;
  memberEmail: string | null;
}

function paymentLabel(method: string | null, cash: number | null, card: number | null) {
  if (method === "cash") return "Cash";
  if (method === "card") return "Card";
  if (method === "split") return `Split: $${Number(cash ?? 0).toFixed(2)} cash, $${Number(card ?? 0).toFixed(2)} card`;
  return "—";
}

async function ledgerFor(ref: { orderId?: string; bookingId?: string }) {
  const q = createAdminClient().from("points_ledger").select("delta, reason");
  const { data } = ref.orderId ? await q.eq("order_id", ref.orderId) : await q.eq("booking_id", ref.bookingId!);
  const earned = (data ?? []).filter((l) => l.reason === "purchase").reduce((s, l) => s + Number(l.delta), 0);
  const redeemed = -(data ?? []).filter((l) => l.reason === "redeem").reduce((s, l) => s + Number(l.delta), 0);
  return { earned, redeemed };
}

export async function getReceipt(member: { id: string; name: string; email: string | null }, kind: PurchaseKind, id: string): Promise<Receipt | null> {
  const supabase = createAdminClient();
  if (kind === "order") {
    const { data: o } = await supabase
      .from("orders")
      .select(
        "id, order_number, status, completed_at, subtotal, tier_discount, monthly_discount, redemption_discount, tax, tax_free, tip, total, payment_method, payment_cash_amount, payment_card_amount, items:order_items(name, quantity, unit_price, modifiers)"
      )
      .eq("id", id)
      .eq("member_id", member.id)
      .in("status", ["completed", "refunded"])
      .maybeSingle();
    if (!o || !o.completed_at) return null;
    const pts = await ledgerFor({ orderId: o.id });
    const discounts = [
      { label: "Member discount", amount: Number(o.tier_discount) },
      { label: "Monthly member discount", amount: Number(o.monthly_discount) },
      { label: "Points reward", amount: Number(o.redemption_discount) },
    ].filter((d) => d.amount > 0);
    return {
      kind,
      id: o.id,
      number: `#${o.order_number}`,
      date: o.completed_at,
      status: o.status === "refunded" ? "refunded" : "completed",
      lines: (o.items as { name: string; quantity: number; unit_price: number; modifiers: string[] | null }[]).map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unitPrice: Number(i.unit_price),
        modifiers: i.modifiers ?? [],
      })),
      subtotal: Number(o.subtotal),
      discounts,
      tax: Number(o.tax),
      taxFree: o.tax_free,
      tip: Number(o.tip),
      total: Number(o.total),
      payment: paymentLabel(o.payment_method, o.payment_cash_amount, o.payment_card_amount),
      pointsEarned: pts.earned,
      pointsRedeemed: pts.redeemed,
      screening: null,
      memberName: member.name,
      memberEmail: member.email,
    };
  }

  const { data: b } = await supabase
    .from("bookings")
    .select("id, quantity, unit_price, status, created_at, screening:screenings(starts_at, movie:movies(title, poster_url), room:rooms(name))")
    .eq("id", id)
    .eq("member_id", member.id)
    .in("status", ["confirmed", "refunded"])
    .maybeSingle();
  if (!b) return null;
  const s = b.screening as unknown as { starts_at: string; movie: { title: string; poster_url: string | null }; room: { name: string } } | null;
  const pts = await ledgerFor({ bookingId: b.id });
  const total = Number(b.unit_price) * b.quantity;
  return {
    kind,
    id: b.id,
    number: `T-${b.id.slice(0, 8).toUpperCase()}`,
    date: b.created_at,
    status: b.status === "refunded" ? "refunded" : "completed",
    lines: [{ name: s ? `Ticket: ${s.movie.title}` : "Ticket", quantity: b.quantity, unitPrice: Number(b.unit_price), modifiers: [] }],
    subtotal: total,
    discounts: [],
    tax: 0,
    taxFree: false,
    tip: 0,
    total,
    payment: "Card (online)",
    pointsEarned: pts.earned,
    pointsRedeemed: pts.redeemed,
    screening: s ? { title: s.movie.title, startsAt: s.starts_at, room: s.room.name.split(" — ")[0], posterUrl: s.movie.poster_url } : null,
    memberName: member.name,
    memberEmail: member.email,
  };
}

// ---------- screenings ----------

export interface MemberScreening {
  bookingId: string;
  startsAt: string;
  title: string;
  posterUrl: string | null;
  room: string;
  quantity: number;
}

export async function getMemberScreenings(memberId: string): Promise<{ upcoming: MemberScreening[]; past: MemberScreening[] }> {
  const { data, error } = await createAdminClient()
    .from("bookings")
    .select("id, quantity, screening:screenings(starts_at, movie:movies(title, poster_url), room:rooms(name))")
    .eq("member_id", memberId)
    .eq("status", "confirmed");
  if (error) throw error;
  const now = Date.now();
  const all: MemberScreening[] = [];
  for (const b of data ?? []) {
    const s = b.screening as unknown as { starts_at: string; movie: { title: string; poster_url: string | null }; room: { name: string } } | null;
    if (!s) continue;
    all.push({ bookingId: b.id, startsAt: s.starts_at, title: s.movie.title, posterUrl: s.movie.poster_url, room: s.room.name.split(" — ")[0], quantity: b.quantity });
  }
  const t = (x: MemberScreening) => new Date(x.startsAt).getTime();
  return {
    upcoming: all.filter((x) => t(x) > now).sort((a, b) => t(a) - t(b)),
    past: all.filter((x) => t(x) <= now).sort((a, b) => t(b) - t(a)),
  };
}

// ---------- points ----------

export interface LedgerEntry {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  note: string | null;
  createdAt: string;
  orderId: string | null;
  bookingId: string | null;
}

export async function getPointsLedger(memberId: string, limit = 300): Promise<LedgerEntry[]> {
  const { data, error } = await createAdminClient()
    .from("points_ledger")
    .select("id, delta, balance_after, reason, note, created_at, order_id, booking_id")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((l) => ({
    id: l.id,
    delta: Number(l.delta),
    balanceAfter: Number(l.balance_after),
    reason: l.reason,
    note: l.note,
    createdAt: l.created_at,
    orderId: l.order_id,
    bookingId: l.booking_id,
  }));
}

// ---------- yearly statement ----------

export interface YearStatement {
  year: number;
  purchases: PurchaseRow[];
  spent: number;
  refunded: number;
  tax: number;
  points: { earned: number; redeemed: number; other: number; endBalance: number | null };
}

export async function getYearStatement(memberId: string, year: number): Promise<YearStatement> {
  const [purchases, ledger] = await Promise.all([getPurchases(memberId), getPointsLedger(memberId, 5000)]);
  const inYear = purchases.filter((p) => yearOf(p.date) === year);
  const yearLedger = ledger.filter((l) => yearOf(l.createdAt) === year);
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  return {
    year,
    purchases: inYear,
    spent: sum(inYear.filter((p) => p.status === "completed").map((p) => p.amount)),
    refunded: sum(inYear.filter((p) => p.status === "refunded").map((p) => p.amount)),
    tax: sum(inYear.filter((p) => p.status === "completed").map((p) => p.tax)),
    points: {
      earned: sum(yearLedger.filter((l) => l.reason === "purchase" || l.reason === "welcome_bonus").map((l) => l.delta)),
      redeemed: -sum(yearLedger.filter((l) => l.reason === "redeem").map((l) => l.delta)),
      other: sum(yearLedger.filter((l) => !["purchase", "welcome_bonus", "redeem"].includes(l.reason)).map((l) => l.delta)),
      endBalance: yearLedger[0]?.balanceAfter ?? null,
    },
  };
}

// Years with purchases to put on a statement (plus this year), newest first.
export function activityYears(purchases: PurchaseRow[]): number[] {
  const years = new Set(purchases.map((p) => yearOf(p.date)));
  years.add(yearOf(new Date().toISOString()));
  return [...years].sort((a, b) => b - a);
}
