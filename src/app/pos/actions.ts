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
import { readRegisterCard, settleSaleCard } from "@/lib/member-cards";
import { cardLabel, type CardNotice } from "@/lib/card-match";
import { schemaMissing } from "@/lib/schema-missing";
import { cents, ENFORCE_REGISTER_TOTALS, isRewardLine, pointsEarned } from "@/lib/register-totals";
import { checkDailyCoffee, checkSaleTotals, flagSale, verifyCardPayment, type CoffeeCheck, type TotalsCheck } from "@/lib/register-sale-checks";
import { currentMemberId } from "@/lib/member-forward";
import { coffeeDay } from "@/lib/daily-perk-server";
import { DAILY_COFFEE_LINE, type DailyCoffeeState } from "@/lib/daily-perk";

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
  // The Insiders+ daily coffee (lib/daily-perk.ts). Optional: a sale kept
  // in a register's browser from before it existed has none.
  daily_perk_discount?: number;
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

// A card sale's card, once the sale is saved: linked to the member on it,
// or finding the member for the sale's points (lib/member-cards.ts).
// Best-effort and quick: the Stripe read starts as soon as the sale comes
// in (so it's usually back by now), it never fails the sale, and if it's
// slow the register moves on after 2.5 seconds while the rest finishes in
// the background (the points still land; the register just doesn't show
// them).
const CARD_WAIT_MS = 2500;

async function settleCard(args: Parameters<typeof settleSaleCard>[0]): Promise<CardNotice | null> {
  const work = settleSaleCard(args).catch((e) => {
    console.error("card points failed", args.orderId, e);
    return null;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), CARD_WAIT_MS);
  });
  const first = await Promise.race([work, late]);
  clearTimeout(timer);
  if (first !== "late") return first;
  try {
    after(() => work.then(() => undefined));
  } catch {
    // Not inside a request: the work carries on by itself.
  }
  return null;
}

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
// dropDailyCoffee: the Insiders+ daily coffee has to come off the order,
// with the member's coffee today when that's why (already used: the
// register shows when).
export type PaymentCheck = { ok: true } | { ok: false; error: string; points?: number; dropDailyCoffee?: DailyCoffeeState | null };

export async function checkBeforePayment(fields: DraftFields, totals: CheckoutTotals): Promise<PaymentCheck> {
  await assertStaff();
  const supabase = createAdminClient();
  const coffeeOn = Number(totals.daily_perk_discount ?? 0) > 0;
  // The account a merged-away member became (lib/member-forward.ts), so the
  // points and the totals check read the account completeOrder will pay.
  const needsMember = !!fields.memberId && ((fields.pointsRedeemed && totals.redemption_discount > 0) || coffeeOn || ENFORCE_REGISTER_TOTALS);
  const memberId = needsMember ? await currentMemberId(fields.memberId) : fields.memberId;
  // A daily coffee the member has already had today (on the other
  // register, say), or can't have, comes off before anyone pays. Checked
  // whether or not totals are enforced. If the check can't run, the sale
  // goes ahead (completeOrder looks again).
  let dailyCoffee: CoffeeCheck | undefined;
  if (coffeeOn) {
    dailyCoffee = await checkDailyCoffee({ memberId, lines: fields.lines });
    if (!dailyCoffee.ok) {
      return {
        ok: false,
        error: `${dailyCoffee.reason} The free coffee has been taken off the order. Check the new total, then take payment.`,
        dropDailyCoffee: dailyCoffee.used ? { usedAt: dailyCoffee.used.usedAt, orderNumber: dailyCoffee.used.orderNumber } : null,
      };
    }
  }
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
    const check = await checkSaleTotals({ ...fields, memberId, totals, dailyCoffee });
    if (check.problems.length) return { ok: false, error: `This order doesn't add up, so it can't be paid yet: ${check.problems[0]} Clear it and ring it up again, or get a manager.` };
  }
  return { ok: true };
}

// cardCharged: the card was charged for this sale even though it wasn't
// saved, so the register keeps its "card WAS charged" warning up.
// warning: saved, but staff need to know something (shown with the sale).
// card: what the card that paid did (linked to the member, or found the
// member for the points), for the register's card notice; null for nothing
// to show.
export type CompleteOrderResult = { ok: true; orderNumber: number; warning?: string; card: CardNotice | null } | { ok: false; error: string; cardCharged: boolean };

