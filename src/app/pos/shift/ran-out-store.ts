"use client";

import { useSyncExternalStore } from "react";
import type { RegisterOut } from "@/lib/ops/shared";

// "Ran out" between the shift bar and the register, which sit side by side
// on the page. The shift bar polls the server each minute and publishes
// what's 86'd; the menu grid greys those items out. The register publishes
// its cashier, so a report from the shift bar says who made it, and asks
// the shift bar to refresh after putting an item back on sale.

type State = { loaded: boolean; outs: RegisterOut[]; cashierId: string | null };
const EMPTY: State = { loaded: false, outs: [], cashierId: null };
let state: State = EMPTY;
const listeners = new Set<() => void>();
let refresher: (() => void) | null = null;

function emit(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

const key = (outs: RegisterOut[]) => outs.map((o) => `${o.itemId}:${o.outageId}:${o.reason}:${o.what}`).sort().join("|");

export function publishOuts(outs: RegisterOut[]) {
  if (state.loaded && key(state.outs) === key(outs)) return;
  emit({ ...state, loaded: true, outs });
}

// Right away on this register, before the next poll confirms it.
export function dropOut(itemId: string) {
  emit({ ...state, outs: state.outs.filter((o) => o.itemId !== itemId) });
}

export function publishCashier(employeeId: string | null) {
  if (state.cashierId === employeeId) return;
  emit({ ...state, cashierId: employeeId });
}

export function setOutsRefresher(fn: () => void) {
  refresher = fn;
  return () => {
    if (refresher === fn) refresher = null;
  };
}

export function refreshOuts() {
  refresher?.();
}

export function useRanOut(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => EMPTY,
  );
}
