"use server";

import { getSignedInMember } from "@/lib/member-auth";
import { allowAttempt } from "@/lib/rate-limit";
import { connectionKey, TOO_MANY_FROM_CONNECTION } from "@/lib/public-form-guard";
import { finishSeatCheckout, seatCheckoutStatus, startSeatCheckout, type CheckoutStatus, type FinishResult, type StartResult } from "@/lib/seat-ordering-server";
import { isTipChoice, type CartLineInput } from "@/lib/seat-ordering";

// The phone menu's three calls (public: no login needed). The cart comes as
// ids and is priced on the server; a signed-in member's account comes from
// their session, never from the page.

export async function startSeatOrder(input: { code: string; lines: CartLineInput[]; tip: number; name?: string; quietly?: boolean }): Promise<StartResult> {
  if (!(await allowAttempt(`seat-order:${await connectionKey()}`, 12, 300))) return { ok: false, error: TOO_MANY_FROM_CONNECTION };
  const member = await getSignedInMember().catch(() => null);
  try {
    return await startSeatCheckout({
      code: String(input?.code ?? ""),
      lines: Array.isArray(input?.lines) ? input.lines : [],
      tip: isTipChoice(input?.tip) ? input.tip : 0,
      name: typeof input?.name === "string" ? input.name : null,
      note: input?.quietly ? "Deliver quietly" : null,
      memberId: member?.id ?? null,
    });
  } catch (e) {
    console.error("seat order: start failed", e);
    return { ok: false, error: "Something went wrong. Try again, or order at the box office." };
  }
}

export async function finishSeatOrder(checkoutId: string): Promise<FinishResult> {
  try {
    return await finishSeatCheckout(String(checkoutId ?? ""));
  } catch (e) {
    console.error("seat order: finish failed", checkoutId, e);
    return { ok: false, pending: true, error: "Your payment went through. We're still sending the order to the bar." };
  }
}

export async function seatOrderStatus(checkoutId: string): Promise<CheckoutStatus | null> {
  try {
    return await seatCheckoutStatus(String(checkoutId ?? ""));
  } catch {
    return null;
  }
}
