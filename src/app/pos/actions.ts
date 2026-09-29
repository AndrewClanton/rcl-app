"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPin } from "@/lib/pin";
import { assertStaff } from "@/lib/auth";
import { getPosMember, type PosMember } from "./member-actions";
import { applyPoints, POINTS_PER_REWARD } from "@/lib/points";
import { releaseTabCard } from "@/lib/tab-card";
import { refundOrder } from "@/app/admin/reports/actions";

export interface CheckoutLine {
  menu_item_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  modifiers: string[];
  is_alcohol: boolean;
  screening_id?: string | null; // a movie ticket for this screening
}

export interface CheckoutTotals {
  subtotal: number;
  tier_discount: number;
  monthly_discount: number;
  redemption_discount: number;
  tax: number;
  total: number;
}

export interface CheckoutPayment {
  // 'voucher' when paper vouchers covered it all; otherwise how the rest was paid.
  method: "cash" | "card" | "split" | "voucher";
  cash: number;
  card: number;
  stripePaymentIntentId?: string | null;
  tip?: number; // tip the customer chose on the card reader, already inside `card`
  tendered?: number; // cash handed over, for the change shown and printed (not stored)
  voucher?: number; // paper vouchers (trivia prizes) applied; not cash, not card
}

export interface DraftFields {
  employeeId: string;
  memberId: string | null;
  orderName: string;
  taxFree: boolean;
  monthlyMember: boolean;
  pointsRedeemed: boolean;
  lines: CheckoutLine[];
}

export interface DraftOrderSummary {
  id: string;
  order_name: string | null;
  item_count: number;
  total: number;
  card_label: string | null; // a tab's card on file, e.g. "Visa ••4242"
}

export interface DraftOrderFull {
  id: string;
  order_name: string | null;
  member_id: string | null;
  member: PosMember | null;
  tax_free: boolean;
  monthly_member: boolean;
  points_redeemed: boolean;
  lines: (CheckoutLine & { unit: number })[];
}

function revalidate() {
  revalidatePath("/pos");
}

// Swaps an order's items for `lines`. The new rows go in first and the old
// ones come out after, by id, so a save that fails part-way leaves the order
// with its old items instead of none (deleting first, then failing to
// insert, used to empty a tab). Two saves from one register never overlap:
// Next.js sends a page's Server Actions one at a time.
async function replaceOrderItems(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
  lines: CheckoutLine[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: old, error: readErr } = await supabase.from("order_items").select("id").eq("order_id", orderId);
  if (readErr) return { ok: false, error: readErr.message };
  let addedIds: string[] = [];
  if (lines.length) {
    const { data: added, error: insertErr } = await supabase
      .from("order_items")
      .insert(
        lines.map((l) => ({
          order_id: orderId,
          menu_item_id: l.menu_item_id,
          name: l.name,
          unit_price: l.unit_price,
          quantity: l.quantity,
          modifiers: l.modifiers,
          is_alcohol: l.is_alcohol,
          screening_id: l.screening_id ?? null,
          // Tickets aren't made by the kitchen or bar, so keep them off the prep screens.
          is_event: !!l.screening_id,
        }))
      )
      .select("id");
    if (insertErr) return { ok: false, error: insertErr.message };
    addedIds = (added ?? []).map((r) => r.id);
  }
  const oldIds = (old ?? []).map((r) => r.id);
  if (oldIds.length) {
    const { error: deleteErr } = await supabase.from("order_items").delete().in("id", oldIds);
    if (deleteErr) {
      // Take the new rows back out so the order isn't left with every item
      // twice. Best effort: the caller reports the failure either way.
      if (addedIds.length) await supabase.from("order_items").delete().in("id", addedIds);
      return { ok: false, error: deleteErr.message };
    }
  }
  return { ok: true };
}

