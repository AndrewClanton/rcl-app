"use client";

import { useSyncExternalStore } from "react";

// Printer settings belong to the device the register runs on (the printer's
// address on the local network), so they live in this browser's storage,
// not the database. Everything still works if storage is unavailable; the
// settings just won't be remembered.

export interface PrinterSettings {
  address: string; // e.g. 192.168.1.50
  autoPrint: boolean; // print a receipt after every sale
  drawerOnCash: boolean; // open the cash drawer when a sale takes cash
}

const KEY = "rcl.printer.v1";
const DEFAULTS: PrinterSettings = { address: "", autoPrint: true, drawerOnCash: true };

let cached: PrinterSettings | null = null;
const listeners = new Set<() => void>();

function read(): PrinterSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    cached = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    cached = DEFAULTS;
  }
  return cached!;
}

export function savePrinterSettings(next: Partial<PrinterSettings>) {
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

export function usePrinterSettings(): PrinterSettings {
  return useSyncExternalStore(subscribe, read, () => DEFAULTS);
}
