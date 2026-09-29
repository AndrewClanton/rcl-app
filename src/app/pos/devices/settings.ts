"use client";

import { useSyncExternalStore } from "react";
import type { RegisterStation } from "@/lib/print/stations";

// Which register this is (the bar, or the outdoor stand), and which card
// reader and receipt printer sit next to it. That's a fact about the device,
// so it lives in this browser's storage, not the database. Everything still
// works if storage is unavailable; the choices just won't be remembered.

export interface DeviceSettings {
  station: RegisterStation; // which register: its printer, and what the kitchen ticket says
  readerId: string; // Stripe Terminal reader, e.g. tmr_... (the outdoor stand has its own)
  // "station": through the website's print queue to this station's printer
  // (Back office -> Printers). "direct": straight to printerAddress from
  // this browser, the old way, which needs the printer's certificate
  // accepted on this device.
  printVia: "direct" | "station";
  printerAddress: string; // printer's IP on the local network, e.g. 192.168.1.50
  autoPrint: boolean; // print a receipt after every sale
  drawerOnCash: boolean; // open the cash drawer when a sale takes cash
  printTickets: boolean; // print a keepsake ticket for every movie admission sold
}

const KEY = "rcl.register-devices.v1";
// The old way until someone switches: a register that was already set up
// keeps printing exactly as it did.
const DEFAULTS: DeviceSettings = { station: "bar", readerId: "", printVia: "direct", printerAddress: "", autoPrint: true, drawerOnCash: true, printTickets: true };

let cached: DeviceSettings | null = null;
const listeners = new Set<() => void>();

function read(): DeviceSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
    cached = { ...saved, station: saved.station === "outdoor" ? "outdoor" : "bar", printVia: saved.printVia === "station" ? "station" : "direct" };
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
