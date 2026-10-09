"use server";

import { revalidatePath } from "next/cache";
import { assertManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { giftCardsMissing } from "@/lib/gift-cards-server";

export type AdjustResult = { ok: true; balance: number } | { ok: false; error: string };

// A manager's change to a card's balance (Back office -> Gift cards): add
// or take off, with a reason. adjust_gift_card locks the card, never lets
// it go below zero, and records who, how much and why in the card's history.
export async function adjustGiftCard(cardId: string, deltaIn: number, reasonIn: string): Promise<AdjustResult> {
  const staff = await assertManager();
  const delta = Math.round(Number(deltaIn) * 100) / 100;
  const reason = String(reasonIn ?? "").trim().slice(0, 200);
  if (!/^[0-9a-f-]{36}$/i.test(cardId)) return { ok: false, error: "That card wasn't found." };
  if (!Number.isFinite(delta) || delta === 0) return { ok: false, error: "Enter how much to add or take off, like 5 or -5." };
  if (reason.length < 3) return { ok: false, error: "Say why. It's kept in the card's history." };
  const { data, error } = await createAdminClient().rpc("adjust_gift_card", { p_card_id: cardId, p_delta: delta, p_reason: reason, p_employee_id: staff.employeeId });
  if (error) return { ok: false, error: giftCardsMissing(error) ? "Gift cards need their database update first." : "Couldn't change the balance. Try again." };
  const r = (data ?? {}) as { ok?: boolean; error?: string; balance?: number };
  if (!r.ok) {
    const balance = typeof r.balance === "number" ? ` It has $${Number(r.balance).toFixed(2)}.` : "";
    const why: Record<string, string> = {
      reason: "Say why. It's kept in the card's history.",
      zero: "Enter how much to add or take off.",
      not_found: "That card wasn't found.",
      void: "That card was voided, so its balance can't change.",
      below_zero: `That would take it below $0.00.${balance}`,
      too_much: `A card holds at most $1,000.${balance}`,
    };
    return { ok: false, error: why[r.error ?? ""] ?? "Couldn't change the balance." };
  }
  revalidatePath("/admin/gift-cards");
  return { ok: true, balance: Number(r.balance) };
}
