"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkManagerPin } from "@/lib/manager-pin";
import type { ApprovalResult } from "@/lib/pin-rules";
import { assertStaff } from "@/lib/auth";
import { getPosMember, type PosMember } from "./member-actions";
import { applyPoints, POINTS_PER_REWARD } from "@/lib/points";
import { releaseTabCard } from "@/lib/tab-card";
import { refundOrder, refundOrderPart, type PartialRefundResult } from "@/app/admin/reports/actions";
import { mostRefundable } from "@/lib/data/refund-plan";
import { sendKitchenTicket } from "@/lib/print/kitchen";
import { asStation, type RegisterStation } from "@/lib/print/stations";
import { cents, ENFORCE_REGISTER_TOTALS, pointsEarned } from "@/lib/register-totals";
import { checkSaleTotals, flagSale, verifyCardPayment, type TotalsCheck } from "@/lib/register-sale-checks";

export interface CheckoutLine {
  // The order_items row this line was loaded from or saved as (a tab's
  // lines), so the next save keeps that row, and the kitchen and bar
  // boards' ready mark with it. A new line has none.
  id?: string | null;
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
  voucherCode?: string | null; // the number on the voucher(s), when the cashier typed it
}

export interface DraftFields {
  employeeId: string;
  memberId: string | null;
  orderName: string;
  taxFree: boolean;
  monthlyMember: boolean;
  pointsRedeemed: boolean;
  lines: CheckoutLine[];
  // Which register (Devices): printed on the kitchen's order ticket.
  station?: RegisterStation | null;
  // The 21+ ID check was done for this order (asked when its first alcohol
  // went on). Kept on a held order or tab as orders.age_verified.
  ageVerified?: boolean;
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
  age_verified: boolean;
  lines: (CheckoutLine & { unit: number })[];
}

