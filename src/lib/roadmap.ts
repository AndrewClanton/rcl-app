// Back office → Roadmap: one staff-only list that is both the changelog and
// the roadmap. Plain data and helpers, no server code, so the page, its
// forms and its server actions all share them. The table is roadmap_items
// (supabase/migrations/20261001210000_roadmap.sql).

export const ROADMAP_STATUSES = ["idea", "queued", "building", "reviewing", "live", "not_doing"] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

export function isRoadmapStatus(s: unknown): s is RoadmapStatus {
  return typeof s === "string" && (ROADMAP_STATUSES as readonly string[]).includes(s);
}

// What each status is called in Back office.
export const STATUS_LABEL: Record<RoadmapStatus, string> = {
  idea: "Idea",
  queued: "In line",
  building: "Building now",
  reviewing: "Final checks",
  live: "Live",
  not_doing: "Not planned",
};

// A web-address name for an item, from its title: "Latte flavors & free
// alt milks" -> "latte-flavors-free-alt-milks". Every item has one (the
// command-line script finds items by it).
export function roadmapSlug(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return base || "item";
}

// "1.4.0" -> "1.4": releases are numbered by the minor version.
export function releaseLabel(version: string | null | undefined): string | null {
  const m = /^(\d+)\.(\d+)/.exec(version ?? "");
  return m ? `${m[1]}.${m[2]}` : null;
}

// "just now", "12 min ago", "3 hours ago", "yesterday", "Sep 28".
export function timeAgo(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const min = Math.round(ms / 60_000);
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return shortDate(iso);
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
}

export function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" });
}

// The day an item shipped, in Joplin: groups "Just shipped".
export function centralDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

// "Just shipped", a day at a time: items already newest first, grouped by
// the day they shipped in Joplin, with the releases each day's changes went
// out in.
export interface ShippedDayGroup<T> {
  day: string;
  date: string;
  releases: string[];
  items: T[];
}

export function shippedByDay<T>(items: T[], at: (item: T) => string, release: (item: T) => string | null): ShippedDayGroup<T>[] {
  const days: ShippedDayGroup<T>[] = [];
  for (const item of items) {
    const when = at(item);
    const day = centralDay(when);
    let group = days[days.length - 1];
    if (!group || group.day !== day) {
      group = { day, date: when, releases: [], items: [] };
      days.push(group);
    }
    group.items.push(item);
    const r = release(item);
    if (r && !group.releases.includes(r)) group.releases.push(r);
  }
  return days;
}

export const TITLE_MAX = 120;
export const SUMMARY_MAX = 1000;
export const NOTES_MAX = 4000;
