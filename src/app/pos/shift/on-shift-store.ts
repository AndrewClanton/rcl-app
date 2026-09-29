"use client";

import { useSyncExternalStore } from "react";
import type { OnShift } from "@/lib/ops/shared";

// Who's on shift, and who's using this iPad ("me"), as the shift bar last
// saw it -- so the register can default the cashier to the person actually
// working instead of making them pick from a list after every reload.

type State = { onShift: OnShift[]; meEmployeeId: string | null };
const EMPTY: State = { onShift: [], meEmployeeId: null };
let state: State = EMPTY;
const listeners = new Set<() => void>();

export function publishOnShift(onShift: OnShift[], meEmployeeId: string | null) {
  if (state.meEmployeeId === meEmployeeId && state.onShift.length === onShift.length && state.onShift.every((o, i) => o.shiftId === onShift[i]?.shiftId)) return;
  state = { onShift, meEmployeeId };
  listeners.forEach((l) => l());
}

export function useOnShift(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => EMPTY,
  );
}
