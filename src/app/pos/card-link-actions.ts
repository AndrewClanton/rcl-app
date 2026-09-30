"use server";

import { revalidatePath } from "next/cache";
import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { openApproval } from "@/lib/approval-token";
import { cardLabel, firstName, pointsText, type CardNotice } from "@/lib/card-match";
import { attachCardMember, cardSaleScope, isCardOwner, linkCard, loadSaleOrder, noticeTiming, storedCard } from "@/lib/member-cards";

// The buttons on a card sale's notice at the register (CardNotice.tsx):
// Undo a card match, don't link a card, pick who gets a shared card's
// points, or link a card that wasn't linked on its own (the cashier's own,
// or one already on someone else's account). Each needs the token that came
// back with the sale, so only the register that saved it can use them, and
// only for 2 minutes (lib/card-match.ts). After that, a manager undoes a
// card match from the member's page in Back office. The card is always the
// one saved on the sale; nothing here takes card details from the register.

type Result = { ok: true; message: string; notice?: CardNotice } | { ok: false; error: string };

const TOO_LATE = "The 2 minutes for this are up. A manager can undo a card match on the member's page in Back office.";

async function allowed(orderId: string, token: unknown) {
  const staff = await assertStaff();
  if (typeof orderId !== "string" || !orderId) return null;
  return openApproval(token, cardSaleScope(orderId), staff.employeeId) ? staff : null;
}

function revalidate() {
  revalidatePath("/pos");
  revalidatePath("/admin/members");
}

// "Not their card": the points come back off, the sale goes back to having
// no member, and the card isn't linked to them anymore.
export async function undoCardMatch(orderId: string, token: string): Promise<Result> {
  const staff = await allowed(orderId, token);
  if (!staff) return { ok: false, error: TOO_LATE };
  const db = createAdminClient();
  const o = await loadSaleOrder(db, orderId);
  if (!o?.member_id || o.member_source !== "card") return { ok: false, error: "That sale isn't matched by card anymore." };
  const { data: m } = await db.from("members").select("name").eq("id", o.member_id).maybeSingle();
  const { data: taken, error } = await db.rpc("undo_card_match", { p_order: orderId, p_by: staff.employeeId });
  if (error) {
    console.error("card match undo failed", orderId, error.message);
    return { ok: false, error: "Couldn't undo it. Try again." };
  }
  if (taken === null) return { ok: false, error: "That sale isn't matched by card anymore." };
  revalidate();
  const card = storedCard(o);
  const who = firstName(m?.name);
  return {
    ok: true,
    message: `Undone: ${pointsText(Number(taken))} taken back from ${who}${card ? `, and ${cardLabel(card)} isn't linked to ${who}'s account anymore` : ""}.`,
  };
}

// "Don't link": the card this sale just linked comes off the member it was
// linked to, and won't be linked to them again on its own.
export async function unlinkSaleCard(orderId: string, token: string): Promise<Result> {
  const staff = await allowed(orderId, token);
  if (!staff) return { ok: false, error: TOO_LATE };
  const db = createAdminClient();
  const o = await loadSaleOrder(db, orderId);
  const card = o ? storedCard(o) : null;
  if (!o?.member_id || !card) return { ok: false, error: "There's no card to unlink on that sale." };
  const { error } = await db
    .from("member_cards")
    .update({ removed_at: new Date().toISOString(), removed_by: staff.employeeId })
    .eq("member_id", o.member_id)
    .eq("fingerprint", card.fingerprint)
    .eq("livemode", card.livemode)
    .eq("linked_order_id", orderId)
    .is("removed_at", null);
  if (error) return { ok: false, error: "Couldn't unlink it. Try again." };
  revalidate();
  return { ok: true, message: `${cardLabel(card)} isn't linked. The sale's points stay where they are.` };
}

// A card on more than one account: the cashier asks who's paying, and that
// member gets the sale and its points. Only someone the card is linked to.
export async function giveCardSalePoints(orderId: string, memberId: string, token: string): Promise<Result> {
  const staff = await allowed(orderId, token);
  if (!staff) return { ok: false, error: TOO_LATE };
  const db = createAdminClient();
  const o = await loadSaleOrder(db, orderId);
  const card = o ? storedCard(o) : null;
  if (!o || !card || o.status !== "completed") return { ok: false, error: "That sale can't take points now." };
  if (o.member_id) return { ok: false, error: "That sale already has a member on it." };
  if (typeof memberId !== "string" || !(await isCardOwner(db, card, memberId))) return { ok: false, error: "That card isn't linked to them." };
  const paid = await attachCardMember(db, o, card, memberId, o.employee_id ?? staff.employeeId).catch(() => null);
  if (paid === null) return { ok: false, error: "Couldn't give the points. The sale may already have them." };
  const { data: m } = await db.from("members").select("name").eq("id", memberId).maybeSingle();
  revalidate();
  const notice: CardNotice = {
    kind: "matched",
    orderId,
    orderNumber: Number(o.order_number),
    label: cardLabel(card),
    firstName: firstName(m?.name),
    points: paid,
    ...noticeTiming(orderId, o.completed_at, staff.employeeId),
  };
  return { ok: true, message: `${pointsText(paid)} to ${firstName(m?.name)}.`, notice };
}

// Linked only when the cashier says so: the cashier's own card on their own
// sale, or a card already linked to someone else (a family card, then on
// both accounts, so a sale with nobody attached asks who's paying).
export async function linkSaleCard(orderId: string, token: string): Promise<Result> {
  const staff = await allowed(orderId, token);
  if (!staff) return { ok: false, error: TOO_LATE };
  const db = createAdminClient();
  const o = await loadSaleOrder(db, orderId);
  const card = o ? storedCard(o) : null;
  if (!o?.member_id || !card || o.status !== "completed") return { ok: false, error: "There's no card to link on that sale." };
  const { data: member } = await db.from("members").select("erased_at, link_cards").eq("id", o.member_id).maybeSingle();
  if (!member || member.erased_at) return { ok: false, error: "That member's account was removed." };
  if (member.link_cards === false) return { ok: false, error: "That member turned card linking off on their account." };
  try {
    await linkCard(db, { memberId: o.member_id, card, source: "register", orderId, by: o.employee_id ?? staff.employeeId });
  } catch {
    return { ok: false, error: "Couldn't link it. Try again." };
  }
  const { data: link } = await db
    .from("member_cards")
    .select("removed_at")
    .eq("member_id", o.member_id)
    .eq("fingerprint", card.fingerprint)
    .eq("livemode", card.livemode)
    .maybeSingle();
  if (!link) return { ok: false, error: "Couldn't link it. Try again." };
  if (link.removed_at) return { ok: false, error: `${cardLabel(card)} was removed from this account before, so it isn't linked again from here.` };
  revalidate();
  return { ok: true, message: `${cardLabel(card)} is linked.` };
}
