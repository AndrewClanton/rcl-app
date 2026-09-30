import "server-only";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { sealApproval } from "@/lib/approval-token";
import { applyPoints } from "@/lib/points";
import {
  CARD_UNDO_MS,
  cardFromCharge,
  cardLabel,
  cardOwners,
  decideCardOutcome,
  firstName,
  matchedByNote,
  shortName,
  type AttachedMember,
  type CardLinkRow,
  type CardNotice,
  type SaleCard,
} from "@/lib/card-match";

// Card-linked points, the server side (the rules are in lib/card-match.ts).
// The card always comes from Stripe, read by the server from a payment it
// already has: a register never sends card details, and nothing here
// takes a fingerprint from a browser. Needs migration 20261001100000.

type Db = ReturnType<typeof createAdminClient>;

// The card a payment was made with: one Stripe read. Null when the payment
// didn't go through, was refunded, or wasn't a card Stripe fingerprints.
export async function cardForPaymentIntent(paymentIntentId: string): Promise<SaleCard | null> {
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

// Every link to this card, removed or not, with what matters about each
// member.
export async function loadCardLinks(db: Db, fingerprint: string): Promise<CardLinkRow[]> {
  const { data, error } = await db
    .from("member_cards")
    .select("member_id, livemode, removed_at, linked_order_id, member:members(erased_at, link_cards)")
    .eq("fingerprint", fingerprint);
  if (error) throw error;
  type Row = { member_id: string; livemode: boolean; removed_at: string | null; linked_order_id: string | null; member: { erased_at: string | null; link_cards: boolean | null } | null };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    memberId: r.member_id,
    livemode: r.livemode,
    removed: !!r.removed_at,
    memberErased: !r.member || !!r.member.erased_at,
    memberLinksCards: r.member?.link_cards !== false,
    linkedOrderId: r.linked_order_id,
  }));
}

// The member on a sale, for the linking rules. staffIds: the cashier and
// the register's login; a member who is one of them is "the cashier".
async function attachedMember(db: Db, memberId: string, livemode: boolean, staffIds: (string | null)[]): Promise<(AttachedMember & { name: string }) | null> {
  const { data: m } = await db.from("members").select("name, erased_at, link_cards, auth_user_id").eq("id", memberId).maybeSingle();
  if (!m) return null;
  const { count } = await db.from("member_cards").select("id", { count: "exact", head: true }).eq("member_id", memberId).eq("livemode", livemode).is("removed_at", null);
  const ids = [...new Set(staffIds.filter((id): id is string => !!id))];
  let isCashier = false;
  if (m.auth_user_id && ids.length) {
    const { data: staff } = await db.from("employees").select("auth_user_id").in("id", ids);
    isCashier = (staff ?? []).some((s) => s.auth_user_id === m.auth_user_id);
  }
  return { name: m.name, erased: !!m.erased_at, linksCards: m.link_cards !== false, activeCards: count ?? 0, isCashier };
}