function revalidate() {
  revalidatePath("/pos");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The lines as the database functions take them (migration
// 20261001110000_register_tabs.sql). An id is only passed when it looks
// like one; the function only keeps it when it's one of this order's rows.
function itemsPayload(lines: CheckoutLine[]) {
  return lines.map((l) => ({
    id: l.id && UUID.test(l.id) ? l.id : null,
    menu_item_id: l.menu_item_id,
    name: l.name,
    unit_price: l.unit_price,
    quantity: l.quantity,
    modifiers: l.modifiers,
    is_alcohol: l.is_alcohol,
    screening_id: l.screening_id ?? null,
  }));
}

// Makes an order's items exactly `lines`, in one transaction
// (sync_order_items): an unchanged line keeps its row and its ready mark,
// a changed one is updated, a new one added, one taken off deleted. It all
// lands or none of it does. itemIds: each line's row, in order.
async function syncOrderItems(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
  lines: CheckoutLine[],
): Promise<{ ok: true; itemIds: string[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("sync_order_items", { p_order: orderId, p_items: itemsPayload(lines) });
  if (error) return { ok: false, error: error.message };
  return { ok: true, itemIds: ((data ?? []) as string[]).map(String) };
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
// here isn't thrown: throwing would show a paid sale as failed, and a retry
// finds the order by its payment and stops before reaching this. It's tried
// twice, then flagged (register_sale_flags, items_not_saved, with the lines
// rung), so a paid sale that shows in Reports with no items has a record of
// what was on it. A tab's lines carry their rows, so the kitchen's ready
// marks survive the payment.
async function saveSaleItems(
  supabase: ReturnType<typeof createAdminClient>,
  sale: { orderId: string; orderNumber: number; employeeId: string; paymentIntentId: string | null },
  lines: CheckoutLine[],
) {
  let r = await syncOrderItems(supabase, sale.orderId, lines);
  if (!r.ok) r = await syncOrderItems(supabase, sale.orderId, lines);
  if (r.ok) return;
  console.error("sale items not saved", sale.orderId, r.error);
  await flagSale("items_not_saved", {
    orderId: sale.orderId,
    orderNumber: sale.orderNumber,
    employeeId: sale.employeeId,
    paymentIntentId: sale.paymentIntentId,
    details: { error: r.error, lines: lines.map((l) => ({ name: l.name, qty: l.quantity, unit: l.unit_price, mods: l.modifiers })) },
  });
}

// The voucher number(s) as typed, trimmed to at most 40 characters, or
// null when none was typed.
function voucherCode(typed: unknown): string | null {
  if (typeof typed !== "string") return null;
  const code = typed.trim().replace(/\s+/g, " ").slice(0, 40);
  return code || null;
}

export type CompleteOrderInput = DraftFields & {
  totals: CheckoutTotals;
  payment: CheckoutPayment;
  ageVerified: boolean;
  tip?: number;
  draftOrderId?: string | null;
};

// A member's points balance: null if there's no such member, undefined if
// it couldn't be read.
async function memberPoints(supabase: ReturnType<typeof createAdminClient>, memberId: string): Promise<number | null | undefined> {
  const { data, error } = await supabase.from("members").select("points").eq("id", memberId).maybeSingle();
  if (error) return undefined;
  return data ? Number(data.points) : null;
}

// Checked right before the payment screen opens, so a problem is caught
// before anyone pays instead of after. A check that can't run lets the sale
// through (completeOrder looks again).
export type PaymentCheck = { ok: true } | { ok: false; error: string; points?: number };

export async function checkBeforePayment(fields: DraftFields, totals: CheckoutTotals): Promise<PaymentCheck> {
  await assertStaff();
  const supabase = createAdminClient();
  if (fields.pointsRedeemed && totals.redemption_discount > 0) {
    if (!fields.memberId) return { ok: false, error: "A points reward needs a member on the order. Attach the member, or uncheck the reward." };
    const points = await memberPoints(supabase, fields.memberId);
    if (points !== undefined && (points ?? 0) < POINTS_PER_REWARD) {
      return {
        ok: false,
        points: points ?? 0,
        error: `This member has ${Math.floor(points ?? 0)} points now, and a reward takes ${POINTS_PER_REWARD}, so it's been taken off the order. Check the new total, then take payment.`,
      };
    }
  }
  if (ENFORCE_REGISTER_TOTALS) {
    const check = await checkSaleTotals({ ...fields, totals });
    if (check.problems.length) return { ok: false, error: `This order doesn't add up, so it can't be paid yet: ${check.problems[0]} Clear it and ring it up again, or get a manager.` };
  }
  return { ok: true };
}

// cardCharged: the card was charged for this sale even though it wasn't
// saved, so the register keeps its "card WAS charged" warning up.
export type CompleteOrderResult = { ok: true; orderNumber: number } | { ok: false; error: string; cardCharged: boolean };

export async function completeOrder(params: CompleteOrderInput): Promise<CompleteOrderResult> {
  await assertStaff();
  if (params.lines.length === 0) throw new Error("Cart is empty");

  const supabase = createAdminClient();
  // To the cent, like everything the card is charged for.
  const tip = cents(params.tip ?? 0);

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
    total: cents(params.totals.total + tip),
    payment_method: params.payment.method,
    payment_cash_amount: params.payment.cash,
    payment_voucher_amount: params.payment.voucher ?? 0,
    payment_voucher_code: (params.payment.voucher ?? 0) > 0 ? voucherCode(params.payment.voucherCode) : null,
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
  if (already !== null) return { ok: true, orderNumber: already };

  // The card payment, confirmed with Stripe before the sale is saved.
  const flagBase = { employeeId: params.employeeId, paymentIntentId };
  const card = await verifyCardPayment(params.payment, params.draftOrderId ?? null);
  if (!card.ok) {
    after(() => flagSale("card_refused", { ...flagBase, details: { reason: card.reason, payment: params.payment, totals: params.totals, tip, orderName: params.orderName } }));
    return { ok: false, error: card.error, cardCharged: card.charged };
  }

  // The order's math, redone from the menu. Log-only unless enforcing; when
  // enforcing, a sale whose card is already charged is still saved (and
  // flagged): the register checked before payment, and losing the record
  // of a charged card is worse.
  const saleForCheck = { ...params, tip };
  let totalsCheck: TotalsCheck | null = null;
  if (ENFORCE_REGISTER_TOTALS) {
    totalsCheck = await checkSaleTotals(saleForCheck);
    if (totalsCheck.problems.length && !paymentIntentId) {
      const refused = totalsCheck;
      after(() => flagSale("totals_refused", { ...flagBase, details: { problems: refused.problems, sent: params.totals, server: refused.server, lines: refused.lines, member: refused.member, payment: params.payment, tip } }));
      return { ok: false, error: `This order doesn't add up, so it wasn't saved: ${refused.problems[0]} Clear it and ring it up again, or get a manager.`, cardCharged: false };
    }
  }

  let orderId: string;
  let orderNumber: number;
  let wasTab = false;

  if (params.draftOrderId) {
    const { data: existing, error: fetchErr } = await supabase.from("orders").select("order_number, status, age_verified").eq("id", params.draftOrderId).single();
    if (fetchErr || !existing) throw new Error("Tab no longer exists");
    orderId = params.draftOrderId;
    orderNumber = Number(existing.order_number);
    wasTab = existing.status === "tab";
    // An ID check recorded on the tab (on either register) stays recorded.
    const closing = { ...orderFields, age_verified: orderFields.age_verified || !!existing.age_verified };
    // Only an open tab or held order can be closed, so two closes racing
    // can't both award points and write items.
    const { data: closed, error: updateErr } = await supabase.from("orders").update(closing).eq("id", orderId).in("status", ["draft", "held", "tab"]).select("id");
    if (updateErr) throw updateErr;
    if (!closed?.length) {
      if ((await orderForPayment()) !== null) return { ok: true, orderNumber };
      throw new Error("This tab was already closed. Check Reports before taking payment again.");
    }
    await saveSaleItems(supabase, { orderId, orderNumber, employeeId: params.employeeId, paymentIntentId }, params.lines);
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
      if (saved !== null) return { ok: true, orderNumber: saved };
      throw orderErr;
    }
    orderId = order.id;
    await saveSaleItems(supabase, { orderId, orderNumber, employeeId: params.employeeId, paymentIntentId }, params.lines);
  }

  // Anything worth a look is flagged after the register has its answer, so
  // it never slows a sale down.
  const saved = { ...flagBase, orderId, orderNumber };
  after(async () => {
    if (card.flag) await flagSale("card_unchecked", { ...saved, details: { reason: card.flag.reason, detail: card.flag.detail, payment: params.payment } });
    const check = totalsCheck ?? (await checkSaleTotals(saleForCheck));
    if (check.skipped) console.warn("[register-check] totals not checked", orderNumber, check.skipped);
    if (check.problems.length) {
      await flagSale("totals_mismatch", { ...saved, details: { problems: check.problems, sent: params.totals, server: check.server, lines: check.lines, member: check.member, payment: params.payment, tip, draft: !!params.draftOrderId } });
    }
  });

  // 1 point per $1 of the order after discounts, and 100 back out when a
  // reward was used. Each change lands in the member's points history, tied
  // to this order.
  if (params.memberId) {
    if (params.pointsRedeemed && params.totals.redemption_discount > 0) {
      // The register checked the balance before payment; this catches a
      // reward used meanwhile (or a register that skipped the check). The
      // customer has paid by now, so the sale stands, but the balance never
      // goes below zero: the points aren't taken, and a manager is told.
      const balance = await memberPoints(supabase, params.memberId);
      if (balance === undefined || (balance ?? 0) >= POINTS_PER_REWARD) {
        await applyPoints({ memberId: params.memberId, delta: -POINTS_PER_REWARD, reason: "redeem", orderId, note: `${params.totals.redemption_discount.toFixed(2)} off order #${orderNumber}`, by: params.employeeId || null });
      } else {
        after(() => flagSale("points_short", { ...saved, details: { memberId: params.memberId, points: balance, reward: params.totals.redemption_discount } }));
      }
    }
    const earned = pointsEarned(params.totals);
    if (earned > 0) await applyPoints({ memberId: params.memberId, delta: earned, reason: "purchase", orderId, note: `Order #${orderNumber}`, by: params.employeeId || null });
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

  // The kitchen's order ticket: the whole order, or for a tab whatever
  // hadn't gone to the kitchen yet. Never throws; nothing happens without a
  // kitchen printer.
  await sendKitchenTicket(
    { orderId, orderNumber, name: params.orderName || null, tab: wasTab, station: asStation(params.station), lines: params.lines },
    "now",
  );

  revalidate();
  return { ok: true, orderNumber };
}

// ---------- held orders & tabs (persisted drafts, status 'held' | 'tab') ----------
//
// Draft rows must carry a real, current total (not a 0 placeholder) --
// getDraftOrders reads it straight from the row rather than recomputing a
// bare item subtotal, so the held/tabs lists always show the same
// tax-and-discount-inclusive number the cashier sees in the cart. Callers
// pass the totals they already computed for the on-screen cart.

const ZERO_TOTALS: CheckoutTotals = { subtotal: 0, tier_discount: 0, monthly_discount: 0, redemption_discount: 0, tax: 0, total: 0 };

// itemIds: each line's order_items row, in order, so the register's next
// save of a new tab keeps them.
export async function saveDraftOrder(status: "held" | "tab", fields: DraftFields, totals: CheckoutTotals = ZERO_TOTALS): Promise<{ id: string; itemIds: string[] }> {
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
      age_verified: !!fields.ageVerified,
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

  const items = await syncOrderItems(supabase, order.id, fields.lines);
  if (!items.ok) {
    // Don't leave an empty held order or tab behind: the register keeps the
    // items on screen, and trying again makes a whole new one.
    console.error("draft items not saved", order.id, items.error);
    await supabase.from("orders").delete().eq("id", order.id);
    throw new Error("Couldn't save the items.");
  }
  // A tab opened with items already rung: the kitchen gets its first
  // ticket after a short pause for more (lib/print/kitchen.ts). A held
  // order isn't an order yet, so it doesn't print.
  if (status === "tab" && fields.lines.length) {
    await sendKitchenTicket({ orderId: order.id, orderNumber: Number(orderNumber), name: fields.orderName || null, tab: true, station: asStation(fields.station), lines: fields.lines }, "hold");
  }
  revalidate();
  return { id: order.id, itemIds: items.itemIds };
}

const OPEN_DRAFT = ["draft", "held", "tab"];

// closed: the order isn't open anymore (paid or cancelled, usually on
// another register), so trying the same save again can't work.
// itemIds: each line's order_items row, in order, for the next save.
export type DraftSaveResult = { ok: true; itemIds: string[] } | { ok: false; error: string; closed?: boolean };

// The header and the items are saved together (replace_draft_order, one
// transaction), so a failure leaves the tab as it was: never a Tabs-list
// total ahead of its items, never the items twice. Lines keep their rows by
// id, so the kitchen and bar boards keep what they've marked ready. Only
// an order that's still held or an open tab is saved: a register with an
// out-of-date list must never rewrite a sale that's already been paid.
//
// opts.kitchen: for a tab, when what's new since the kitchen's last ticket
// prints: "hold" (the default, while it's still being rung) or "now" (the
// tab is being put away).
export async function updateDraftOrder(id: string, fields: DraftFields, totals: CheckoutTotals, opts?: { kitchen?: "hold" | "now" }): Promise<DraftSaveResult> {
  await assertStaff();
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("replace_draft_order", {
    p_order: id,
    p_fields: {
      employee_id: fields.employeeId || null, // blank keeps whoever was on it
      member_id: fields.memberId,
      order_name: fields.orderName || null,
      tab_name: fields.orderName || null,
      tax_free: fields.taxFree,
      monthly_member: fields.monthlyMember,
      points_redeemed: fields.pointsRedeemed,
      age_verified: !!fields.ageVerified,
      subtotal: totals.subtotal,
      tier_discount: totals.tier_discount,
      monthly_discount: totals.monthly_discount,
      redemption_discount: totals.redemption_discount,
      tax: totals.tax,
      total: totals.total,
    },
    p_items: itemsPayload(fields.lines),
  });
  if (error) {
    console.error("draft save failed", id, error.message);
    return { ok: false, error: "Couldn't save the tab." };
  }
  const saved = data as { ok: boolean; status?: string; order_number?: number; item_ids?: string[] | null } | null;
  if (!saved?.ok) return { ok: false, closed: true, error: "That tab is already closed." };
  // Anything added to a tab goes to the kitchen as an ADD-ON ticket.
  if (saved.status === "tab") {
    await sendKitchenTicket(
      { orderId: id, orderNumber: Number(saved.order_number), name: fields.orderName || null, tab: true, station: asStation(fields.station), lines: fields.lines },
      opts?.kitchen === "now" ? "now" : "hold",
    );
  }
  revalidate();
  return { ok: true, itemIds: (saved.item_ids ?? []).map(String) };
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

// A held order or tab with its lines (in the order they were rung), if it
// has one of `statuses`.
async function readDraftOrder(supabase: ReturnType<typeof createAdminClient>, id: string, statuses: string[]): Promise<DraftOrderFull | null> {
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, order_name, member_id, tax_free, monthly_member, points_redeemed, age_verified, items:order_items(id, menu_item_id, name, unit_price, quantity, modifiers, is_alcohol, screening_id, created_at)")
    .eq("id", id)
    .in("status", statuses)
    .order("created_at", { referencedTable: "order_items" })
    .maybeSingle();
  if (error || !order) return null;
  const items = order.items as { id: string; menu_item_id: string | null; name: string; unit_price: number; quantity: number; modifiers: string[]; is_alcohol: boolean; screening_id: string | null }[];
  return {
    id: order.id,
    order_name: order.order_name,
    member_id: order.member_id,
    member: order.member_id ? await getPosMember(order.member_id) : null,
    tax_free: order.tax_free,
    monthly_member: order.monthly_member,
    points_redeemed: order.points_redeemed,
    age_verified: !!order.age_verified,
    lines: items.map((i) => ({
      id: i.id,
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

export async function loadDraftOrder(id: string): Promise<DraftOrderFull> {
  await assertStaff();
  const full = await readDraftOrder(createAdminClient(), id, OPEN_DRAFT);
  if (!full) throw new Error("That order was already closed on another register.");
  return full;
}

export type ResumeHeldResult = { ok: true; order: DraftOrderFull } | { ok: false; error: string };

// Opens a held order on this register: its lines come back to the screen
// and the held order is gone, in one claim. Two registers tapping Resume at
// the same moment can't both get the items: the delete only matches while
// it's still held, so only one of them takes it and the other is told.
export async function resumeHeldOrder(id: string): Promise<ResumeHeldResult> {
  await assertStaff();
  const supabase = createAdminClient();
  // Read before the claim: the items go with the order. A held order is
  // never edited (only resumed or discarded), so what's read is what's taken.
  const full = await readDraftOrder(supabase, id, ["held"]);
  if (!full) return { ok: false, error: "That held order isn't there anymore. It may have been opened on another register." };
  const { data: claimed, error } = await supabase.from("orders").delete().eq("id", id).eq("status", "held").select("id");
  if (error) {
    console.error("held order not claimed", id, error.message);
    return { ok: false, error: "Couldn't open the held order. Check the connection and try again." };
  }
  if (!claimed?.length) return { ok: false, error: "That held order was just opened on another register." };
  revalidate();
  // Its rows went with it, so the lines are new ones wherever they go next.
  return { ok: true, order: { ...full, lines: full.lines.map((l) => ({ ...l, id: null })) } };
}

// Whether a tab is still open, checked right before taking payment: a tab
// closed on the other register mustn't be charged again from this one.
export async function isDraftOpen(id: string): Promise<boolean> {
  await assertStaff();
  const { data } = await createAdminClient().from("orders").select("id").eq("id", id).in("status", OPEN_DRAFT).maybeSingle();
  return !!data;
}

// Held orders only. A tab comes off the list by being paid or cancelled
// with a manager PIN (cancelTab, which keeps it on file), and a completed
// sale can never be deleted from here (refunds go through Recent orders
// with a manager PIN).
export async function discardDraftOrder(id: string): Promise<void> {
  await assertStaff();
  const { error } = await createAdminClient().from("orders").delete().eq("id", id).eq("status", "held");
  if (error) throw new Error("Couldn't discard the held order.");
  revalidate();
}

// Manager PIN (src/lib/manager-pin.ts). Returns the reason on failure and,
// on success, whose PIN approved it.
//
// The tab is kept, with its items, as status 'cancelled': when, who was on
// the register (cashierId, else whoever is signed in), and whose PIN
// approved it. It shows in Recent orders and on the Day report's Cancelled
// tabs, and never in sales. Its card on file is released, and a kitchen
// ticket still waiting to print is called off.
export async function cancelTab(id: string, pin: string, cashierId?: string | null): Promise<ApprovalResult> {
  const staff = await assertStaff();
  const approval = await checkManagerPin(pin, "cancel-tab", staff.employeeId, id);
  if (!approval.ok) return approval;
  const supabase = createAdminClient();
  let by = staff.employeeId;
  if (cashierId && UUID.test(cashierId) && cashierId !== by) {
    const { data: cashier } = await supabase.from("employees").select("id").eq("id", cashierId).maybeSingle();
    if (cashier) by = cashier.id;
  }
  // Only a tab that's still open: one paid on another register meanwhile is
  // a sale now and stays one.
  const { data: cancelled, error } = await supabase
    .from("orders")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: by, cancel_approved_by: approval.approverId })
    .eq("id", id)
    .eq("status", "tab")
    .select("id");
  if (error) {
    console.error("tab not cancelled", id, error.message);
    return { ok: false, error: "Couldn't cancel the tab. Check the connection and try again." };
  }
  if (!cancelled?.length) return { ok: false, error: "That tab isn't open anymore. It may have been paid on another register. Check Recent orders." };
  await releaseTabCard(id);
  // Best effort: a ticket already at the printer has printed.
  await supabase
    .from("print_jobs")
    .update({ status: "cancelled", done_at: new Date().toISOString(), error: "Tab cancelled" })
    .eq("order_id", id)
    .eq("status", "queued")
    .then(
      () => {},
      () => {},
    );
  revalidate();
  return { ok: true, approvedBy: approval.approvedBy, defaultPin: approval.defaultPin };
}

// ---------- recent orders (reprint, refund, "what did they order?") ----------

export interface RecentOrder {
  id: string;
  orderNumber: number;
  status: string; // completed | refunded | voided | cancelled (a tab cancelled with a manager PIN)
  at: string; // when it was paid, or for a cancelled tab when it was cancelled
  name: string | null;
  cashier: string | null;
  member: string | null;
  method: string | null;
  cash: number;
  card: number;
  voucher: number;
  voucherCode: string | null;
  subtotal: number;
  discounts: { label: string; amount: number }[];
  tax: number;
  tip: number;
  total: number;
  lines: { name: string; qty: number; unit: number; mods: string[]; screeningId: string | null }[];
  // Partial refunds so far, and the most "Refund part" can still give back
  // (null when that couldn't be read; the server checks again either way).
  refunded: number;
  refundable: number | null;
  // A cancelled tab: who was on the register, and whose PIN approved it.
  cancelledBy: string | null;
  cancelApprovedBy: string | null;
}

const RECENT_COLUMNS =
  "id, order_number, status, source, completed_at, cancelled_at, order_name, tab_name, payment_method, payment_cash_amount, payment_card_amount, payment_voucher_amount, payment_voucher_code, subtotal, tier_discount, monthly_discount, redemption_discount, tax, tip, total, employee:employees!orders_employee_id_fkey(name), canceller:employees!orders_cancelled_by_fkey(name), approver:employees!orders_cancel_approved_by_fkey(name), member:members(name), items:order_items(name, quantity, unit_price, modifiers, screening_id, created_at)";

type RecentRow = {
  id: string;
  order_number: number;
  status: string;
  source: string;
  completed_at: string | null;
  cancelled_at: string | null;
  order_name: string | null;
  tab_name: string | null;
  payment_method: string | null;
  payment_cash_amount: number | null;
  payment_card_amount: number | null;
  payment_voucher_amount: number | null;
  payment_voucher_code: string | null;
  subtotal: number;
  tier_discount: number;
  monthly_discount: number;
  redemption_discount: number;
  tax: number;
  tip: number;
  total: number;
  employee: { name: string } | null;
  canceller: { name: string } | null;
  approver: { name: string } | null;
  member: { name: string } | null;
  items: { name: string; quantity: number; unit_price: number; modifiers: string[] | null; screening_id: string | null }[];
};

// The last `limit` sales on the register, with the tabs cancelled in the
// same stretch mixed in by time.
export async function getRecentRegisterOrders(limit = 20): Promise<RecentOrder[]> {
  await assertStaff();
  const supabase = createAdminClient();
  const [sales, cancelled] = await Promise.all([
    supabase
      .from("orders")
      .select(RECENT_COLUMNS)
      .in("status", ["completed", "refunded", "voided"])
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .order("created_at", { referencedTable: "order_items" })
      .limit(limit),
    supabase
      .from("orders")
      .select(RECENT_COLUMNS)
      .eq("status", "cancelled")
      .not("cancelled_at", "is", null)
      .order("cancelled_at", { ascending: false })
      .order("created_at", { referencedTable: "order_items" })
      .limit(limit),
  ]);
  if (sales.error) throw sales.error;
  if (cancelled.error) throw cancelled.error;
  const rows = [...((sales.data ?? []) as unknown as RecentRow[]), ...((cancelled.data ?? []) as unknown as RecentRow[])]
    .map((o) => ({ o, at: (o.status === "cancelled" ? o.cancelled_at : o.completed_at) as string }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);

  // Earlier partial refunds, for how much "Refund part" can still give
  // back. Unknown if they can't be read.
  const paidIds = rows.filter(({ o }) => o.status === "completed").map(({ o }) => o.id);
  let partials: Map<string, number> | null = new Map();
  if (paidIds.length) {
    const { data, error } = await supabase.from("order_partial_refunds").select("order_id, amount").in("order_id", paidIds);
    if (error) partials = null;
    else for (const p of data ?? []) partials.set(p.order_id, cents((partials.get(p.order_id) ?? 0) + Number(p.amount)));
  }

  return rows.map(({ o, at }) => {
    const cash = Number(o.payment_cash_amount ?? 0);
    const card = Number(o.payment_card_amount ?? 0);
    const refunded = partials?.get(o.id) ?? 0;
    return {
      id: o.id,
      orderNumber: Number(o.order_number),
      status: o.status,
      at,
      name: o.tab_name || o.order_name || null,
      cashier: o.employee?.name ?? null,
      member: o.member?.name ?? null,
      method: o.payment_method,
      cash,
      card,
      voucher: Number(o.payment_voucher_amount ?? 0),
      voucherCode: o.payment_voucher_code ?? null,
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
      refunded,
      refundable:
        o.status === "completed" && partials
          ? mostRefundable({ source: o.source, tax: Number(o.tax), tip: Number(o.tip), total: Number(o.total), cash, card }, { amount: refunded, tax: 0, card: 0 })
          : null,
      cancelledBy: o.canceller?.name ?? null,
      cancelApprovedBy: o.approver?.name ?? null,
    };
  });
}

// Refund from the register (manager PIN). Card money goes back to the card
// through Stripe; for cash, staff hand it back. Returns the reason on failure
// (a wrong PIN, say), since a thrown message is hidden in production.
export async function refundRegisterOrder(orderId: string, pin: string): Promise<ApprovalResult> {
  try {
    return await refundOrder(orderId, pin);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't refund that order." };
  }
}

// Part of a sale back (a wrong drink, a dish sent back), with the same
// manager PIN as a full refund. The back office's own partial refund does
// the work (Reports, "Refund part"): its limits, the card-first split,
// Stripe, points and the record the day report takes off.
export async function refundRegisterOrderPart(orderId: string, amount: number, reason: string, pin: string): Promise<PartialRefundResult> {
  try {
    return await refundOrderPart(orderId, amount, reason, pin);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't refund that order." };
  }
}
