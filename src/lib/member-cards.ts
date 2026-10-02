import "server-only";
import type Stripe from "stripe";
import { getQuickStripe, getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sealApproval } from "@/lib/approval-token";
import { businessDay } from "@/lib/ops/time";
import { sameEmail } from "@/lib/email-match";
import { currentMemberId } from "@/lib/member-forward";
import { memberLabel } from "@/lib/member-name";
import { pointsEarned } from "@/lib/register-totals";
import {
  CARD_UNDO_MS,
  bookingCreditNote,
  cardFromCharge,
  cardLabel,
  cardOwners,
  decideCardOutcome,
  firstName,
  isRegisterPayment,
  saleCreditNote,
  shortName,
  type AttachedMember,
  type CardLinkRow,
  type CardNotice,
  type CreditHow,
  type NoticeCandidate,
  type SaleCard,
} from "@/lib/card-match";

// Card-linked points, the server side (the rules are in lib/card-match.ts).
// The card always comes from Stripe, read by the server from a payment it
// already has: a register never sends card details, and nothing here
// takes a fingerprint from a browser. Needs migration 20261001220000.

type Db = ReturnType<typeof createAdminClient>;

// ---------- reading the card from Stripe ----------

// What a register payment's Stripe read gives: the card, and what's needed
// to check it's the sale's own payment (isRegisterPayment).
export interface RegisterCardRead {
  card: SaleCard;
  pi: { status: string; metadata: Record<string, string>; amount_received: number };
}

// The card on a register payment: one quick Stripe read (a few seconds at
// most, no retries). Started as soon as the sale comes in, so it's usually
// back by the time the sale is saved. Never throws: null when the payment
// didn't go through, was refunded, or wasn't a card Stripe fingerprints.
export async function readRegisterCard(paymentIntentId: string): Promise<RegisterCardRead | null> {
  try {
    const pi = await getQuickStripe().paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
    const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    if (pi.status !== "succeeded" || !charge || charge.refunded) return null;
    const card = cardFromCharge(charge);
    return card ? { card, pi: { status: pi.status, metadata: pi.metadata ?? {}, amount_received: pi.amount_received } } : null;
  } catch (e) {
    console.error("card read failed", paymentIntentId, e instanceof Error ? e.message : e);
    return null;
  }
}

// The card an online payment was made with (the webhook, which has time).
async function cardForPaymentIntent(paymentIntentId: string): Promise<SaleCard | null> {
  const pi = await getStripe().paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  if (pi.status !== "succeeded") return null;
  const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
  if (!charge || charge.refunded) return null;
  return cardFromCharge(charge);
}

function cardFromPaymentMethod(pm: Stripe.PaymentMethod | null): SaleCard | null {
  if (!pm?.card) return null;
  return cardFromCharge({ livemode: pm.livemode, payment_method_details: { type: "card", card: pm.card } });
}

// ---------- who has a card ----------

// Every link to this card, removed or not, with what matters about each
// member. (Two reads: member_cards has no foreign key to members, so a
// merge isn't blocked by it; see the migration.)
export async function loadCardLinks(db: Db, fingerprint: string): Promise<CardLinkRow[]> {
  const { data, error } = await db.from("member_cards").select("member_id, livemode, removed_at, linked_order_id").eq("fingerprint", fingerprint);
  if (error) throw error;
  const links = (data ?? []) as { member_id: string; livemode: boolean; removed_at: string | null; linked_order_id: string | null }[];
  const ids = [...new Set(links.map((r) => r.member_id))];
  const members = new Map<string, { erased_at: string | null; link_cards: boolean | null }>();
  if (ids.length) {
    const { data: rows, error: membersErr } = await db.from("members").select("id, erased_at, link_cards").in("id", ids);
    if (membersErr) throw membersErr;
    for (const m of rows ?? []) members.set(m.id as string, { erased_at: m.erased_at ?? null, link_cards: m.link_cards ?? null });
  }
  return links.map((r) => {
    const m = members.get(r.member_id) ?? null;
    return {
      memberId: r.member_id,
      livemode: r.livemode,
      removed: !!r.removed_at,
      // A link whose member is gone counts as no one's.
      memberErased: !m || !!m.erased_at,
      memberLinksCards: m?.link_cards !== false,
      linkedOrderId: r.linked_order_id,
    };
  });
}

