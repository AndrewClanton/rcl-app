"use client";

import { useSyncExternalStore } from "react";

// Which card reader and receipt printer sit next to this register. That's a
// fact about the device (the bar tablet vs. the box office), so it lives in
// this browser's storage, not the database. Everything still works if
// storage is unavailable; the choices just won't be remembered.

export interface DeviceSettings {
  readerId: string; // Stripe Terminal reader, e.g. tmr_...
  printerAddress: string; // printer's IP on the local network, e.g. 192.168.1.50
  autoPrint: boolean; // print a receipt after every sale
  drawerOnCash: boolean; // open the cash drawer when a sale takes cash
}

const KEY = "rcl.register-devices.v1";
const DEFAULTS: DeviceSettings = { readerId: "", printerAddress: "", autoPrint: true, drawerOnCash: true };

let cached: DeviceSettings | null = null;
const listeners = new Set<() => void>();

function read(): DeviceSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    cached = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    cached = DEFAULTS;
  }
  return cached!;
}

export function saveDeviceSettings(next: Partial<DeviceSettings>) {
  cached = { ...read(), ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Private mode or storage blocked: keep the in-memory copy for this visit.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useDeviceSettings(): DeviceSettings {
  return useSyncExternalStore(subscribe, read, () => DEFAULTS);
}