// A register ticket sale also books the seats (bookings.order_id = the
// order), so they count against capacity and show in attendance, box-office
// numbers and the member's movies. Rewritten whole on each save so a
// re-saved order never double-books. Never throws: the customer has already
// paid by the time this runs, so a failure here must not look like a failed
// sale.
async function syncTicketBookings(
  supabase: ReturnType<typeof createAdminClient>,
  order: { id: string; memberId: string | null; name: string | null },
  lines: CheckoutLine[],
) {
  try {
    await supabase.from("bookings").delete().eq("order_id", order.id);
    const byKey = new Map<string, { screening_id: string; unit_price: number; quantity: number }>();
    for (const l of lines) {
      if (!l.screening_id) continue;
      const key = `${l.screening_id}|${l.unit_price}`;
      const cur = byKey.get(key) ?? { screening_id: l.screening_id, unit_price: l.unit_price, quantity: 0 };
      cur.quantity += l.quantity;
      byKey.set(key, cur);
    }
    if (!byKey.size) return;
    const { error } = await supabase.from("bookings").insert(
      [...byKey.values()].map((b) => ({
        screening_id: b.screening_id,
        order_id: order.id,
        member_id: order.memberId,
        customer_name: order.name,
        quantity: b.quantity,
        unit_price: b.unit_price,
        status: "confirmed",
      })),
    );
    if (error) console.error("register ticket bookings failed", order.id, error.message);
  } catch (e) {
    console.error("register ticket bookings failed", order.id, e);
  }
}

// A paid sale's items. By now the order row is saved as paid, so a failure
// here is logged, not thrown: throwing would show a paid sale as failed, and
// a retry finds the order by its payment and stops before reaching this.
async function saveSaleItems(supabase: ReturnType<typeof createAdminClient>, orderId: string, lines: CheckoutLine[]) {
  const r = await replaceOrderItems(supabase, orderId, lines);
  if (!r.ok) console.error("sale items not saved", orderId, r.error);
}

export type CompleteOrderInput = DraftFields & {
  totals: CheckoutTotals;
  payment: CheckoutPayment;
  ageVerified: boolean;
  tip?: number;
  draftOrderId?: string | null;
};

