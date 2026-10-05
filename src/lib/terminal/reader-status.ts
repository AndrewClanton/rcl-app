// A card reader's health as the register sees it (the server side is
// reader-health.ts). Plain values only: the register's browser uses this.
//
// Stripe's Reader object has no battery level for a smart reader: only
// online/offline, when it was last seen, and what it is. So the register
// warns when the reader drops off, and Devices counts how often it has
// today, which is what a dying battery looks like from here.

export const READER_OFFLINE_MESSAGE = "Card reader offline: plug it in or check Wi-Fi";

// Not heard from for this long when Stripe answered: treated as offline.
export const READER_STALE_MS = 2 * 60_000;

export interface ReaderHealth {
  readerId: string;
  // False: Stripe doesn't know this reader (deleted, or a typo).
  found: boolean;
  // Stripe's status; null until Stripe has answered once.
  online: boolean | null;
  lastSeenAt: number | null; // ms
  checkedAt: number | null; // ms: when Stripe answered
  label: string | null;
  model: string | null;
  serialLast4: string | null;
  software: string | null;
  ip: string | null;
  location: string | null;
  doing: string | null; // "Idle", "Collecting a payment", ...
  offlineToday: number;
  // The last try couldn't reach Stripe: the rest is from checkedAt.
  stripeError: boolean;
}

// The register's warning: Stripe says offline, or hadn't heard from it for
// over 2 minutes when it last answered. Never blocks a charge by itself
// (Stripe advises against that); the charge does its own check.
export function readerNeedsLook(h: ReaderHealth | null): boolean {
  if (!h || !h.found || h.checkedAt === null) return false;
  if (h.online === false) return true;
  return h.lastSeenAt !== null && h.checkedAt - h.lastSeenAt > READER_STALE_MS;
}

export function agoLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}
