"use server";

import { assertStaff } from "@/lib/auth";
import { normalizeGiftCode, giftRedeemError } from "@/lib/gift-cards";
import { findGiftCard } from "@/lib/gift-cards-server";

export type GiftCardCheck = { ok: true; code: string; balance: number; memberName: string | null } | { ok: false; error: string };

// The payment screen's Gift card: the code typed or scanned, its balance.
// Only a look: nothing comes off until the sale is saved (completeOrder).
export async function checkGiftCard(input: string): Promise<GiftCardCheck> {
  await assertStaff();
  const code = normalizeGiftCode(input);
  if (!code) return { ok: false, error: "That isn't a gift card code. It looks like RCL-ABCD-2345." };
  try {
    const card = await findGiftCard(code);
    if (!card) return { ok: false, error: giftRedeemError("not_found") };
    if (card.status !== "active") return { ok: false, error: giftRedeemError("void") };
    if (!(card.balance > 0)) return { ok: false, error: "That gift card has nothing left on it." };
    return { ok: true, code: card.code, balance: card.balance, memberName: card.memberName };
  } catch (e) {
    return { ok: false, error: giftRedeemError(e instanceof Error && e.message === "missing" ? "missing" : undefined) };
  }
}