export async function completeOrder(params: CompleteOrderInput): Promise<{ orderNumber: number }> {
  await assertStaff();
  if (params.lines.length === 0) throw new Error("Cart is empty");

  const supabase = createAdminClient();
  const tip = params.tip ?? 0;

  const orderFields = {
    source: "pos" as const,
    status: "completed" as const,
    employee_id: params.employeeId,
    member_id: params.memberId,
    order_name: params.orderName || null,
    subtotal: params.totals.subtotal,
    tier_discount: params.totals.tier_discount,
    monthly_discount: params.totals.monthly_discount,
    redemption_discount: params.totals.redemption_discount,
    tax_free: params.taxFree,
    monthly_member: params.monthlyMember,
    tax: params.totals.tax,
    tip,
    total: params.totals.total + tip,
    payment_method: params.payment.method,
    payment_cash_amount: params.payment.cash,
    payment_voucher_amount: params.payment.voucher ?? 0,
    payment_card_amount: params.payment.card,
    stripe_payment_intent_id: params.payment.stripePaymentIntentId ?? null,
    points_redeemed: params.pointsRedeemed,
    age_verified: params.ageVerified,
    completed_at: new Date().toISOString(),
  };

  // One card payment is one sale. If this payment already has its order
  // (the register asked twice), hand back that order instead of a copy.
  const paymentIntentId = params.payment.stripePaymentIntentId ?? null;
  const orderForPayment = async () => {
    if (!paymentIntentId) return null;
    const { data } = await supabase.from("orders").select("order_number").eq("stripe_payment_intent_id", paymentIntentId).neq("status", "voided").limit(1);
    return data?.[0] ? Number(data[0].order_number) : null;
  };
  const already = await orderForPayment();
  if (already !== null) return { orderNumber: already };

  let orderId: string;
  let orderNumber: number;

  if (params.draftOrderId) {
    const { data: existing, error: fetchErr } = await supabase.from("orders").select("order_number").eq("id", params.draftOrderId).single();
    if (fetchErr || !existing) throw new Error("Tab no longer exists");
    orderId = params.draftOrderId;
    orderNumber = Number(existing.order_number);
    // Only an open tab or held order can be closed, so two closes racing
    // can't both award points and write items.
    const { data: closed, error: updateErr } = await supabase.from("orders").update(orderFields).eq("id", orderId).in("status", ["draft", "held", "tab"]).select("id");
    if (updateErr) throw updateErr;
    if (!closed?.length) {
      if ((await orderForPayment()) !== null) return { orderNumber };
      throw new Error("This tab was already closed. Check Reports before taking payment again.");
    }
    await saveSaleItems(supabase, orderId, params.lines);
  } else {
    const { data: newNumber, error: numberErr } = await supabase.rpc("next_order_number");
    if (numberErr) throw numberErr;
    orderNumber = Number(newNumber);
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({ order_number: orderNumber, ...orderFields })
      .select("id")
      .single();
    if (orderErr) {
      // Lost a race with a repeat of this same card payment (the database
      // allows one order per payment): the other call saved it.
      const saved = orderErr.code === "23505" ? await orderForPayment() : null;
      if (saved !== null) return { orderNumber: saved };
      throw orderErr;
    }
    orderId = order.id;
    await saveSaleItems(supabase, orderId, params.lines);
  }

  // 1 point per $1 of the order, and 100 back out when a reward was used.
  // Each change lands in the member's points history, tied to this order.
  if (params.memberId) {
    if (params.pointsRedeemed && params.totals.redemption_discount > 0) {
      await applyPoints({ memberId: params.memberId, delta: -POINTS_PER_REWARD, reason: "redeem", orderId, note: `${params.totals.redemption_discount.toFixed(2)} off order #${orderNumber}`, by: params.employeeId || null });
    }
    await applyPoints({ memberId: params.memberId, delta: params.totals.subtotal, reason: "purchase", orderId, note: `Order #${orderNumber}`, by: params.employeeId || null });
  }

  await syncTicketBookings(supabase, { id: orderId, memberId: params.memberId, name: params.orderName || null }, params.lines);

  // A closed tab's card on file comes off file, however the tab was paid.
  if (params.draftOrderId) await releaseTabCard(orderId);

  // A custom item usually means the menu couldn't describe the sale, so each
  // one becomes a dev note to review. Best-effort: never blocks the sale.
  const customLines = params.lines.filter((l) => !l.menu_item_id && !l.screening_id);
  if (customLines.length) {
    const items = customLines.map((l) => `"${l.name}" $${(l.unit_price * l.quantity).toFixed(2)}`).join(", ");
    await supabase
      .from("dev_notes")
      .insert({
        page_path: "/pos",
        page_title: "Register: custom item used",
        message: `Custom item rung up on order #${orderNumber}: ${items}. Should the register have a proper button or menu item for this?`,
        submitted_by: params.employeeId || null,
      })
      .then(() => {}, () => {});
  }

  revalidate();
  return { orderNumber };
}

// ---------- held orders & tabs (persisted drafts, status 'held' | 'tab') ----------
//
// Draft rows must carry a real, current total (not a 0 placeholder) --
// getDraftOrders reads it straight from the row rather than recomputing a
// bare item subtotal, so the held/tabs lists always show the same
// tax-and-discount-inclusive number the cashier sees in the cart. Callers
// pass the totals they already computed for the on-screen cart.

const ZERO_TOTALS: CheckoutTotals = { subtotal: 0, tier_discount: 0, monthly_discount: 0, redemption_discount: 0, tax: 0, total: 0 };

export async function saveDraftOrder(status: "held" | "tab", fields: DraftFields, totals: CheckoutTotals = ZERO_TOTALS): Promise<string> {
  await assertStaff();
  const supabase = createAdminClient();
  const { data: orderNumber, error: numberErr } = await supabase.rpc("next_order_number");
  if (numberErr) throw numberErr;

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      order_number: orderNumber,
      source: "pos",
      status,
      employee_id: fields.employeeId,
      member_id: fields.memberId,
      order_name: fields.orderName || null,
      tab_name: status === "tab" ? fields.orderName || null : null,
      tax_free: fields.taxFree,
      monthly_member: fields.monthlyMember,
      points_redeemed: fields.pointsRedeemed,
      subtotal: totals.subtotal,
      tier_discount: totals.tier_discount,
      monthly_discount: totals.monthly_discount,
      redemption_discount: totals.redemption_discount,
      tax: totals.tax,
      total: totals.total,
    })
    .select("id")
    .single();
  if (error) throw error;

  const items = await replaceOrderItems(supabase, order.id, fields.lines);
  if (!items.ok) {
    // Don't leave an empty held order or tab behind: the register keeps the
    // items on screen, and trying again makes a whole new one.
    console.error("draft items not saved", order.id, items.error);
    await supabase.from("orders").delete().eq("id", order.id);
    throw new Error("Couldn't save the items.");
  }
  revalidate();
  return order.id;
}

