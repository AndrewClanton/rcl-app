"use client";

import { useSyncExternalStore } from "react";
import type { PosMember } from "./member-actions";

// What the register shows about the member on the order, from across the
// counter (MemberSignal.tsx):
//   plus       Insiders+ that's paid for (a live subscription, complimentary,
//              or a gifted year): gold.
//   unlimited  a former unlimited member with nothing paying for it
//              (lib/legacy-plus.ts): NOT ACTIVE, red and black, never gold,
//              so nobody takes them for an active member.
//   null       anyone else (plain Insiders, Insiders+ set by hand with no
//              card, or nobody on the order).
export type MemberSignal = "plus" | "unlimited" | null;

type SignalFields = Pick<PosMember, "tier" | "subscribed" | "comped" | "legacyUnlimited" | "plusPaid">;

export function memberSignal(m: SignalFields | null | undefined): MemberSignal {
  if (!m) return null;
  if (m.legacyUnlimited) return "unlimited";
  if (m.tier === "Insiders+" && (m.subscribed || m.comped || !!m.plusPaid)) return "plus";
  return null;
}

// The signal as PosApp last set it, for the phone header beside the
// register's title (page.tsx), which sits outside PosApp.
let current: MemberSignal = null;
const listeners = new Set<() => void>();

export function publishMemberSignal(signal: MemberSignal) {
  if (signal === current) return;
  current = signal;
  listeners.forEach((l) => l());
}

export function useMemberSignal(): MemberSignal {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}
