"use server";

import { assertStaff } from "@/lib/auth";
import { getBarBookData } from "@/lib/data/barBook";
import { checkManagerPin } from "@/lib/manager-pin";
import type { ApprovalResult } from "@/lib/pin-rules";
import type { BookRecipe, BookStock } from "@/lib/bar/book";

export type BarBookLoad = { ok: true; recipes: BookRecipe[]; stock: BookStock[]; target: number } | { ok: false; notReady: boolean };

// The Bar Book on the register: every recipe and what the bar has right now
// (carried, Ran out, the latest counts, what each ingredient costs), and the
// target pour cost for suggested prices. Read when the Bar tab first shows
// and again each time the book opens, so "can we make it?" is current.
// notReady: the Bar Book migration isn't applied yet, so the book stays
// hidden and the Bar tab works as before.
export async function loadBarBook(): Promise<BarBookLoad> {
  await assertStaff();
  try {
    const data = await getBarBookData();
    if (!data) return { ok: false, notReady: true };
    return { ok: true, recipes: data.recipes, stock: data.stock, target: data.target };
  } catch (e) {
    console.error("bar book: couldn't load", e);
    return { ok: false, notReady: false };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A Bar Book drink rung up for less than its ingredients cost needs a
// manager's PIN, the register's usual approval (src/lib/manager-pin.ts:
// lockout after wrong tries, and the PIN log records who and for which
// recipe). The sale itself is checked again on the server, which flags a
// below-cost book drink for Reports → Register checks either way.
// recipeId: the Bar Book drink, or "custom" for a drink from "What's in it?".
export async function approveBelowCost(pin: string, recipeId: string): Promise<ApprovalResult> {
  const staff = await assertStaff();
  if (typeof recipeId !== "string" || !(UUID.test(recipeId) || recipeId === "custom")) return { ok: false, error: "That drink isn't in the book anymore. Close the book and open it again." };
  const approval = await checkManagerPin(pin, "below-cost-drink", staff.employeeId, recipeId.toLowerCase());
  if (!approval.ok) return approval;
  return { ok: true, approvedBy: approval.approvedBy, defaultPin: approval.defaultPin };
}