// Whether this member can be given a sale by this card: they own it now.
export async function isCardOwner(db: Db, card: SaleCard, memberId: string): Promise<boolean> {
  return cardOwners(card, await loadCardLinks(db, card.fingerprint)).includes(memberId);
}

// How many different business days (4 a.m. to 4 a.m. Central) these sales
// were on. Only completed sales with the member attached by staff count,
// not ones the card itself put them on.
export function attachedDays(sales: { status: string; member_source: string | null; completed_at: string | null }[]): number {
  const days = new Set<string>();
  for (const s of sales) {
    if (s.status !== "completed" || s.member_source || !s.completed_at) continue;
    const at = new Date(s.completed_at);
    if (!Number.isNaN(at.getTime())) days.add(businessDay(at).date);
  }
  return days.size;
}

async function daysWithCard(db: Db, memberId: string, card: SaleCard): Promise<number> {
  const { data, error } = await db
    .from("card_payments")
    .select("order:orders!inner(member_id, member_source, status, completed_at)")
    .eq("fingerprint", card.fingerprint)
    .eq("livemode", card.livemode)
    .eq("order.member_id", memberId)
    .limit(500);
  if (error) throw error;
  type Row = { order: { member_id: string; member_source: string | null; status: string; completed_at: string | null } | null };
  return attachedDays(((data ?? []) as unknown as Row[]).flatMap((r) => (r.order ? [r.order] : [])));
}

// The member on a sale, for the linking rules. isCashier is worked out
// only when it matters (staffAccount below): false here.
async function attachedMember(db: Db, memberId: string, card: SaleCard, selfPaid: boolean): Promise<(AttachedMember & { name: string; authUserId: string | null; email: string | null }) | null> {
  const [{ data: m }, { count }, days] = await Promise.all([
    db.from("members").select("name, phone, email, erased_at, link_cards, auth_user_id").eq("id", memberId).maybeSingle(),
    db.from("member_cards").select("id", { count: "exact", head: true }).eq("member_id", memberId).eq("livemode", card.livemode).is("removed_at", null),
    selfPaid ? Promise.resolve(0) : daysWithCard(db, memberId, card),
  ]);
  if (!m) return null;
  return {
    name: memberLabel(m.name, m.phone),
    authUserId: m.auth_user_id ?? null,
    email: m.email ?? null,
    erased: !!m.erased_at,
    linksCards: m.link_cards !== false,
    activeCards: count ?? 0,
    isCashier: false,
    daysWithCard: days,
    selfPaid,
  };
}

// Whether a member account is one of these staff members' own: the same
// login, or the same email address (a staff member whose member account
// was never tied to their login). staff.ids: employee ids (the cashier,
// the register's login); staff.emails: login emails already known.
export async function staffAccount(db: Db, member: { authUserId: string | null; email: string | null }, staff: { ids: (string | null)[]; emails: (string | null)[] }): Promise<boolean> {
  if (staff.emails.some((e) => sameEmail(e, member.email))) return true;
  const ids = [...new Set(staff.ids.filter((id): id is string => !!id))];
  if (!ids.length) return false;
  const { data } = await db.from("employees").select("auth_user_id").in("id", ids);
  const authIds = [...new Set((data ?? []).map((e) => e.auth_user_id as string | null).filter((id): id is string => !!id))];
  if (member.authUserId && authIds.includes(member.authUserId)) return true;
  if (!member.email) return false;
  const users = await Promise.all(authIds.map((id) => db.auth.admin.getUserById(id).then((r) => r.data.user?.email ?? null, () => null)));
  return users.some((e) => sameEmail(e, member.email));
}

