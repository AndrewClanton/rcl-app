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
import { refundOrder } from "@/app/admin/reports/actions";
import { sendKitchenTicket } from "@/lib/print/kitchen";
import { asStation, type RegisterStation } from "@/lib/print/stations";
import { cents, ENFORCE_REGISTER_TOTALS, isRewardLine, pointsEarned } from "@/lib/register-totals";
import { checkSaleTotals, flagSale, verifyCardPayment, type TotalsCheck } from "@/lib/register-sale-checks";
import { currentMemberId } from "@/lib/member-forward";

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
  // Which register (Devices): printed on the kitchen's order ticket.
  station?: RegisterStation | null;
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
// here is flagged for a manager (Reports -> Register checks), not thrown:
// throwing would show a paid sale as failed, and a retry finds the order by
// its payment and stops before reaching this.
async function saveSaleItems(
  supabase: ReturnType<typeof createAdminClient>,
  sale: { orderId: string; orderNumber: number; employeeId: string; paymentIntentId: string | null },
  lines: CheckoutLine[],
) {
  const r = await replaceOrderItems(supabase, sale.orderId, lines);
  if (r.ok) return;
  console.error("sale items not saved", sale.orderId, r.error);
  const items = lines.slice(0, 50).map((l) => `${l.quantity} x ${String(l.name).slice(0, 80)}`);
  const summary = `Order #${sale.orderNumber} saved as paid, but its items didn't. Put them back by hand: ${items.join(", ")}${lines.length > items.length ? ", ..." : ""}.`;
  after(() => flagSale("items_not_saved", { ...sale, details: { summary, items, error: r.error } }));
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
  // The account a merged-away member became (lib/member-forward.ts), so the
  // points and the totals check read the account completeOrder will pay.
  const needsMember = !!fields.memberId && ((fields.pointsRedeemed && totals.redemption_discount > 0) || ENFORCE_REGISTER_TOTALS);
  const memberId = needsMember ? await currentMemberId(fields.memberId) : fields.memberId;
  if (fields.pointsRedeemed && totals.redemption_discount > 0) {
    if (!memberId) return { ok: false, error: "A points reward needs a member on the order. Attach the member, or uncheck the reward." };
    const points = await memberPoints(supabase, memberId);
    if (points !== undefined && (points ?? 0) < POINTS_PER_REWARD) {
      return {
        ok: false,
        points: points ?? 0,
        error: `This member has ${Math.floor(points ?? 0)} points now, and a reward takes ${POINTS_PER_REWARD}, so it's been taken off the order. Check the new total, then take payment.`,
      };
    }
  }
  if (ENFORCE_REGISTER_TOTALS) {
    const check = await checkSaleTotals({ ...fields, memberId, totals });
    if (check.problems.length) return { ok: false, error: `This order doesn't add up, so it can't be paid yet: ${check.problems[0]} Clear it and ring it up again, or get a manager.` };
  }
  return { ok: true };
}

// cardCharged: the card was charged for this sale even though it wasn't
// saved, so the register keeps its "card WAS charged" warning up.
// warning: saved, but staff need to know something (shown with the sale).
export type CompleteOrderResult = { ok: true; orderNumber: number; warning?: string } | { ok: false; error: string; cardCharged: boolean };