export async function completeOrder(params: CompleteOrderInput): Promise<CompleteOrderResult> {
  const staff = await assertStaff();
  if (params.lines.length === 0) throw new Error("Cart is empty");

  const supabase = createAdminClient();
  // To the cent, like everything the card is charged for.
  const tip = cents(params.tip ?? 0);
  const paymentIntentId = params.payment.stripePaymentIntentId ?? null;
  // The card that paid, read from Stripe while the sale is checked and saved
  // (it's checked against the saved sale before it's used). Never throws.
  // Only a well-formed payment id: verifyCardPayment refuses anything else.
  const cardRead = paymentIntentId && /^pi_[A-Za-z0-9]+$/.test(paymentIntentId) ? readRegisterCard(paymentIntentId) : Promise.resolve(null);
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
  const orderForPayment = async () => {
    if (!paymentIntentId) return null;
    const { data } = await supabase.from("orders").select("id, order_number, employee_id").eq("stripe_payment_intent_id", paymentIntentId).neq("status", "voided").limit(1);
    return data?.[0] ? { id: data[0].id as string, orderNumber: Number(data[0].order_number), employeeId: (data[0].employee_id as string | null) ?? null } : null;
  };
  // The card step, also for a sale saved on an earlier try whose answer
  // never reached the register: it's safe to repeat (nothing is linked or
  // paid twice), and shows the register what it missed. mayAct: the
  // notice's buttons, only for the cashier who rang the sale.
  const cardFor = (orderId: string, mayAct: boolean) =>
    paymentIntentId
      ? settleCard({ orderId, paymentIntentId, cardRead, cashierId: params.employeeId || null, staff: { employeeId: staff.employeeId, email: staff.email || null }, mayAct })
      : Promise.resolve(null);
  const sameCashier = (saved: { employeeId: string | null }) => !!saved.employeeId && saved.employeeId === params.employeeId;
  const already = await orderForPayment();
  if (already !== null) return { ok: true, orderNumber: already.orderNumber, card: await cardFor(already.id, sameCashier(already)) };

  // The card payment, confirmed with Stripe before the sale is saved.
  const flagBase = { employeeId: params.employeeId, paymentIntentId };
  const card = await verifyCardPayment(params.payment, params.draftOrderId ?? null);
  if (!card.ok) {
    // No order or tab name here: the flags keep no customer details (a tab
    // is found by its id, a sale by its payment).
    after(() => flagSale("card_refused", { ...flagBase, details: { reason: card.reason, payment: params.payment, totals: params.totals, tip, tabId: params.draftOrderId ?? null } }));
    return { ok: false, error: card.error, cardCharged: card.charged };
  }

  const saleForCheck = { ...params, memberId, tip };
  let totalsCheck: TotalsCheck | null = null;

  // The Insiders+ daily coffee (lib/daily-perk.ts): checked again here
  // (Insiders+, a daily coffee item on the order, not had today), then
  // recorded as today's on the order. The register checked before payment;
  // one that gets through anyway is still saved (the customer has paid by
  // now) but doesn't count as today's, and the totals check flags it for a
  // manager with the reason.
  const coffeeAmount = cents(Number(params.totals.daily_perk_discount ?? 0));
  const coffeeDate = coffeeDay();
  let dailyCoffee: CoffeeCheck | undefined = coffeeAmount > 0 ? await checkDailyCoffee({ memberId, lines: params.lines }, coffeeDate) : undefined;
  // The coffee's columns go on a sale only when it has one, so the register
  // keeps saving every other sale before migration
  // 20261001230000_plus_daily_coffee.sql adds them.
  let saleFields: typeof orderFields & { daily_perk_discount?: number; daily_perk_date?: string | null } =
    coffeeAmount > 0 ? { ...orderFields, daily_perk_discount: coffeeAmount, daily_perk_date: dailyCoffee?.ok ? coffeeDate : null } : orderFields;
  // The database keeps one coffee per member and day: two registers using it
  // at the same moment get here. The later sale is saved without it counting.
  const coffeeTaken = (e: { code?: string; message?: string } | null) => !!e && e.code === "23505" && (e.message ?? "").includes("orders_daily_perk_once");
  const coffeeRace = () => {
    saleFields = { ...saleFields, daily_perk_date: null };
    dailyCoffee = { ok: false, reason: "This member's free coffee for today went on another order at the same moment." };
    totalsCheck = null; // figured with the coffee allowed: look again
  };

  // The order's math, redone from the menu. Log-only unless enforcing; when
  // enforcing, a sale whose card is already charged is still saved (and
  // flagged): the register checked before payment, and losing the record
  // of a charged card is worse.
  if (ENFORCE_REGISTER_TOTALS) {
    totalsCheck = await checkSaleTotals({ ...saleForCheck, dailyCoffee });
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
      const draftId = params.draftOrderId;
      const close = () => supabase.from("orders").update(saleFields).eq("id", draftId).in("status", ["draft", "held", "tab"]).select("id");
      let { data: closed, error: updateErr } = await close();
      if (coffeeTaken(updateErr)) {
        coffeeRace();
        ({ data: closed, error: updateErr } = await close());
      }
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
      if (saved !== null) return { ok: true, orderNumber: saved.orderNumber, card: await cardFor(saved.id, sameCashier(saved)) };
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
    const insert = () =>
      supabase
        .from("orders")
        .insert({ order_number: orderNumber, ...saleFields })
        .select("id")
        .single();
    let { data: order, error: orderErr } = await insert();
    if (coffeeTaken(orderErr)) {
      coffeeRace();
      ({ data: order, error: orderErr } = await insert());
    }
    if (orderErr || !order) {
      if (!orderErr) throw new Error("The order didn't save.");
      // Lost a race with a repeat of this same card payment (the database
      // allows one order per payment): the other call saved it.
      const saved = orderErr.code === "23505" ? await orderForPayment() : null;
      if (saved !== null) return { ok: true, orderNumber: saved.orderNumber, card: await cardFor(saved.id, sameCashier(saved)) };
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
    // The coffee as judged before this sale saved (once saved, its own
    // coffee would look like today's already used).
    const check = totalsCheck ?? (await checkSaleTotals({ ...saleForCheck, dailyCoffee, memberPointsBefore: balanceBefore }));
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

  // Last, so nothing above waits on it.
  const cardNotice = await cardFor(orderId, true);

  revalidate();
  const warnings: string[] = [];
  if (closedElsewhere) {
    warnings.push(`That tab was already closed on another register, so this card payment was saved as new order #${orderNumber}. The customer may have paid twice: get a manager to check Recent orders and refund one.`);
  }
  // Saved with the free coffee, but it didn't count as today's.
  const coffee = dailyCoffee as CoffeeCheck | undefined;
  if (coffee && !coffee.ok) warnings.push(`${coffee.reason} The sale was saved with the free coffee anyway, and a manager will see it in Register checks.`);
  return warnings.length ? { ok: true, orderNumber, warning: warnings.join(" "), card: cardNotice } : { ok: true, orderNumber, card: cardNotice };
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
// pass the totals they already computed for the on-screen cart. An
// Insiders+ daily coffee is in that total but isn't stored on a draft: the
// register works it out again when the order is opened, and completeOrder
// records it when it's paid (so a held order or open tab never uses up the
// day's coffee).

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

// A manager OKs a tax-exempt sale (a customer with a Missouri exemption
// certificate) with their PIN before the register lets the "Tax exempt"
// box be ticked. Everything else is taxed (lib/sales-tax.ts). Who approved
// it is in the PIN log (pin_attempts, context "tax-exempt"), with the tab
// it was for when there is one.
export async function approveTaxExempt(pin: string, tabId: string | null): Promise<ApprovalResult> {
  const staff = await assertStaff();
  const approval = await checkManagerPin(pin, "tax-exempt", staff.employeeId, tabId ?? undefined);
  if (!approval.ok) return approval;
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
  // The member was found by the card that paid, not attached by staff.
  memberByCard: boolean;
  cardLabel: string | null; // the card that paid, e.g. "Visa •••• 4242"
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
  const base =
    "id, order_number, status, completed_at, order_name, tab_name, payment_method, payment_cash_amount, payment_card_amount, payment_voucher_amount, subtotal, tier_discount, monthly_discount, redemption_discount, daily_perk_discount, tax, tip, total, employee:employees!orders_employee_id_fkey(name), member:members(name), items:order_items(name, quantity, unit_price, modifiers, screening_id)";
  const recent = (columns: string) =>
    createAdminClient().from("orders").select(columns).in("status", ["completed", "refunded", "voided"]).not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(limit);
  // The card that paid and how the member got on the sale (migration
  // 20261001220000); without it, the list as it was.
  let { data, error } = await recent(`${base}, member_source, card:card_payments(brand, last4, wallet)`);
  if (schemaMissing(error)) ({ data, error } = await recent(base));
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
    daily_perk_discount?: number | null;
    tier_discount: number;
    monthly_discount: number;
    redemption_discount: number;
    tax: number;
    tip: number;
    total: number;
    member_source?: string | null;
    card?: CardParts | CardParts[] | null;
    employee: { name: string } | null;
    member: { name: string } | null;
    items: { name: string; quantity: number; unit_price: number; modifiers: string[] | null; screening_id: string | null }[];
  };
  return ((data ?? []) as unknown as Row[]).map((o) => {
    const card = Array.isArray(o.card) ? (o.card[0] ?? null) : (o.card ?? null);
    return {
      id: o.id,
      orderNumber: Number(o.order_number),
      status: o.status,
      at: o.completed_at,
      name: o.tab_name || o.order_name || null,
      cashier: o.employee?.name ?? null,
      member: o.member?.name ?? null,
      memberByCard: !!o.member_source && !!o.member,
      cardLabel: card ? cardLabel(card) : null,
      method: o.payment_method,
      cash: Number(o.payment_cash_amount ?? 0),
      card: Number(o.payment_card_amount ?? 0),
      voucher: Number(o.payment_voucher_amount ?? 0),
      subtotal: Number(o.subtotal),
      discounts: [
        { label: DAILY_COFFEE_LINE, amount: Number(o.daily_perk_discount ?? 0) },
        { label: "Member discount", amount: Number(o.tier_discount) },
        { label: "Monthly member discount", amount: Number(o.monthly_discount) },
        { label: "Points reward", amount: Number(o.redemption_discount) },
      ].filter((d) => d.amount > 0),
      tax: Number(o.tax),
      tip: Number(o.tip),
      total: Number(o.total),
      lines: o.items.map((i) => ({ name: i.name, qty: i.quantity, unit: Number(i.unit_price), mods: i.modifiers ?? [], screeningId: i.screening_id })),
    };
  });
}

type CardParts = { brand: string | null; last4: string | null; wallet: string | null };

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
