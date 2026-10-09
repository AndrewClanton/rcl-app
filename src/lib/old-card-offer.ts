import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getQuickStripe } from "@/lib/stripe";
import { sealApproval } from "@/lib/approval-token";
import { firstName, isRegisterPayment } from "@/lib/card-match";
import { fortisBrand, fortisBrandName, monthShort, pastPurchasePoints, pickOldCard, withinLine, type OldCardOffer } from "@/lib/fortis-claim";

// "Old card on file?" at the register (pos/OldCardPrompt.tsx). After a card
// sale with a member attached is saved, the register asks (a plain POST to
// api/pos/old-card, not a Server Action, so it never queues ahead of the
// next sale) whether the card that paid is one from the old register
// (Fortis) that nobody has claimed. The card details come from Stripe, read
// here from the sale's own payment: the register sends only the payment id.
//
// A match: same last 4 and brand, the name on today's card fitting the old
// card's when both have one, and exactly one such card. The offer shows the
// card's last 4, visit count and date range, and the attached member's first
// name: never the name on the old card. Claim and Not theirs
// (pos/old-card-actions.ts) need the token that comes with it: this sign-in,
// for 5 minutes.
//
// Nothing here logs card digits, names or amounts.

export const OFFER_MS = 5 * 60 * 1000;
const RECENT_MS = 10 * 60 * 1000;

export const oldCardScope = (orderId: string, cardId: string) => `fortis-claim:${orderId}:${cardId}`;

export async function findOldCard(paymentIntentId: string, staffEmployeeId: string): Promise<OldCardOffer | null> {
  try {
    if (typeof paymentIntentId !== "string" || !/^pi_[A-Za-z0-9]{6,80}$/.test(paymentIntentId)) return null;
    const db = createAdminClient();
    const { data: orders } = await db
      .from("orders")
      .select("id, order_number, member_id, member_source, status, completed_at, payment_card_amount")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .eq("status", "completed")
      .limit(1);
    const order = orders?.[0];
    // Only a member staff attached: one the card found may not be the payer.
    if (!order?.member_id || order.member_source || !order.completed_at) return null;
    if (Date.now() - Date.parse(order.completed_at) > RECENT_MS) return null;
    const { data: member } = await db.from("members").select("id, name").eq("id", order.member_id).is("erased_at", null).maybeSingle();
    if (!member) return null;

    const pi = await getQuickStripe().paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
    if (!isRegisterPayment(pi, order.payment_card_amount)) return null;
    const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    const cp = charge?.payment_method_details?.type === "card_present" ? charge.payment_method_details.card_present : null;
    const last4 = cp?.last4 && /^[0-9]{4}$/.test(cp.last4) ? cp.last4 : null;
    const brand = fortisBrand(cp?.brand);
    if (!cp || !last4 || !brand) return null;

    const { data: cards } = await db
      .from("fortis_cards")
      .select("id, last_four, brand, name_keys, name_fulls, visit_dates, first_purchase_at, last_purchase_at, net_total")
      .eq("last_four", last4)
      .eq("brand", brand)
      .in("match_status", ["unclaimed", "needs_pick"])
      .neq("decision", "skipped")
      .is("granted_at", null)
      .is("erased_at", null)
      .limit(20);
    if (!cards?.length) return null;
    const { data: rejected } = await db
      .from("fortis_card_rejections")
      .select("card_id")
      .eq("member_id", member.id)
      .in(
        "card_id",
        cards.map((c) => c.id),
      );
    const no = new Set((rejected ?? []).map((r) => r.card_id));
    const card = pickOldCard(
      cards.filter((c) => !no.has(c.id)),
      cp.cardholder_name ?? null,
    );
    if (!card) return null;

    const { data: grants } = await db.from("fortis_backfill_grants").select("points").eq("member_id", member.id);
    const already = (grants ?? []).reduce((s, g) => s + Number(g.points), 0);
    const points = pastPurchasePoints(Number(card.net_total));
    const token = sealApproval(oldCardScope(order.id, card.id), staffEmployeeId, null, OFFER_MS);
    if (!token) return null;
    return {
      token,
      ttlMs: OFFER_MS,
      orderId: order.id,
      orderNumber: Number(order.order_number),
      cardId: card.id,
      lastFour: card.last_four,
      brand: fortisBrandName(card.brand),
      visits: (card.visit_dates ?? []).length,
      since: monthShort(card.first_purchase_at),
      until: monthShort(card.last_purchase_at),
      points,
      needsApproval: !withinLine(points, already),
      firstName: firstName(member.name),
    };
  } catch (e) {
    // No details: an error here could carry the card.
    console.error("old card lookup failed", e instanceof Error ? e.name : "error");
    return null;
  }
}