export async function completeOrder(params: CompleteOrderInput): Promise<CompleteOrderResult> {
  await assertStaff();
  if (params.lines.length === 0) throw new Error("Cart is empty");

  const supabase = createAdminClient();
  // To the cent, like everything the card is charged for.
  const tip = cents(params.tip ?? 0);
  // The member on the sale, or the account they were merged into while the
  // sale was open (lib/member-forward.ts): the old id would fail after
  // they've paid.
  const memberId = await currentMemberId(params.memberId);

  const orderFields = {
    source: "pos" as const,
    status: "completed" as const,
    employee_id: params.employeeId,
    member_id: memberId,
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
    // No order or tab name here: the flags keep no customer details (a tab
    // is found by its id, a sale by its payment).
    after(() => flagSale("card_refused", { ...flagBase, details: { reason: card.reason, payment: params.payment, totals: params.totals, tip, tabId: params.draftOrderId ?? null } }));
    return { ok: false, error: card.error, cardCharged: card.charged };
  }

  // The order's math, redone from the menu. Log-only unless enforcing; when
  // enforcing, a sale whose card is already charged is still saved (and
  // flagged): the register checked before payment, and losing the record
  // of a charged card is worse.
  const saleForCheck = { ...params, memberId, tip };
  let totalsCheck: TotalsCheck | null = null;
  if (ENFORCE_REGISTER_TOTALS) {
    totalsCheck = await checkSaleTotals(saleForCheck);
    if (totalsCheck.problems.length && !paymentIntentId) {
      const refused = totalsCheck;
      after(() => flagSale("totals_refused", { ...flagBase, details: { problems: refused.problems, sent: params.totals, server: refused.server, lines: refused.lines, member: refused.member, payment: params.payment, tip } }));
      return { ok: false, error: `This order doesn't add up, so it wasn't saved: ${refused.problems[0]} Clear it and ring it up again, or get a manager.`, cardCharged: false };
    }
  }

  let orderId = "";
  let orderNumber = 0;
  let wasTab = false;
  // A tab paid by card here after it was closed (paid or cancelled) on
  // another register: the card is charged, so the sale is kept as a new
  // walk-up order and flagged, instead of an error Retry saving could never
  // get past.
  let closedElsewhere: { tabId: string; orderNumber: number | null; status: string } | null = null;

  if (params.draftOrderId) {
    const { data: existing, error: fetchErr } = await supabase.from("orders").select("order_number, status").eq("id", params.draftOrderId).maybeSingle();
    if (fetchErr) throw fetchErr;
    let closedNow = false;
    if (existing) {
      // Only an open tab or held order can be closed, so two closes racing
      // can't both award points and write items.
      const { data: closed, error: updateErr } = await supabase.from("orders").update(orderFields).eq("id", params.draftOrderId).in("status", ["draft", "held", "tab"]).select("id");
      if (updateErr) throw updateErr;
      closedNow = !!closed?.length;
    }
    if (closedNow && existing) {
      orderId = params.draftOrderId;
      orderNumber = Number(existing.order_number);
      wasTab = existing.status === "tab";
      await saveSaleItems(supabase, { orderId, orderNumber, ...flagBase }, params.lines);
    } else {
      // This payment's own close may have landed a moment ago (a retry).
      const saved = await orderForPayment();
      if (saved !== null) return { ok: true, orderNumber: saved };
      if (!paymentIntentId) {
        return { ok: false, error: "This tab was already closed on another register, so this sale wasn't saved. Hand back any cash taken for it, and check Recent orders.", cardCharged: false };
      }
      closedElsewhere = { tabId: params.draftOrderId, orderNumber: existing ? Number(existing.order_number) : null, status: existing?.status ?? "deleted" };
    }
  }

  if (!params.draftOrderId || closedElsewhere) {
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
    await saveSaleItems(supabase, { orderId, orderNumber, ...flagBase }, params.lines);
  }

  // The member's balance before this sale moves it. A reward's points come
  // out below only if it covers them, and the log-only totals check (run
  // after the register has its answer, so after the points have moved)
  // judges the reward on this, not on what's left once it's used.
  const balanceBefore = memberId && params.pointsRedeemed ? await memberPoints(supabase, memberId) : undefined;

  // Anything worth a look is flagged after the register has its answer, so
  // it never slows a sale down.
  const saved = { ...flagBase, orderId, orderNumber };
  after(async () => {
    if (closedElsewhere) {
      await flagSale("tab_closed_elsewhere", {
        ...saved,
        details: {
          summary: `Possible double charge: a tab${closedElsewhere.orderNumber ? ` (#${closedElsewhere.orderNumber})` : ""} was ${closedElsewhere.status === "deleted" ? "cancelled" : "closed"} on another register before this card payment saved, so it was saved as new order #${orderNumber}. Check both and refund one. Until one is refunded in full, the member's points (and any reward used) and any movie seats count twice.`,
          tabId: closedElsewhere.tabId,
          tabOrderNumber: closedElsewhere.orderNumber,
          tabStatus: closedElsewhere.status,
          amount: params.payment.card,
          payment: params.payment,
          tip,
        },
      });
    }
    if (card.flag) await flagSale("card_unchecked", { ...saved, details: { reason: card.flag.reason, detail: card.flag.detail, payment: params.payment } });
    const check = totalsCheck ?? (await checkSaleTotals({ ...saleForCheck, memberPointsBefore: balanceBefore }));
    if (check.skipped) console.warn("[register-check] totals not checked", orderNumber, check.skipped);
    if (check.problems.length) {
      await flagSale("totals_mismatch", { ...saved, details: { problems: check.problems, sent: params.totals, server: check.server, lines: check.lines, member: check.member, payment: params.payment, tip, draft: !!params.draftOrderId } });
    }
  });

  // 1 point per $1 of the order after discounts, and 100 back out when a
  // reward was used. Each change lands in the member's points history, tied
  // to this order.
  if (memberId) {
    if (params.pointsRedeemed && params.totals.redemption_discount > 0) {
      // The register checked the balance before payment; this catches a
      // reward used meanwhile (or a register that skipped the check). The
      // customer has paid by now, so the sale stands, but the balance never
      // goes below zero: the points aren't taken, and a manager is told.
      const balance = balanceBefore;
      if (balance === undefined || (balance ?? 0) >= POINTS_PER_REWARD) {
        await applyPoints({ memberId, delta: -POINTS_PER_REWARD, reason: "redeem", orderId, note: `${params.totals.redemption_discount.toFixed(2)} off order #${orderNumber}`, by: params.employeeId || null });
      } else {
        after(() => flagSale("points_short", { ...saved, details: { memberId, points: balance, reward: params.totals.redemption_discount } }));
      }
    }
    const earned = pointsEarned(params.totals);
    if (earned > 0) await applyPoints({ memberId, delta: earned, reason: "purchase", orderId, note: `Order #${orderNumber}`, by: params.employeeId || null });
  }

  await syncTicketBookings(supabase, { id: orderId, memberId, name: params.orderName || null }, params.lines);

  // A closed tab's card on file comes off file, however the tab was paid.
  // (A tab closed elsewhere had its card released there.)
  if (params.draftOrderId && !closedElsewhere) await releaseTabCard(orderId);

  // A custom item usually means the menu couldn't describe the sale, so each
  // one becomes a dev note to review. Best-effort: never blocks the sale. A
  // badge reward's $0 line isn't one.
  const customLines = params.lines.filter((l) => !l.menu_item_id && !l.screening_id && !isRewardLine(l));
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
  // kitchen printer. A tab closed elsewhere already went to the kitchen as
  // that tab, so its new order doesn't print again.
  if (!closedElsewhere) {
    await sendKitchenTicket(
      { orderId, orderNumber, name: params.orderName || null, tab: wasTab, station: asStation(params.station), lines: params.lines },
      "now",
    );
  }

  revalidate();
  if (closedElsewhere) {
    return {
      ok: true,
      orderNumber,
      warning: `That tab was already closed on another register, so this card payment was saved as new order #${orderNumber}. The customer may have paid twice: get a manager to check Recent orders and refund one.`,
    };
  }
  return { ok: true, orderNumber };
}

// The order a card payment already saved as, if any: a reader payment found
// after a reload may have saved just before the page went (its sale landed,
// but the register never heard). Undefined if it couldn't be looked up.
export async function savedOrderForPayment(paymentIntentId: string): Promise<number | null | undefined> {
  await assertStaff();
  if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) return null;
  const { data, error } = await createAdminClient().from("orders").select("order_number").eq("stripe_payment_intent_id", paymentIntentId).neq("status", "voided").limit(1);
  if (error) return undefined;
  return data?.[0] ? Number(data[0].order_number) : null;
}