// ---------- linking ----------

// Links a card to a member. A link that's already there, including one
// that was removed, is left as it is: a removed card never comes back on
// its own.
export async function linkCard(db: Db, p: { memberId: string; card: SaleCard; source: "register" | "online" | "plus" | "staff"; orderId?: string | null; bookingId?: string | null; by?: string | null }) {
  const { error } = await db.from("member_cards").upsert(
    {
      member_id: p.memberId,
      fingerprint: p.card.fingerprint,
      livemode: p.card.livemode,
      brand: p.card.brand,
      last4: p.card.last4,
      wallet: p.card.wallet,
      source: p.source,
      linked_order_id: p.orderId ?? null,
      linked_booking_id: p.bookingId ?? null,
      linked_by: p.by ?? null,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "member_id,fingerprint,livemode", ignoreDuplicates: true },
  );
  if (error) throw error;
}

// A linked card was used: when, and its label (a link whose label was
// deleted gets it back from the card that just paid).
async function markUsed(db: Db, memberId: string, card: SaleCard) {
  await db
    .from("member_cards")
    .update({ last_used_at: new Date().toISOString(), brand: card.brand, last4: card.last4, wallet: card.wallet })
    .eq("member_id", memberId)
    .eq("fingerprint", card.fingerprint)
    .eq("livemode", card.livemode)
    .is("removed_at", null);
}

// ---------- register sales ----------

export const cardSaleScope = (orderId: string) => `card-sale:${orderId}`;

// The buttons on a sale's card notice work for CARD_UNDO_MS after the sale,
// and only for the register login that saved it: the token is handed back
// to that register alone, and signed so it can't be made up
// (lib/approval-token.ts).
export function noticeTiming(orderId: string, completedAt: string | null, staffEmployeeId: string, now = Date.now()): { token: string | null; ttlMs: number | null } {
  const at = completedAt ? Date.parse(completedAt) : NaN;
  const until = Number.isFinite(at) ? at + CARD_UNDO_MS : NaN;
  if (!Number.isFinite(until) || until <= now) return { token: null, ttlMs: null };
  const ttlMs = Math.min(until - now, CARD_UNDO_MS);
  const token = sealApproval(cardSaleScope(orderId), staffEmployeeId, null, ttlMs, now);
  return token ? { token, ttlMs } : { token: null, ttlMs: null };
}

export type SaleOrder = {
  id: string;
  order_number: number;
  status: string;
  employee_id: string | null;
  member_id: string | null;
  member_source: string | null;
  subtotal: number;
  tier_discount: number;
  monthly_discount: number;
  redemption_discount: number;
  completed_at: string | null;
  payment_card_amount: number | null;
  stripe_payment_intent_id: string | null;
};

export type SalePayment = {
  id: string;
  fingerprint: string;
  livemode: boolean;
  brand: string | null;
  last4: string | null;
  wallet: string | null;
  credited_member_id: string | null;
  credited_how: CreditHow | null;
  undone_at: string | null;
};

const SALE_ORDER =
  "id, order_number, status, employee_id, member_id, member_source, subtotal, tier_discount, monthly_discount, redemption_discount, completed_at, payment_card_amount, stripe_payment_intent_id";

// The points a sale earns, as completeOrder pays them and credit_card_sale
// gives them (pointsEarned: 1 per $1 after the member, monthly and reward
// discounts, before tax and tip).
export function salePoints(o: Pick<SaleOrder, "subtotal" | "tier_discount" | "monthly_discount" | "redemption_discount">): number {
  return pointsEarned({
    subtotal: Number(o.subtotal),
    tier_discount: Number(o.tier_discount ?? 0),
    monthly_discount: Number(o.monthly_discount ?? 0),
    redemption_discount: Number(o.redemption_discount ?? 0),
  });
}

const SALE_PAYMENT = "id, fingerprint, livemode, brand, last4, wallet, credited_member_id, credited_how, undone_at";

