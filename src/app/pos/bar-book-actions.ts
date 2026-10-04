"use server";

import { assertStaff } from "@/lib/auth";
import { getBarBookData } from "@/lib/data/barBook";
import type { BookRecipe, BookStock } from "@/lib/bar/book";

export type BarBookLoad = { ok: true; recipes: BookRecipe[]; stock: BookStock[] } | { ok: false; notReady: boolean };

// The Bar Book on the register: every recipe and what the bar has right now
// (carried, Ran out, the latest counts). Read when the Bar tab first shows
// and again each time the book opens, so "can we make it?" is current.
// notReady: the Bar Book migration isn't applied yet, so the book stays
// hidden and the Bar tab works as before.
export async function loadBarBook(): Promise<BarBookLoad> {
  await assertStaff();
  try {
    const data = await getBarBookData();
    if (!data) return { ok: false, notReady: true };
    return { ok: true, recipes: data.recipes, stock: data.stock };
  } catch (e) {
    console.error("bar book: couldn't load", e);
    return { ok: false, notReady: false };
  }
}