const OPEN_DRAFT = ["draft", "held", "tab"];

// closed: the order isn't open anymore (paid or cancelled, usually on
// another register), so trying the same save again can't work.
export type DraftSaveResult = { ok: true } | { ok: false; error: string; closed?: boolean };

export async function updateDraftOrder(id: string, fields: DraftFields, totals: CheckoutTotals): Promise<DraftSaveResult> {
  await assertStaff();
  const supabase = createAdminClient();
  const { data: updated, error } = await supabase
    .from("orders")
    .update({
      employee_id: fields.employeeId,
      member_id: fields.memberId,
      order_name: fields.orderName || null,
      tab_name: fields.orderName || null,
      tax_free: fields.taxFree,
      monthly_member: fields.monthlyMember,
      points_redeemed: fields.pointsRedeemed,
      subtotal: totals.subtotal,
      tier_discount: totals.tier_discount,
      monthly_discount: totals.monthly_discount,
      redemption_discount: totals.redemption_discount,
      tax: totals.tax,
      total: totals.total,
    })
    .eq("id", id)
    // Only an order that's still held or an open tab: a register with an
    // out-of-date list must never rewrite a sale that's already been paid.
    .in("status", OPEN_DRAFT)
    .select("id");
  if (error) {
    console.error("draft save failed", id, error.message);
    return { ok: false, error: "Couldn't save the tab." };
  }
  if (!updated?.length) return { ok: false, closed: true, error: "That tab is already closed." };
  const items = await replaceOrderItems(supabase, id, fields.lines);
  if (!items.ok) {
    console.error("draft items not saved", id, items.error);
    return { ok: false, error: "Couldn't save the tab's items." };
  }
  revalidate();
  return { ok: true };
}

export async function getDraftOrders(status: "held" | "tab"): Promise<DraftOrderSummary[]> {
  await assertStaff();
  const supabase = createAdminClient();
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, order_name, total, tab_card_label, items:order_items(quantity)")
    .eq("status", status)
    .order("created_at");
  if (error) throw error;
  return (orders ?? []).map((o) => ({
    id: o.id,
    order_name: o.order_name,
    item_count: (o.items as { quantity: number }[]).reduce((s, i) => s + i.quantity, 0),
    total: Number(o.total),
    card_label: o.tab_card_label ?? null,
  }));
}

export async function loadDraftOrder(id: string): Promise<DraftOrderFull> {
  await assertStaff();
  const supabase = createAdminClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, order_name, member_id, tax_free, monthly_member, points_redeemed, items:order_items(menu_item_id, name, unit_price, quantity, modifiers, is_alcohol, screening_id)")
    .eq("id", id)
    .in("status", OPEN_DRAFT)
    .single();
  if (error || !order) throw new Error("That order was already closed on another register.");
  const items = order.items as { menu_item_id: string | null; name: string; unit_price: number; quantity: number; modifiers: string[]; is_alcohol: boolean; screening_id: string | null }[];
  return {
    id: order.id,
    order_name: order.order_name,
    member_id: order.member_id,
    member: order.member_id ? await getPosMember(order.member_id) : null,
    tax_free: order.tax_free,
    monthly_member: order.monthly_member,
    points_redeemed: order.points_redeemed,
    lines: items.map((i) => ({
      menu_item_id: i.menu_item_id,
      name: i.name,
      unit_price: i.unit_price,
      unit: i.unit_price,
      quantity: i.quantity,
      modifiers: i.modifiers,
      is_alcohol: i.is_alcohol,
      screening_id: i.screening_id,
    })),
  };
}

// Held orders and open tabs only. A completed sale can never be deleted
// from here (refunds go through Recent orders with a manager PIN).
// Whether a tab is still open, checked right before taking payment: a tab
// closed on the other register mustn't be charged again from this one.
export async function isDraftOpen(id: string): Promise<boolean> {
  await assertStaff();
  const { data } = await createAdminClient().from("orders").select("id").eq("id", id).in("status", OPEN_DRAFT).maybeSingle();
  return !!data;
}

