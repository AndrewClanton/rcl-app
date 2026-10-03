"use client";

import { useSyncExternalStore } from "react";
import type { ShiftStatus } from "@/lib/ops/shared";

// The register's Staff button and Booths button sit inside the register
// (PosApp), while the shift tools behind them (StaffTools) sit beside it on
// the page and poll the server each minute. StaffTools publishes what the
// buttons show here, and the buttons ask it to open its sheets.

export type StaffView = "home" | "schedule";

type State = {
  loaded: boolean;
  nobodyOn: boolean; // nobody's started a shift yet today: the button says Start shift
  badge: number; // things on the Staff sheet that need a look
  offline: boolean; // the last poll didn't reach the server
  booths: ShiftStatus["booths"] | null;
};
const EMPTY: State = { loaded: false, nobodyOn: false, badge: 0, offline: false, booths: null };
let state: State = EMPTY;
const listeners = new Set<() => void>();

type Handlers = { open: (view: StaffView) => void; startShift: () => void; refresh: () => void };
let handlers: Handlers | null = null;

export function publishStaff(next: State) {
  const same =
    state.loaded === next.loaded &&
    state.nobodyOn === next.nobodyOn &&
    state.badge === next.badge &&
    state.offline === next.offline &&
    JSON.stringify(state.booths) === JSON.stringify(next.booths);
  if (same) return;
  state = next;
  listeners.forEach((l) => l());
}

export function setStaffHandlers(h: Handlers) {
  handlers = h;
  return () => {
    if (handlers === h) handlers = null;
  };
}

export const openStaff = (view: StaffView = "home") => handlers?.open(view);
export const promptStartShift = () => handlers?.startShift();
export const refreshStaff = () => handlers?.refresh();

export function useStaff(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => EMPTY,
  );
}