// A register sale and the card that paid it (null until it's been read).
export async function loadSaleOrder(db: Db, orderId: string): Promise<{ order: SaleOrder; payment: SalePayment | null } | null> {
  const [{ data: order }, { data: payment }] = await Promise.all([
    db.from("orders").select(SALE_ORDER).eq("id", orderId).maybeSingle(),
    db.from("card_payments").select(SALE_PAYMENT).eq("order_id", orderId).maybeSingle(),
  ]);
  return order ? { order: order as SaleOrder, payment: (payment as SalePayment | null) ?? null } : null;
}

export function storedCard(p: SalePayment): SaleCard {
  return { fingerprint: p.fingerprint, livemode: p.livemode, brand: p.brand, last4: p.last4, wallet: p.wallet };
}

// The sale's points to the card's member (credit_card_sale: once, in one
// transaction). The points paid, or null if nothing was done.
export async function creditCardSale(db: Db, order: SaleOrder, memberId: string, how: CreditHow, by: string | null): Promise<number | null> {
  const { data, error } = await db.rpc("credit_card_sale", {
    p_order: order.id,
    p_member: memberId,
    p_how: how,
    p_note: saleCreditNote(Number(order.order_number), how),
    p_by: by,
  });
  if (error) throw error;
  return data === null || data === undefined ? null : Number(data);
}

// What a member still holds from a sale (for showing a retried save).
async function pointsHeld(db: Db, orderId: string, memberId: string): Promise<number> {
  const { data } = await db.from("points_ledger").select("delta, reason").eq("order_id", orderId).eq("member_id", memberId);
  return (data ?? []).filter((r) => ["purchase", "redeem", "refund", "adjustment"].includes(r.reason)).reduce((s, r) => s + Number(r.delta), 0);
}