// "Stop trying" on the register's "card WAS charged" warning: the card
// stays charged and the sale won't be in Reports, so a manager is told
// (Reports -> Register checks). The flag itself is best effort (see
// flagSale); the register tells staff if this call doesn't get through.
export async function logAbandonedSale(order: CompleteOrderInput, tries: number): Promise<void> {
  const staff = await assertStaff();
  const paymentIntentId = order.payment?.stripePaymentIntentId ?? null;
  const amount = cents(Number(order.payment?.card) || 0);
  await flagSale("sale_abandoned", {
    employeeId: order.employeeId,
    paymentIntentId: paymentIntentId && /^pi_[A-Za-z0-9]+$/.test(paymentIntentId) ? paymentIntentId : null,
    details: {
      summary: `The card was charged $${amount.toFixed(2)} but the sale never saved, and someone tapped "Stop trying". The money is in Stripe with no sale in Reports: check with the cashier, and refund it if the customer shouldn't have paid.`,
      amount,
      tip: cents(Number(order.tip) || 0),
      // No order or tab name: the flags keep no customer details.
      tabId: order.draftOrderId ?? null,
      items: (order.lines ?? []).slice(0, 50).map((l) => `${l.quantity} x ${String(l.name).slice(0, 80)}`),
      tries,
      stoppedBy: staff.name,
    },
  });
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
  const memberId = await currentMemberId(fields.memberId);
  const { data: orderNumber, error: numberErr } = await supabase.rpc("next_order_number");
  if (numberErr) throw numberErr;

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      order_number: orderNumber,
      source: "pos",
      status,
      employee_id: fields.employeeId,
      member_id: memberId,
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
  // A tab opened with items already rung: the kitchen gets its first
  // ticket after a short pause for more (lib/print/kitchen.ts). A held
  // order isn't an order yet, so it doesn't print.
  if (status === "tab" && fields.lines.length) {
    await sendKitchenTicket({ orderId: order.id, orderNumber: Number(orderNumber), name: fields.orderName || null, tab: true, station: asStation(fields.station), lines: fields.lines }, "hold");
  }
  revalidate();
  return order.id;
}

