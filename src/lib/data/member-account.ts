import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { boothDate, boothWindow } from "@/lib/booth-time";
import { bookingNumber } from "@/lib/door-tickets";
import { businessDay } from "@/lib/ops/time";
import { cardLabel } from "@/lib/card-match";
import { stripeKeyMode } from "@/lib/stripe";
import { schemaMissing } from "@/lib/schema-missing";

// Everything a signed-in member sees about themselves. Every query is
// scoped to a memberId already confirmed by requireMember() (or the PDF
// routes' equivalent) -- using the service-role client is safe since
// members, orders and bookings have no public-read RLS policy.

const TZ = "America/Chicago";

export function yearOf(iso: string) {
  return Number(new Date(iso).toLocaleDateString("en-US", { year: "numeric", timeZone: TZ }));
}

// ---------- purchases ----------

export type PurchaseKind = "order" | "ticket" | "booth";

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

// A register sale is theirs to see (items, receipt) only when staff
// attached them: one whose points a linked card paid them (member_source
// 'card', lib/member-cards.ts) may have been someone else paying, so it
// shows only as points in their points history. Before migration
// 20261001220000 there's no member_source, and every sale is theirs.

export async function getPurchases(memberId: string): Promise<PurchaseRow[]> {
  const supabase = createAdminClient();
  const ordersQuery = (withSource: boolean) => {
    let q = supabase
      .from("orders")
      .select("id, order_number, total, tax, status, completed_at, items:order_items(name, quantity)")
      .eq("member_id", memberId)
      .in("status", ["completed", "refunded"])
      .not("completed_at", "is", null);
    if (withSource) q = q.is("member_source", null);
    return q.order("completed_at", { ascending: false });
  };
  const [firstOrders, bookings, booths] = await Promise.all([
    ordersQuery(true),
    supabase
      .from("bookings")
      .select("id, quantity, unit_price, tax_amount, status, created_at, screening:screenings(starts_at, movie:movies(title))")
      .eq("member_id", memberId)
      .is("order_id", null)
      .in("status", ["confirmed", "refunded"])
      .order("created_at", { ascending: false }),
    // Paid booth reservations (free Insiders+ ones aren't purchases). A paid
    // one that was cancelled was refunded.
    supabase
      .from("booth_reservations")
      .select("id, reservation_date, start_time, hours, party_size, fee_amount, tax_amount, status, created_at, booth:booths(label)")
      .eq("member_id", memberId)
      .gt("fee_amount", 0)
      .not("stripe_payment_intent_id", "is", null)
      .in("status", ["confirmed", "cancelled"])
      .order("created_at", { ascending: false }),
  ]);
  const orders = schemaMissing(firstOrders.error) ? await ordersQuery(false) : firstOrders;
  if (orders.error) throw orders.error;
  if (bookings.error) throw bookings.error;
  if (booths.error) throw booths.error;

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
      amount: Number(b.unit_price) * b.quantity + Number(b.tax_amount),
      tax: Number(b.tax_amount),
      status: b.status === "refunded" ? "refunded" : "completed",
    });
  }
  for (const r of booths.data ?? []) {
    const label = (r.booth as unknown as { label: string } | null)?.label ?? "Booth";
    rows.push({
      kind: "booth",
      id: r.id,
      date: r.created_at,
      label: `${label} reservation`,
      detail: `${boothDate(r.reservation_date, "short")}, ${boothWindow(r.start_time, Number(r.hours))} · party of ${r.party_size}`,
      amount: Number(r.fee_amount) + Number(r.tax_amount ?? 0),
      tax: Number(r.tax_amount ?? 0),
      status: r.status === "cancelled" ? "refunded" : "completed",
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
    // Only a sale staff attached them to (see getPurchases).
    const receiptQuery = (withSource: boolean) => {
      let q = supabase
        .from("orders")
        .select(
          "id, order_number, status, completed_at, subtotal, tier_discount, monthly_discount, redemption_discount, tax, tax_free, tip, total, payment_method, payment_cash_amount, payment_card_amount, items:order_items(name, quantity, unit_price, modifiers)"
        )
        .eq("id", id)
        .eq("member_id", member.id)
        .in("status", ["completed", "refunded"]);
      if (withSource) q = q.is("member_source", null);
      return q.maybeSingle();
    };
    let { data: o, error } = await receiptQuery(true);
    if (schemaMissing(error)) ({ data: o, error } = await receiptQuery(false));
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

  if (kind === "booth") {
    const { data: r } = await supabase
      .from("booth_reservations")
      .select("id, reservation_date, start_time, hours, party_size, fee_amount, tax_amount, status, created_at, booth:booths(label)")
      .eq("id", id)
      .eq("member_id", member.id)
      .gt("fee_amount", 0)
      .in("status", ["confirmed", "cancelled"])
      .maybeSingle();
    if (!r) return null;
    const label = (r.booth as unknown as { label: string } | null)?.label ?? "Booth";
    const fee = Number(r.fee_amount);
    const tax = Number(r.tax_amount ?? 0);
    return {
      kind,
      id: r.id,
      number: `B-${r.id.slice(0, 8).toUpperCase()}`,
      date: r.created_at,
      status: r.status === "cancelled" ? "refunded" : "completed",
      lines: [
        {
          name: `Booth reservation: ${label}`,
          quantity: 1,
          unitPrice: fee,
          modifiers: [`${boothDate(r.reservation_date)}, ${boothWindow(r.start_time, Number(r.hours))}`, `Party of ${r.party_size}`],
        },
      ],
      subtotal: fee,
      discounts: [],
      tax,
      taxFree: false,
      tip: 0,
      total: fee + tax,
      payment: "Card (online)",
      pointsEarned: 0,
      pointsRedeemed: 0,
      screening: null,
      memberName: member.name,
      memberEmail: member.email,
    };
  }

  const { data: b } = await supabase
    .from("bookings")
    .select("id, quantity, unit_price, tax_amount, status, created_at, screening:screenings(starts_at, movie:movies(title, poster_url), room:rooms(name))")
    .eq("id", id)
    .eq("member_id", member.id)
    .in("status", ["confirmed", "refunded"])
    .maybeSingle();
  if (!b) return null;
  const s = b.screening as unknown as { starts_at: string; movie: { title: string; poster_url: string | null }; room: { name: string } } | null;
  const pts = await ledgerFor({ bookingId: b.id });
  const subtotal = Number(b.unit_price) * b.quantity;
  const tax = Number(b.tax_amount);
  return {
    kind,
    id: b.id,
    number: bookingNumber(b.id),
    date: b.created_at,
    status: b.status === "refunded" ? "refunded" : "completed",
    lines: [{ name: s ? `Ticket: ${s.movie.title}` : "Ticket", quantity: b.quantity, unitPrice: Number(b.unit_price), modifiers: [] }],
    subtotal,
    discounts: [],
    tax,
    taxFree: false,
    tip: 0,
    total: subtotal + tax,
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
  // Bought at the register: the tickets printed with the sale, so there's no
  // code to show at the door.
  atRegister: boolean;
  // When its tickets were printed at the door (the code is used up).
  scannedAt: string | null;
}

// `*` rather than a column list, so these pages keep working before the
// door-ticket migration adds bookings.scanned_at (it's just missing until then).
const MEMBER_BOOKING_SELECT = "*, screening:screenings(starts_at, movie:movies(title, poster_url), room:rooms(name))";

type MemberBookingRow = {
  id: string;
  quantity: number;
  order_id: string | null;
  scanned_at?: string | null;
  screening: { starts_at: string; movie: { title: string; poster_url: string | null }; room: { name: string } } | null;
};

function toMemberScreening(b: MemberBookingRow): MemberScreening | null {
  const s = b.screening;
  if (!s) return null;
  return {
    bookingId: b.id,
    startsAt: s.starts_at,
    title: s.movie.title,
    posterUrl: s.movie.poster_url,
    room: s.room.name.split(" — ")[0],
    quantity: b.quantity,
    atRegister: !!b.order_id,
    scannedAt: b.scanned_at ?? null,
  };
}

// One confirmed booking of theirs, for its ticket page (the QR code for the door).
export async function getMemberTicket(memberId: string, bookingId: string): Promise<MemberScreening | null> {
  const { data, error } = await createAdminClient()
    .from("bookings")
    .select(MEMBER_BOOKING_SELECT)
    .eq("id", bookingId)
    .eq("member_id", memberId)
    .eq("status", "confirmed")
    .maybeSingle();
  if (error) throw error;
  return data ? toMemberScreening(data as unknown as MemberBookingRow) : null;
}

// A showing that started this recently still counts as tonight's, so
// someone running late still finds their tickets on top.
const LATE_ARRIVAL_MS = 2 * 3_600_000;

// Whether a showing's tickets (the QR code for the door) are still worth
// showing: it hasn't started, or started only a little while ago.
export function showingStillOn(startsAt: string): boolean {
  return new Date(startsAt).getTime() > Date.now() - LATE_ARRIVAL_MS;
}

// upcoming: not started yet, soonest first. past: started, newest first.
// tonight: today's business day (4 a.m. to 4 a.m.), not started or started
// within the last two hours: the tickets to show at the door now.
export async function getMemberScreenings(memberId: string): Promise<{ upcoming: MemberScreening[]; past: MemberScreening[]; tonight: MemberScreening[] }> {
  const { data, error } = await createAdminClient().from("bookings").select(MEMBER_BOOKING_SELECT).eq("member_id", memberId).eq("status", "confirmed");
  if (error) throw error;
  const now = Date.now();
  const all: MemberScreening[] = [];
  for (const b of (data ?? []) as unknown as MemberBookingRow[]) {
    const s = toMemberScreening(b);
    if (s) all.push(s);
  }
  const t = (x: MemberScreening) => new Date(x.startsAt).getTime();
  const today = businessDay(new Date(now)).date;
  return {
    upcoming: all.filter((x) => t(x) > now).sort((a, b) => t(a) - t(b)),
    past: all.filter((x) => t(x) <= now).sort((a, b) => t(b) - t(a)),
    tonight: all.filter((x) => t(x) > now - LATE_ARRIVAL_MS && businessDay(new Date(x.startsAt)).date === today).sort((a, b) => t(a) - t(b)),
  };
}

// ---------- booths ----------

export interface MemberBooth {
  id: string;
  booth: string;
  date: string; // YYYY-MM-DD
  dateLabel: string; // "Wed, Sep 30"
  window: string; // "7:00–9:00 PM"
  party: number;
  free: boolean;
}

// The member's upcoming booth reservations (today on), soonest first.
export async function getMemberBooths(memberId: string): Promise<MemberBooth[]> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const { data, error } = await createAdminClient()
    .from("booth_reservations")
    .select("id, reservation_date, start_time, hours, party_size, fee_amount, booth:booths(label)")
    .eq("member_id", memberId)
    .eq("status", "confirmed")
    .gte("reservation_date", today)
    .order("reservation_date")
    .order("start_time");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    booth: (r.booth as unknown as { label: string } | null)?.label ?? "Booth",
    date: r.reservation_date,
    dateLabel: boothDate(r.reservation_date, "short"),
    window: boothWindow(r.start_time, Number(r.hours)),
    party: r.party_size,
    free: Number(r.fee_amount) === 0,
  }));
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
  // Their receipt for it is on their account: a sale staff attached them to,
  // or their own booking. Not for points a linked card paid them on a sale
  // or online tickets someone else may have bought (lib/member-cards.ts).
  receipt: boolean;
}

