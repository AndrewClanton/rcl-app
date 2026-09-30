"use client";

import { useSyncExternalStore } from "react";
import type { CompleteOrderInput } from "./actions";

// A card sale that was charged but didn't save. It's kept in this browser's
// storage as well as on screen, so a reload (the first thing anyone tries
// when something looks stuck) still shows the warning and can still retry.
// A retry sends the very same payment, and completeOrder makes one order per
// payment, so retrying can never record the sale twice.

export interface UnsavedSale {
  order: CompleteOrderInput; // exactly what completeOrder was sent, payment included
  memberName: string | null; // for the receipt
  tries: number;
  stale?: boolean; // the last try hit an out-of-date register page (not stored: a reload fixes it)
}

const KEY = "rcl.register-unsaved-sale.v1";

let cached: UnsavedSale | null | undefined;
const listeners = new Set<() => void>();

function read(): UnsavedSale | null {
  if (cached !== undefined) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as UnsavedSale) : null;
    cached = saved?.order?.payment?.stripePaymentIntentId ? saved : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function keepUnsavedSale(sale: UnsavedSale | null) {
  cached = sale;
  try {
    if (sale) localStorage.setItem(KEY, JSON.stringify({ order: sale.order, memberName: sale.memberName, tries: sale.tries }));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the warning still shows until this page is reloaded.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useUnsavedSale(): UnsavedSale | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

// The one kept right now, read straight from storage (the hook above is
// empty until the page has hydrated).
export function currentUnsavedSale(): UnsavedSale | null {
  return read();
}

// ---------- reader payments still in progress ----------
// A payment sent to the card reader, kept from the moment it starts until
// it's saved or canceled, so a reload mid-payment (a deploy, a frozen
// screen) doesn't lose it: when the register loads it looks each one up with
// Stripe, and one that went through becomes the unsaved sale above, for
// Retry saving. `order` is the sale as it will be saved, before any tip
// picked on the reader.

export interface PendingReaderSale {
  readerId: string;
  order: CompleteOrderInput;
  memberName: string | null;
  startedAt: number;
}

const PENDING_KEY = "rcl.register-reader-payments.v1";

export function readPendingReaderSales(): PendingReaderSale[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const list = raw ? (JSON.parse(raw) as PendingReaderSale[]) : [];
    return Array.isArray(list) ? list.filter((p) => p?.order?.payment?.stripePaymentIntentId) : [];
  } catch {
    return [];
  }
}

function writePending(list: PendingReaderSale[]) {
  try {
    if (list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // Storage blocked: a reload mid-payment can't find it, but Reports ->
    // Register checks still lists a card payment with no sale.
  }
}

export function keepPendingReaderSale(p: PendingReaderSale) {
  const id = p.order.payment.stripePaymentIntentId;
  // Newest first; a handful at most (older ones are long settled).
  writePending([p, ...readPendingReaderSales().filter((q) => q.order.payment.stripePaymentIntentId !== id)].slice(0, 5));
}

export function clearPendingReaderSale(paymentIntentId: string) {
  const list = readPendingReaderSales();
  const rest = list.filter((q) => q.order.payment.stripePaymentIntentId !== paymentIntentId);
  if (rest.length !== list.length) writePending(rest);
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default function UnsavedSaleBanner({ sale, busy, onRetry, onStop }: { sale: UnsavedSale; busy: boolean; onRetry: () => void; onStop: () => void }) {
  const { order } = sale;
  return (
    <div role="alert" className="mt-2 rounded-lg border-2 p-3" style={{ borderColor: "var(--danger-text)", background: "var(--warn-bg)" }}>
      <p className="text-sm font-bold" style={{ color: "var(--danger-text)" }}>
        The card WAS charged. Tap Retry saving. Don&apos;t charge the card again.
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--warn-text)" }}>
        {order.orderName.trim() || "Order"} · {money(order.payment.card)} on the card
        {sale.stale ? " · The register was just updated: reload the page first." : sale.tries > 1 ? " · Still not saved. If it keeps failing, get a manager." : ""}
      </p>
      <div className="mt-2 flex items-center gap-3">
        {sale.stale ? (
          <button className="btn-primary !px-4 !py-2" onClick={() => window.location.reload()}>
            Reload page
          </button>
        ) : (
          <button className="btn-primary !px-4 !py-2" disabled={busy} onClick={onRetry}>
            {busy ? "Saving..." : "Retry saving"}
          </button>
        )}
        <button className="text-xs underline" style={{ color: "var(--muted)" }} onClick={onStop}>
          Stop trying
        </button>
      </div>
    </div>
  );
}
