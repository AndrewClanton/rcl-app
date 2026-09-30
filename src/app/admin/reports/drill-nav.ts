"use client";

// Opening and closing a Day report drill-down. The address says which one
// is open (?show=tips, ?show=orders&pay=card), so it can be bookmarked or
// sent, but opening one doesn't reload the report: it's the browser's own
// history (Next keeps useSearchParams in step with it).

export const DRILL_PARAMS = ["show", "status", "pay", "who", "cat", "item", "q", "split"] as const;
export type DrillParam = (typeof DRILL_PARAMS)[number];

// Whether this visit opened the drill-down itself (so closing can step back
// instead of adding another history entry).
let pushed = false;

export function openDrill(href: string) {
  pushed = true;
  window.history.pushState(null, "", href);
}

// From one drill-down to another inside the sheet: same history entry, so
// closing still goes straight back to the report.
export function switchDrill(href: string) {
  window.history.replaceState(null, "", href);
}

// The browser's back or forward button moved the history itself.
export function forgetPush() {
  pushed = false;
}

export function closeDrill() {
  if (pushed) {
    pushed = false;
    window.history.back();
    return;
  }
  const q = new URLSearchParams(window.location.search);
  for (const k of DRILL_PARAMS) q.delete(k);
  const s = q.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
}

// Change the open drill-down's filters in place (no new history entry).
export function setDrillParams(patch: Partial<Record<DrillParam, string | null>>) {
  const q = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v) q.set(k, v);
    else q.delete(k);
  }
  window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
}
