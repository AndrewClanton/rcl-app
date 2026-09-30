"use server";

import { revalidatePath } from "next/cache";
import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { openApproval } from "@/lib/approval-token";
import { cardLabel, cardOwners, firstName, pointsText, type CardNotice } from "@/lib/card-match";
import { candidatesFor, cardSaleScope, creditCardSale, isCardOwner, loadCardLinks, loadSaleOrder, noticeTiming, staffAccount, storedCard } from "@/lib/member-cards";

// The buttons on a card sale's notice at the register (CardNotice.tsx):
// Undo a card match (someone else paid, or it isn't their card at all),
// give an undone sale's points to the right member, don't link a card, or
// pick who gets a shared card's points. Each needs the token that came back
// with the sale, so only the register that saved it can use them, and only
// for 2 minutes (lib/card-match.ts). After that, a manager undoes a card
// match from the member's page in Back office. The card is always the one
// saved with the sale; nothing here takes card details from the register.
// Linking a card by hand (the cashier's own, or one already on someone
// else's account) isn't here: a manager does that in Back office.

type Result = { ok: true; message: string; notice?: CardNotice } | { ok: false; error: string };

const TOO_LATE = "The 2 minutes for this are up. A manager can undo a card match on the member's page in Back office.";

async function allowed(orderId: unknown, token: unknown) {
  const staff = await assertStaff();
  if (typeof orderId !== "string" || !orderId) return null;
  return openApproval(token, cardSaleScope(orderId), staff.employeeId) ? staff : null;
}

function revalidate() {
  revalidatePath("/pos");
  revalidatePath("/admin/members");
}

// Undo: the points come back off the member, and the sale goes back to
// having no member. unlink: it isn't their card at all, so it comes off
// their account too (only for a match the card made on its own; a
// cashier's pick of a shared card never unlinks anyone). Then the register
// offers to give the points to the right member.
export async function undoCardMatch(orderId: string, token: string, unlink: boolean): Promise<Result> {
  const staff = await allowed(orderId, token);
  if (!staff) return { ok: false, error: TOO_LATE };
  const db = createAdminClient();
  const sale = await loadSaleOrder(db, orderId);
  const memberId = sale?.order.member_id;
  if (!sale?.payment || !memberId || sale.order.member_source !== "card") return { ok: false, error: "That sale isn't matched by card anymore." };
  const doUnlink = unlink === true && sale.payment.credited_how === "card";
  const { data: m } = await db.from("members").select("name").eq("id", memberId).maybeSingle();
  const { data: taken, error } = await db.rpc("undo_card_sale", { p_order: orderId, p_unlink: doUnlink, p_by: sale.order.employee_id ?? staff.employeeId });
  if (error) {
    console.error("card match undo failed", orderId, error.message);
    return { ok: false, error: "Couldn't undo it. Try again." };
  }
  if (taken === null) return { ok: false, error: "That sale isn't matched by card anymore." };
  revalidate();
  const card = storedCard(sale.payment);
  const who = firstName(m?.name);
  const others = cardOwners(card, await loadCardLinks(db, card.fingerprint)).filter((id) => id !== memberId);
  return {
    ok: true,
    message: `${pointsText(Number(taken))} taken back from ${who}.`,
    notice: {
      kind: "undone",
      orderId,
      orderNumber: Number(sale.order.order_number),
      label: cardLabel(card),
      firstName: who,
      taken: Number(taken),
      unlinked: doUnlink,
      points: Number(sale.order.subtotal),
      candidates: await candidatesFor(db, others),
      ...noticeTiming(orderId, sale.order.completed_at, staff.employeeId),
    },
  };
}