export async function discardDraftOrder(id: string): Promise<void> {
  await assertStaff();
  const supabase = createAdminClient();
  const { data: open } = await supabase.from("orders").select("id").eq("id", id).in("status", OPEN_DRAFT).maybeSingle();
  if (!open) return;
  await releaseTabCard(id);
  await supabase.from("orders").delete().eq("id", id).in("status", OPEN_DRAFT);
  revalidate();
}

export async function cancelTab(id: string, pin: string): Promise<void> {
  await assertStaff();
  const supabase = createAdminClient();
  const { data: managers } = await supabase.from("employees").select("pin_hash").in("role", ["manager", "admin", "owner"]).eq("active", true);
  const ok = (managers ?? []).some((m) => verifyPin(pin, m.pin_hash));
  if (!ok) throw new Error("Incorrect manager PIN.");
  await supabase.from("orders").delete().eq("id", id);
  revalidate();
}

// ---------- recent orders (reprint, refund, "what did they order?") ----------

export interface RecentOrder {
  id: string;
  orderNumber: number;
  status: string; // completed | refunded | voided
  at: string;
  name: string | null;
  cashier: string | null;
  member: string | null;
  method: string | null;
  cash: number;
  card: number;
  voucher: number;
  subtotal: number;
  discounts: { label: string; amount: number }[];
  tax: number;
  tip: number;
  total: number;
  lines: { name: string; qty: number; unit: number; mods: string[]; screeningId: string | null }[];
}

export async function getRecentRegisterOrders(limit = 20): Promise<RecentOrder[]> {
  await assertStaff();
  const { data, error } = await createAdminClient()
    .from("orders")
    .select(
      "id, order_number, status, completed_at, order_name, tab_name, payment_method, payment_cash_amount, payment_card_amount, payment_voucher_amount, subtotal, tier_discount, monthly_discount, redemption_discount, tax, tip, total, employee:employees(name), member:members(name), items:order_items(name, quantity, unit_price, modifiers, screening_id)",
    )
    .in("status", ["completed", "refunded", "voided"])
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  type Row = {
    id: string;
    order_number: number;
    status: string;
    completed_at: string;
    order_name: string | null;
    tab_name: string | null;
    payment_method: string | null;
    payment_cash_amount: number | null;
    payment_card_amount: number | null;
    payment_voucher_amount: number | null;
    subtotal: number;
    tier_discount: number;
    monthly_discount: number;
    redemption_discount: number;
    tax: number;
    tip: number;
    total: number;
    employee: { name: string } | null;
    member: { name: string } | null;
    items: { name: string; quantity: number; unit_price: number; modifiers: string[] | null; screening_id: string | null }[];
  };
  return ((data ?? []) as unknown as Row[]).map((o) => ({
    id: o.id,
    orderNumber: Number(o.order_number),
    status: o.status,
    at: o.completed_at,
    name: o.tab_name || o.order_name || null,
    cashier: o.employee?.name ?? null,
    member: o.member?.name ?? null,
    method: o.payment_method,
    cash: Number(o.payment_cash_amount ?? 0),
    card: Number(o.payment_card_amount ?? 0),
    voucher: Number(o.payment_voucher_amount ?? 0),
    subtotal: Number(o.subtotal),
    discounts: [
      { label: "Member discount", amount: Number(o.tier_discount) },
      { label: "Monthly member discount", amount: Number(o.monthly_discount) },
      { label: "Points reward", amount: Number(o.redemption_discount) },
    ].filter((d) => d.amount > 0),
    tax: Number(o.tax),
    tip: Number(o.tip),
    total: Number(o.total),
    lines: o.items.map((i) => ({ name: i.name, qty: i.quantity, unit: Number(i.unit_price), mods: i.modifiers ?? [], screeningId: i.screening_id })),
  }));
}

// Refund from the register (manager PIN). Card money goes back to the card
// through Stripe; for cash, staff hand it back. Returns the reason on failure
// (a wrong PIN, say), since a thrown message is hidden in production.
export async function refundRegisterOrder(orderId: string, pin: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await refundOrder(orderId, pin);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't refund that order." };
  }
}
