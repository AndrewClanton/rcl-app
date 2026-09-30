// Which back-office pages someone opens most, remembered on this device
// only (like the folded menu sections), for Your shortcuts on Today. The
// menu (AdminShell) adds one each time a page opens; nothing here is ever
// sent anywhere. The site's own usage counts (Reports → Website usage)
// never keep who looked, only the role, so this is the only personal part.
// Browser code: call these from effects and event handlers.

const KEY = (employeeId: string) => `rcl.backoffice.visits.${employeeId}`;
const MAX_PAGES = 40;
const HALF_LIFE_DAYS = 30; // a page opened a month ago counts half

type Tally = Record<string, { n: number; t: number }>;

const listeners = new Set<() => void>();

function read(employeeId: string): Tally {
  try {
    const raw = window.localStorage.getItem(KEY(employeeId));
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Tally) : {};
  } catch {
    return {};
  }
}

export function recordVisit(employeeId: string, href: string) {
  const tally = read(employeeId);
  const had = tally[href];
  tally[href] = { n: (had?.n ?? 0) + 1, t: Date.now() };
  // Keep the list short: drop the least used.
  const kept = Object.entries(tally)
    .sort((a, b) => b[1].n - a[1].n || b[1].t - a[1].t)
    .slice(0, MAX_PAGES);
  try {
    window.localStorage.setItem(KEY(employeeId), JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Private browsing or storage full: it just won't be remembered.
  }
  listeners.forEach((l) => l());
}

// The raw stored text, for useSyncExternalStore (a string compares cleanly).
export function visitsSnapshot(employeeId: string): string {
  try {
    return window.localStorage.getItem(KEY(employeeId)) ?? "";
  } catch {
    return "";
  }
}

export function subscribeVisits(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

// Pages by how much they're used, favouring lately: most first.
export function rankVisits(raw: string | null): { href: string; score: number; opens: number }[] {
  if (!raw) return [];
  let tally: Tally;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return [];
    tally = v as Tally;
  } catch {
    return [];
  }
  const now = Date.now();
  return Object.entries(tally)
    .filter(([, v]) => v && typeof v.n === "number" && typeof v.t === "number")
    .map(([href, v]) => ({ href, opens: v.n, score: v.n * Math.pow(0.5, Math.max(0, now - v.t) / (HALF_LIFE_DAYS * 86_400_000)) }))
    .sort((a, b) => b.score - a.score);
}
