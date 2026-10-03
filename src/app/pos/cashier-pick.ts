"use client";

import { useSyncExternalStore } from "react";

// The cashier picked by hand on this iPad, kept in this browser so a reload
// (or the page coming back after a deploy) doesn't drop it. It remembers the
// shift line-up it was picked under (PosApp's shiftKey): once someone starts
// or ends a shift, the shift decides again. Without storage (a private
// window, say) the pick just lasts until the page reloads.

export type CashierPick = { id: string; shiftKey: string };

const KEY = "rcl.register-cashier.v1";

let cached: CashierPick | null | undefined;
const listeners = new Set<() => void>();

function read(): CashierPick | null {
  if (cached !== undefined) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<CashierPick> | null) : null;
    cached = saved && typeof saved.id === "string" && saved.id && typeof saved.shiftKey === "string" ? { id: saved.id, shiftKey: saved.shiftKey } : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function pickCashier(pick: CashierPick | null) {
  cached = pick;
  try {
    if (pick) localStorage.setItem(KEY, JSON.stringify(pick));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the pick still holds until this page is reloaded.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useCashierPick(): CashierPick | null {
  return useSyncExternalStore(subscribe, read, () => null);
}