// After an Undo: the sale's points go to the right member instead (the
// card's other member, or anyone the cashier finds). Never the cashier's
// own account: a manager adds those points in Back office.
export async function giveUndoneSalePoints(orderId: string, memberId: string, token: string): Promise<Result> {
  const staff = await allowed(orderId, token);
  if (!staff) return { ok: false, error: TOO_LATE };
  const db = createAdminClient();
  const sale = await loadSaleOrder(db, orderId);
  if (!sale?.payment?.undone_at || sale.order.member_id || sale.order.status !== "completed") return { ok: false, error: "That sale's points can't be given now." };
  if (typeof memberId !== "string" || !memberId) return { ok: false, error: "Pick a member." };
  const { data: m } = await db.from("members").select("name, email, auth_user_id, erased_at").eq("id", memberId).maybeSingle();
  if (!m || m.erased_at) return { ok: false, error: "That member isn't there anymore." };
  if (await staffAccount(db, { authUserId: m.auth_user_id, email: m.email }, { ids: [sale.order.employee_id, staff.employeeId], emails: [staff.email] })) {
    return { ok: false, error: "That's a staff login's own account. A manager can add the points on their page in Back office." };
  }
  const paid = await creditCardSale(db, sale.order, memberId, "given", sale.order.employee_id ?? staff.employeeId).catch(() => null);
  if (paid === null) return { ok: false, error: "Couldn't give the points. Try again." };
  revalidate();
  return {
    ok: true,
    message: `${pointsText(paid)} to ${firstName(m.name)}.`,
    notice: {
      kind: "matched",
      orderId,
      orderNumber: Number(sale.order.order_number),
      label: cardLabel(storedCard(sale.payment)),
      firstName: firstName(m.name),
      points: paid,
      how: "given",
      ...noticeTiming(orderId, sale.order.completed_at, staff.employeeId),
    },
  };
}

// "Don't link": the card this sale just linked comes off the member it was
// linked to, and won't be linked to them again on its own.
export async function unlinkSaleCard(orderId: string, token: string): Promise<Result> {
  const staff = await allowed(orderId, token);
  if (!staff) return { ok: false, error: TOO_LATE };
  const db = createAdminClient();
  const sale = await loadSaleOrder(db, orderId);
  if (!sale?.order.member_id || !sale.payment) return { ok: false, error: "There's no card to unlink on that sale." };
  const card = storedCard(sale.payment);
  const { error } = await db
    .from("member_cards")
    .update({ removed_at: new Date().toISOString(), removed_by: sale.order.employee_id ?? staff.employeeId, brand: null, last4: null, wallet: null })
    .eq("member_id", sale.order.member_id)
    .eq("fingerprint", card.fingerprint)
    .eq("livemode", card.livemode)
    .eq("linked_order_id", orderId)
    .is("removed_at", null);
  if (error) return { ok: false, error: "Couldn't unlink it. Try again." };
  revalidate();
  return { ok: true, message: `${cardLabel(card)} isn't linked. The sale's points stay where they are.` };
}

// A card on more than one account: the cashier asks who's paying, and that
// member gets the sale's points. Only someone the card is linked to.
export async function giveCardSalePoints(orderId: string, memberId: string, token: string): Promise<Result> {
  const staff = await allowed(orderId, token);
  if (!staff) return { ok: false, error: TOO_LATE };
  const db = createAdminClient();
  const sale = await loadSaleOrder(db, orderId);
  if (!sale?.payment || sale.order.status !== "completed" || sale.payment.undone_at) return { ok: false, error: "That sale can't take points now." };
  if (sale.order.member_id) return { ok: false, error: "That sale already has a member on it." };
  const card = storedCard(sale.payment);
  if (typeof memberId !== "string" || !(await isCardOwner(db, card, memberId))) return { ok: false, error: "That card isn't linked to them." };
  const paid = await creditCardSale(db, sale.order, memberId, "picked", sale.order.employee_id ?? staff.employeeId).catch(() => null);
  if (paid === null) return { ok: false, error: "Couldn't give the points. The sale may already have them." };
  const { data: m } = await db.from("members").select("name").eq("id", memberId).maybeSingle();
  revalidate();
  return {
    ok: true,
    message: `${pointsText(paid)} to ${firstName(m?.name)}.`,
    notice: {
      kind: "matched",
      orderId,
      orderNumber: Number(sale.order.order_number),
      label: cardLabel(card),
      firstName: firstName(m?.name),
      points: paid,
      how: "picked",
      ...noticeTiming(orderId, sale.order.completed_at, staff.employeeId),
    },
  };
}