const OPEN_DRAFT = ["draft", "held", "tab"];

// closed: the order isn't open anymore (paid or cancelled, usually on
// another register), so trying the same save again can't work.
export type DraftSaveResult = { ok: true } | { ok: false; error: string; closed?: boolean };

// opts.kitchen: for a tab, when what's new since the kitchen's last ticket
// prints: "hold" (the default, while it's still being rung) or "now" (the
// tab is being put away).
export async function updateDraftOrder(id: string, fields: DraftFields, totals: CheckoutTotals, opts?: { kitchen?: "hold" | "now" }): Promise<DraftSaveResult> {
  await assertStaff();
  const supabase = createAdminClient();
  const memberId = await currentMemberId(fields.memberId);
  const { data: updated, error } = await supabase
    .from("orders")
    .update({
      employee_id: fields.employeeId,
      member_id: memberId,
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
    .select("id, order_number, status");
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
  // Anything added to a tab goes to the kitchen as an ADD-ON ticket.
  if (updated[0].status === "tab") {
    await sendKitchenTicket(
      { orderId: id, orderNumber: Number(updated[0].order_number), name: fields.orderName || null, tab: true, station: asStation(fields.station), lines: fields.lines },
      opts?.kitchen === "now" ? "now" : "hold",
    );
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

// Manager PIN (src/lib/manager-pin.ts). Returns the reason on failure and,
// on success, whose PIN approved it.
export async function cancelTab(id: string, pin: string): Promise<ApprovalResult> {
  const staff = await assertStaff();
  const approval = await checkManagerPin(pin, "cancel-tab", staff.employeeId, id);
  if (!approval.ok) return approval;
  const supabase = createAdminClient();
  // Only a tab that's still open: one paid on another register meanwhile is
  // a sale now, and deleting it would lose it. Its card on file is released
  // first, like any discarded draft.
  const { data: open } = await supabase.from("orders").select("id").eq("id", id).in("status", OPEN_DRAFT).maybeSingle();
  if (!open) return { ok: false, error: "That tab isn't open anymore. It may have been paid on another register. Check Recent orders." };
  await releaseTabCard(id);
  await supabase.from("orders").delete().eq("id", id).in("status", OPEN_DRAFT);
  revalidate();
  return { ok: true, approvedBy: approval.approvedBy, defaultPin: approval.defaultPin };
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
      "id, order_number, status, completed_at, order_name, tab_name, payment_method, payment_cash_amount, payment_card_amount, payment_voucher_amount, subtotal, tier_discount, monthly_discount, redemption_discount, tax, tip, total, employee:employees!orders_employee_id_fkey(name), member:members(name), items:order_items(name, quantity, unit_price, modifiers, screening_id)",
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
export async function refundRegisterOrder(orderId: string, pin: string): Promise<ApprovalResult> {
  try {
    return await refundOrder(orderId, pin);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't refund that order." };
  }
}
