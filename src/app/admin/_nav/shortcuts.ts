import type { AreaKey } from "./areas";
import { activeHref } from "./active";
import type { FindEntry } from "./map";

// Your shortcuts on Today: the pages you open most on this device first
// (./visits.ts), then the ones people in your role open most (the site's
// usage counts), then a few sensible ones for your role, so someone new
// still gets a useful row. Plain data, no browser or server code.

export const SHORTCUT_COUNT = 6;

export interface ShortcutEntry {
  href: string;
  label: string;
  about: string;
  area?: AreaKey;
}

// What a new cashier, manager or owner most likely wants, in order. Only
// the ones their role can open are used.
const DEFAULTS: Record<string, string[]> = {
  cashier: ["/admin/menu", "/admin/screenings", "/admin/members", "/admin/my-hours", "/admin/booths", "/admin/events", "/admin/reports"],
  manager: ["/admin/team", "/admin/team?view=todos", "/admin/reports", "/admin/menu", "/admin/team?view=timesheets", "/admin/ingredients", "/admin/screenings"],
  admin: ["/admin/reports", "/admin/team", "/admin/screenings", "/admin/members", "/admin/menu", "/admin/team?view=timesheets", "/admin/events"],
  owner: ["/admin/reports", "/admin/team", "/admin/screenings", "/admin/members", "/admin/menu", "/admin/team?view=timesheets", "/admin/events"],
};

// Places that are already one tap away everywhere, or aren't back-office pages.
const NOT_SHORTCUTS = new Set(["/admin", "/pos", "/", "/help", "/training"]);

// The pages someone could have as a shortcut: everything Find anything
// lists for them, minus the ones above.
export function shortcutEntries(find: FindEntry[]): ShortcutEntry[] {
  const seen = new Set<string>();
  const out: ShortcutEntry[] = [];
  for (const f of find) {
    if (NOT_SHORTCUTS.has(f.href) || f.href.startsWith("/display") || seen.has(f.href)) continue;
    seen.add(f.href);
    out.push({ href: f.href, label: f.label, about: f.about, area: f.area });
  }
  return out;
}

// The usage counts keep a page's path without its ?view= and with ids
// swapped for [id] ("/admin/members/[id]"), so each is matched to the
// closest page on the menu ("/admin/members").
export function hrefsForPatterns(patterns: string[], entries: ShortcutEntry[]): string[] {
  const hrefs = entries.map((e) => e.href);
  const out: string[] = [];
  for (const p of patterns) {
    const href = activeHref(hrefs, p, null);
    if (href && !NOT_SHORTCUTS.has(href) && !out.includes(href)) out.push(href);
  }
  return out;
}

export function defaultShortcuts(role: string): string[] {
  return DEFAULTS[role] ?? DEFAULTS.cashier;
}

// Yours first, then your role's, then the defaults: the first `count`
// that this person can open, each once.
export function pickShortcuts(entries: ShortcutEntry[], lists: string[][], count = SHORTCUT_COUNT): ShortcutEntry[] {
  const byHref = new Map(entries.map((e) => [e.href, e]));
  const out: ShortcutEntry[] = [];
  for (const list of lists) {
    for (const href of list) {
      const e = byHref.get(href);
      if (e && !out.includes(e)) out.push(e);
      if (out.length >= count) return out;
    }
  }
  return out;
}