// The card's members, as the register shows them: "Sarah R.", or "Guest ··
// 0199" for a phone account with no name (lib/member-name.ts).
export async function candidatesFor(db: Db, memberIds: string[]): Promise<NoticeCandidate[]> {
  if (!memberIds.length) return [];
  const { data } = await db.from("members").select("id, name, phone").in("id", memberIds).is("erased_at", null);
  return (data ?? [])
    .map((m) => ({ id: m.id as string, name: shortName(memberLabel(m.name as string | null, m.phone as string | null)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// After a card sale is saved: note which card paid, then link it to the
// member on the sale, or find the member for the sale's points. What the
// register shows about it comes back, or null for nothing to show. Safe to
// run again for the same sale (a retried save): nothing is linked or paid
// twice. mayAct: this register may use the notice's buttons (it rang the
// sale).
export async function settleSaleCard(p: {
  orderId: string;
  paymentIntentId: string;
  cardRead: Promise<RegisterCardRead | null>;
  cashierId: string | null;
  staff: { employeeId: string; email: string | null };
  mayAct: boolean;
}): Promise<CardNotice | null> {
  const db = createAdminClient();
  const sale = await loadSaleOrder(db, p.orderId);
  if (!sale) return null;
  const o = sale.order;
  if (o.status !== "completed" || o.stripe_payment_intent_id !== p.paymentIntentId) return null;

  let card: SaleCard;
  if (sale.payment) {
    card = storedCard(sale.payment);
  } else {
    // Only the sale's own payment: a register payment for the amount this
    // sale says went on the card.
    const read = await p.cardRead;
    if (!read) return null;
    if (!isRegisterPayment(read.pi, o.payment_card_amount)) {
      console.error("card not read: the payment isn't this register sale's", o.id);
      return null;
    }
    card = read.card;
    const { error } = await db
      .from("card_payments")
      .upsert(
        { order_id: o.id, fingerprint: card.fingerprint, livemode: card.livemode, brand: card.brand, last4: card.last4, wallet: card.wallet },
        { onConflict: "order_id", ignoreDuplicates: true },
      );
    if (error) throw error;
  }

  const [links, attached] = await Promise.all([loadCardLinks(db, card.fingerprint), o.member_id ? attachedMember(db, o.member_id, card, false) : Promise.resolve(null)]);
  const forMatch = { orderId: o.id, status: o.status, memberId: o.member_id, memberSource: o.member_source, undone: !!sale.payment?.undone_at };
  let decision = decideCardOutcome(forMatch, card, links, attached);
  // The cashier's own account is only worked out when it would matter.
  if (decision.kind === "link" && attached && (await staffAccount(db, attached, { ids: [p.cashierId, p.staff.employeeId], emails: [p.staff.email] }))) {
    decision = decideCardOutcome(forMatch, card, links, { ...attached, isCashier: true });
  }
  const base = { orderId: o.id, orderNumber: Number(o.order_number), label: cardLabel(card), ...(p.mayAct ? noticeTiming(o.id, o.completed_at, p.staff.employeeId) : { token: null, ttlMs: null }) };

  switch (decision.kind) {
    case "skip":
      return null;
    case "used":
      await markUsed(db, decision.memberId, card);
      return null;
    case "already_credited": {
      if (!sale.payment?.credited_how) return null;
      const { data: m } = await db.from("members").select("name").eq("id", decision.memberId).maybeSingle();
      return { ...base, kind: "matched", firstName: firstName(m?.name), points: await pointsHeld(db, o.id, decision.memberId), how: sale.payment.credited_how };
    }
    case "linked_here":
      return { ...base, kind: "linked", firstName: firstName(attached?.name) };
    case "link":
      await linkCard(db, { memberId: decision.memberId, card, source: "register", orderId: o.id, by: p.cashierId });
      return { ...base, kind: "linked", firstName: firstName(attached?.name) };
    case "attach": {
      const paid = await creditCardSale(db, o, decision.memberId, "card", p.cashierId);
      if (paid === null) return null;
      const { data: m } = await db.from("members").select("name").eq("id", decision.memberId).maybeSingle();
      return { ...base, kind: "matched", firstName: firstName(m?.name), points: paid, how: "card" };
    }
    case "choose":
      return { ...base, kind: "choose", points: salePoints(o), candidates: await candidatesFor(db, decision.memberIds) };
  }
}

// ---------- online ----------

// Tickets bought online (the Stripe webhook, once the booking is
// confirmed). Signed in: their card is linked to them. Someone who only
// typed a member's email isn't known to be them, so nothing is linked.
// Nobody on the booking: a card with one member gets them the tickets'
// points (1 per $1, as on any online booking), and only the points: the
// booking stays a guest booking, so the tickets and their door code never
// show on the member's account. Never throws: the booking is paid and
// confirmed either way.
export async function settleBookingCard(p: { bookingId: string; paymentIntentId: string | null | undefined; signedInMemberId: string | null | undefined }): Promise<void> {
  try {
    if (!p.paymentIntentId) return;
    const db = createAdminClient();
    const { data: booking } = await db.from("bookings").select("id, member_id, status, quantity, order_id").eq("id", p.bookingId).maybeSingle();
    if (!booking || booking.status !== "confirmed" || booking.order_id) return;
    const card = await cardForPaymentIntent(p.paymentIntentId);
    if (!card) return;
    const { error: saveErr } = await db
      .from("card_payments")
      .upsert(
        { booking_id: booking.id, fingerprint: card.fingerprint, livemode: card.livemode, brand: card.brand, last4: card.last4, wallet: card.wallet },
        { onConflict: "booking_id", ignoreDuplicates: true },
      );
    if (saveErr) throw saveErr;
    const { data: payment } = await db.from("card_payments").select("undone_at").eq("booking_id", booking.id).maybeSingle();
    const links = await loadCardLinks(db, card.fingerprint);
    const sale = { orderId: "", status: "completed", memberId: booking.member_id as string | null, memberSource: null, undone: !!payment?.undone_at };

    if (booking.member_id) {
      // (Or the account they were merged into since they paid.)
      if (!p.signedInMemberId || (p.signedInMemberId !== booking.member_id && (await currentMemberId(p.signedInMemberId)) !== booking.member_id)) return;
      const attached = await attachedMember(db, booking.member_id, card, true);
      const d = decideCardOutcome(sale, card, links, attached);
      if (d.kind === "link") await linkCard(db, { memberId: d.memberId, card, source: "online", bookingId: booking.id });
      else if (d.kind === "used") await markUsed(db, d.memberId, card);
      return;
    }

    const d = decideCardOutcome(sale, card, links, null);
    if (d.kind !== "attach") return;
    const { error } = await db.rpc("credit_card_booking", { p_booking: booking.id, p_member: d.memberId, p_note: bookingCreditNote(Number(booking.quantity)) });
    if (error) throw error;
  } catch (e) {
    console.error("online ticket card points failed", p.bookingId, e);
  }
}

// The card on an Insiders+ subscription, linked to its member (the
// webhook, after the checkout completes). Only when the member started the
// checkout signed in, or staff started it for them (metadata
// link_card_member, lib/plus-checkout.ts): someone who typed a member's
// email on the join form may be paying for them. Checkout usually sets the
// card as the subscription's; failing that, the customer's default card,
// or their only saved card. The member it was started for may have been
// merged into another account since (lib/member-forward.ts), as
// activatePlusFromCheckout follows too. Never throws.
export async function linkPlusCard(memberId: string | null, session: Stripe.Checkout.Session): Promise<void> {
  try {
    const startedFor = session.metadata?.link_card_member || null;
    if (!memberId || !startedFor || (startedFor !== memberId && (await currentMemberId(startedFor)) !== memberId)) return;
    const stripe = getStripe();
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    let pm: Stripe.PaymentMethod | null = null;
    if (subscriptionId) {
      const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["default_payment_method"] });
      pm = sub.default_payment_method && typeof sub.default_payment_method === "object" ? sub.default_payment_method : null;
    }
    if (!pm && customerId) {
      const customer = await stripe.customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] });
      const d = "deleted" in customer && customer.deleted ? null : (customer as Stripe.Customer).invoice_settings?.default_payment_method;
      pm = d && typeof d === "object" ? d : null;
    }
    if (!pm && customerId) {
      const saved = await stripe.customers.listPaymentMethods(customerId, { type: "card", limit: 2 });
      pm = saved.data.length === 1 ? saved.data[0] : null;
    }
    await linkCardToPlusMember(memberId, pm);
  } catch (e) {
    console.error("Insiders+ card link failed", session.id, e);
  }
}

// The card paying for a member's Insiders+, linked to them (the rules in
// lib/card-match.ts decide). Also the register's "take their card on the
// reader" for a former unlimited member (pos/legacy-plus-actions.ts): the
// member is standing there and staff know who they are.
async function linkCardToPlusMember(memberId: string, pm: Stripe.PaymentMethod | null): Promise<void> {
  const card = cardFromPaymentMethod(pm);
  if (!card) return;
  const db = createAdminClient();
  const [links, attached] = await Promise.all([loadCardLinks(db, card.fingerprint), attachedMember(db, memberId, card, true)]);
  const d = decideCardOutcome({ orderId: "", status: "completed", memberId, memberSource: null, undone: false }, card, links, attached);
  if (d.kind === "link") await linkCard(db, { memberId, card, source: "plus" });
  else if (d.kind === "used") await markUsed(db, memberId, card);
}

// The same, from the saved card's id. Never throws.
export async function linkPlusCardById(memberId: string, paymentMethodId: string): Promise<void> {
  try {
    const pm = await getStripe().paymentMethods.retrieve(paymentMethodId);
    await linkCardToPlusMember(memberId, pm);
  } catch (e) {
    console.error("Insiders+ card link failed", paymentMethodId, e);
  }
}