// Links a card to a member. A link that's already there, including one
// that was removed, is left as it is: a removed card never comes back on
// its own.
export async function linkCard(db: Db, p: { memberId: string; card: SaleCard; source: "register" | "online" | "plus"; orderId?: string | null; bookingId?: string | null; by?: string | null }) {
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

async function markUsed(db: Db, memberId: string, card: SaleCard) {
  await db
    .from("member_cards")
    .update({ last_used_at: new Date().toISOString() })
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

type SaleOrder = {
  id: string;
  order_number: number;
  status: string;
  employee_id: string | null;
  member_id: string | null;
  member_source: string | null;
  subtotal: number;
  completed_at: string | null;
  stripe_payment_intent_id: string | null;
  card_fingerprint: string | null;
  card_livemode: boolean | null;
  card_brand: string | null;
  card_last4: string | null;
  card_wallet: string | null;
};

const SALE_ORDER = "id, order_number, status, employee_id, member_id, member_source, subtotal, completed_at, stripe_payment_intent_id, card_fingerprint, card_livemode, card_brand, card_last4, card_wallet";

export async function loadSaleOrder(db: Db, orderId: string): Promise<SaleOrder | null> {
  const { data } = await db.from("orders").select(SALE_ORDER).eq("id", orderId).maybeSingle();
  return (data as SaleOrder | null) ?? null;
}

// The card saved on a sale, if there is one.
export function storedCard(o: SaleOrder): SaleCard | null {
  if (!o.card_fingerprint || o.card_livemode === null) return null;
  return { fingerprint: o.card_fingerprint, livemode: o.card_livemode, brand: o.card_brand, last4: o.card_last4, wallet: o.card_wallet };
}

// Pays a card-matched sale to its member (attach_card_member: once, in one
// transaction). The points paid, or null if nothing was done.
export async function attachCardMember(db: Db, o: SaleOrder, card: SaleCard, memberId: string, by: string | null): Promise<number | null> {
  const { data, error } = await db.rpc("attach_card_member", {
    p_order: o.id,
    p_member: memberId,
    p_note: `Order #${o.order_number} (${matchedByNote(card)})`,
    p_by: by,
  });
  if (error) throw error;
  return data === null || data === undefined ? null : Number(data);
}

async function pointsFromSale(db: Db, orderId: string, memberId: string): Promise<number> {
  const { data } = await db.from("points_ledger").select("delta").eq("order_id", orderId).eq("member_id", memberId).eq("reason", "purchase");
  return (data ?? []).reduce((s, r) => s + Number(r.delta), 0);
}

// After a card sale is saved: note which card paid, then link it to the
// member on the sale, or find the sale's member by it. What the register
// shows about it comes back, or null for nothing to show. Safe to run
// again for the same sale (a retried save): nothing is linked or paid twice.
export async function settleSaleCard(p: { orderId: string; paymentIntentId: string; cashierId: string | null; staffEmployeeId: string }): Promise<CardNotice | null> {
  const db = createAdminClient();
  const o = await loadSaleOrder(db, p.orderId);
  if (!o || o.status !== "completed" || o.stripe_payment_intent_id !== p.paymentIntentId) return null;

  let card = storedCard(o);
  if (!card) {
    card = await cardForPaymentIntent(p.paymentIntentId);
    if (!card) return null;
    await db
      .from("orders")
      .update({ card_fingerprint: card.fingerprint, card_livemode: card.livemode, card_brand: card.brand, card_last4: card.last4, card_wallet: card.wallet })
      .eq("id", o.id)
      .is("card_fingerprint", null);
  }

  const links = await loadCardLinks(db, card.fingerprint);
  const attached = o.member_id ? await attachedMember(db, o.member_id, card.livemode, [p.cashierId, p.staffEmployeeId]) : null;
  const decision = decideCardOutcome({ orderId: o.id, status: o.status, memberId: o.member_id, memberSource: o.member_source }, card, links, attached);
  const base = { orderId: o.id, orderNumber: Number(o.order_number), label: cardLabel(card), ...noticeTiming(o.id, o.completed_at, p.staffEmployeeId) };

  switch (decision.kind) {
    case "skip":
      return null;
    case "used":
      await markUsed(db, decision.memberId, card);
      return null;
    case "already_matched": {
      const { data: m } = await db.from("members").select("name").eq("id", decision.memberId).maybeSingle();
      return { ...base, kind: "matched", firstName: firstName(m?.name), points: await pointsFromSale(db, o.id, decision.memberId) };
    }
    case "linked_here":
      return { ...base, kind: "linked", firstName: firstName(attached?.name) };
    case "link":
      await linkCard(db, { memberId: decision.memberId, card, source: "register", orderId: o.id, by: p.cashierId });
      return { ...base, kind: "linked", firstName: firstName(attached?.name) };
    case "offer_self":
      return { ...base, kind: "self", firstName: firstName(attached?.name) };
    case "offer_shared": {
      const { data: ms } = await db.from("members").select("name").in("id", decision.ownerIds);
      const ownerNames = (ms ?? []).map((m) => shortName(m.name)).sort();
      return { ...base, kind: "shared", firstName: firstName(attached?.name), ownerNames };
    }
    case "attach": {
      const paid = await attachCardMember(db, o, card, decision.memberId, p.cashierId);
      if (paid === null) return null;
      const { data: m } = await db.from("members").select("name").eq("id", decision.memberId).maybeSingle();
      return { ...base, kind: "matched", firstName: firstName(m?.name), points: paid };
    }
    case "choose": {
      const { data: ms } = await db.from("members").select("id, name").in("id", decision.memberIds);
      const candidates = (ms ?? []).map((m) => ({ id: m.id as string, name: shortName(m.name) })).sort((a, b) => a.name.localeCompare(b.name));
      return { ...base, kind: "choose", points: Number(o.subtotal), candidates };
    }
  }
}

// Whether this member can be given this sale by its card: they own it now.
export async function isCardOwner(db: Db, card: SaleCard, memberId: string): Promise<boolean> {
  return cardOwners(card, await loadCardLinks(db, card.fingerprint)).includes(memberId);
}

// ---------- online ----------

// Tickets bought online (the Stripe webhook, once the booking is
// confirmed). Signed in: their card is linked to them. Someone who only
// typed a member's email isn't known to be them, so nothing is linked.
// Nobody on the booking: a card with one member finds them, and they get
// the ticket points (1 per $1, as on any online booking). Never throws:
// the booking is paid and confirmed either way.
export async function settleBookingCard(p: { bookingId: string; paymentIntentId: string | null | undefined; signedInMemberId: string | null | undefined }): Promise<void> {
  try {
    if (!p.paymentIntentId) return;
    const db = createAdminClient();
    const { data: booking } = await db.from("bookings").select("id, member_id, status, quantity, unit_price, order_id").eq("id", p.bookingId).maybeSingle();
    if (!booking || booking.status !== "confirmed" || booking.order_id) return;
    const card = await cardForPaymentIntent(p.paymentIntentId);
    if (!card) return;
    const links = await loadCardLinks(db, card.fingerprint);
    const sale = { orderId: "", status: "completed", memberId: booking.member_id as string | null, memberSource: null };

    if (booking.member_id) {
      if (!p.signedInMemberId || p.signedInMemberId !== booking.member_id) return;
      const attached = await attachedMember(db, booking.member_id, card.livemode, []);
      const d = decideCardOutcome(sale, card, links, attached);
      if (d.kind === "link") await linkCard(db, { memberId: d.memberId, card, source: "online", bookingId: booking.id });
      else if (d.kind === "used") await markUsed(db, d.memberId, card);
      return;
    }

    const d = decideCardOutcome(sale, card, links, null);
    if (d.kind !== "attach") return;
    const { data: claimed } = await db.from("bookings").update({ member_id: d.memberId }).eq("id", booking.id).is("member_id", null).select("id");
    if (!claimed?.length) return;
    const q = Number(booking.quantity);
    await applyPoints({
      memberId: d.memberId,
      delta: Number(booking.unit_price) * q,
      reason: "purchase",
      bookingId: booking.id,
      note: `${q} ticket${q === 1 ? "" : "s"}, bought online (${matchedByNote(card)})`,
    });
    await markUsed(db, d.memberId, card);
  } catch (e) {
    console.error("online ticket card points failed", p.bookingId, e);
  }
}

// The card on an Insiders+ subscription, linked to its member (the
// webhook, after the checkout completes). Checkout usually sets it as the
// subscription's card; failing that, the customer's default card, or
// their only saved card. Never throws.
export async function linkPlusCard(memberId: string | null, session: Stripe.Checkout.Session): Promise<void> {
  try {
    if (!memberId) return;
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
    const card = cardFromPaymentMethod(pm);
    if (!card) return;
    const db = createAdminClient();
    const links = await loadCardLinks(db, card.fingerprint);
    const attached = await attachedMember(db, memberId, card.livemode, []);
    const d = decideCardOutcome({ orderId: "", status: "completed", memberId, memberSource: null }, card, links, attached);
    if (d.kind === "link") await linkCard(db, { memberId, card, source: "plus" });
  } catch (e) {
    console.error("Insiders+ card link failed", session.id, e);
  }
}