export async function getPointsLedger(memberId: string, limit = 300): Promise<LedgerEntry[]> {
  const base = "id, delta, balance_after, reason, note, created_at, order_id, booking_id";
  const ledger = (columns: string) =>
    createAdminClient()
      .from("points_ledger")
      .select(columns)
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      // A check-in and its badges share one moment; the bigger balance came
      // after (they only add).
      .order("balance_after", { ascending: false })
      .limit(limit);
  // Who each sale or booking is on now, and how (migration 20261001220000);
  // before it, every one of them is theirs, as it always was.
  let { data, error } = await ledger(`${base}, order:orders(member_id, member_source), booking:bookings(member_id)`);
  const withOwners = !schemaMissing(error);
  if (!withOwners) ({ data, error } = await ledger(base));
  if (error) throw error;
  type Row = {
    id: string;
    delta: number;
    balance_after: number;
    reason: string;
    note: string | null;
    created_at: string;
    order_id: string | null;
    booking_id: string | null;
    order?: { member_id: string | null; member_source: string | null } | null;
    booking?: { member_id: string | null } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((l) => ({
    id: l.id,
    delta: Number(l.delta),
    balanceAfter: Number(l.balance_after),
    reason: l.reason,
    note: l.note,
    createdAt: l.created_at,
    orderId: l.order_id,
    bookingId: l.booking_id,
    receipt: !withOwners
      ? !!(l.order_id || l.booking_id)
      : l.order_id
        ? l.order?.member_id === memberId && !l.order.member_source
        : l.booking_id
          ? l.booking?.member_id === memberId
          : false,
  }));
}

// ---------- linked cards ----------

// The cards linked to their account (lib/member-cards.ts), ones they or
// staff removed left out. Only what's needed to show them: never the
// fingerprint. On the real site, a test card linked while trying the
// register out (it can never earn anything there) isn't shown either.
export interface MyLinkedCard {
  id: string;
  label: string; // "Visa •••• 4242"
  wallet: boolean; // a phone or watch, which counts as its own card
  source: string; // register | online | plus
  linkedAt: string;
  lastUsedAt: string | null;
}

export async function getMyLinkedCards(memberId: string): Promise<MyLinkedCard[]> {
  let query = createAdminClient()
    .from("member_cards")
    .select("id, brand, last4, wallet, source, created_at, last_used_at")
    .eq("member_id", memberId)
    .is("removed_at", null);
  if (stripeKeyMode() === "live") query = query.eq("livemode", true);
  const { data, error } = await query.order("created_at", { ascending: false });
  // Before migration 20261001220000: no cards yet.
  if (schemaMissing(error)) return [];
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id,
    label: cardLabel({ brand: c.brand, last4: c.last4, wallet: c.wallet }),
    wallet: !!c.wallet && c.wallet !== "link",
    source: c.source,
    linkedAt: c.created_at,
    lastUsedAt: c.last_used_at,
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

// Points history reasons that count as earned on a statement.
const EARNED_REASONS = ["purchase", "welcome_bonus", "visit", "badge", "backfill"];

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
      earned: sum(yearLedger.filter((l) => EARNED_REASONS.includes(l.reason)).map((l) => l.delta)),
      redeemed: -sum(yearLedger.filter((l) => l.reason === "redeem").map((l) => l.delta)),
      other: sum(yearLedger.filter((l) => !EARNED_REASONS.includes(l.reason) && l.reason !== "redeem").map((l) => l.delta)),
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
