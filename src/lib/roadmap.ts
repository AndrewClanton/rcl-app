import { FALLBACK_DISPLAY_NAME, defaultDisplayName, tidyText } from "@/lib/member-profile";

// What's new (/whats-new) and Back office → Roadmap: one list that is both
// the changelog and the roadmap. Plain data and helpers, no server code, so
// the public page, its buttons and the Back office screen all share them.
// The table is roadmap_items (supabase/migrations/20261001210000_roadmap.sql).

export const ROADMAP_STATUSES = ["idea", "queued", "building", "reviewing", "live", "not_doing"] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

export function isRoadmapStatus(s: unknown): s is RoadmapStatus {
  return typeof s === "string" && (ROADMAP_STATUSES as readonly string[]).includes(s);
}

// What each status is called, publicly and in Back office.
export const STATUS_LABEL: Record<RoadmapStatus, string> = {
  idea: "Idea",
  queued: "In line",
  building: "Building now",
  reviewing: "Final checks",
  live: "Live",
  not_doing: "Not planned",
};

// One plain line per status, for an item's own page.
export const STATUS_BLURB: Record<RoadmapStatus, string> = {
  idea: "We're considering it. Tap \"I want this too\" to bump it up.",
  queued: "It's a yes, and it's in line to be built.",
  building: "The crew is building it right now.",
  reviewing: "It's built. We're testing it before it goes live.",
  live: "It's done and live. Go try it!",
  not_doing: "Not something we're planning right now.",
};

// Where people can still say they want it.
export function canVote(status: RoadmapStatus): boolean {
  return status === "idea" || status === "queued" || status === "building" || status === "reviewing";
}

export interface HistoryEntry {
  status: RoadmapStatus;
  at: string;
}

export function parseHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((h): h is { status: string; at: string } => !!h && typeof h === "object" && typeof h.status === "string" && typeof h.at === "string")
    .filter((h) => isRoadmapStatus(h.status) && !Number.isNaN(Date.parse(h.at)))
    .map((h) => ({ status: h.status as RoadmapStatus, at: h.at }));
}

// The steps on an item's page: suggested, in line, building, live, each
// with the date it got there (the last time, if it went back and forth),
// up to where the item is now. "Final checks" counts as part of building.
export interface TimelineStep {
  key: "suggested" | "queued" | "building" | "live";
  label: string;
  at: string | null;
  done: boolean;
  current: boolean;
}

export function timelineFor(item: { status: RoadmapStatus; created_at: string; shipped_at: string | null; history: HistoryEntry[] }): TimelineStep[] {
  const last = (statuses: RoadmapStatus[]) => {
    const hits = item.history.filter((h) => statuses.includes(h.status));
    return hits.length ? hits[hits.length - 1].at : null;
  };
  const stage = { idea: 0, not_doing: 0, queued: 1, building: 2, reviewing: 2, live: 3 }[item.status];
  const steps: Omit<TimelineStep, "done" | "current">[] = [
    { key: "suggested", label: "Suggested", at: item.history[0]?.at ?? item.created_at },
    { key: "queued", label: "In line", at: last(["queued"]) },
    { key: "building", label: item.status === "reviewing" ? "Built, final checks" : "Building", at: last(["building", "reviewing"]) },
    { key: "live", label: "Live", at: item.status === "live" ? (item.shipped_at ?? last(["live"])) : null },
  ];
  return steps.map((s, i) => ({ ...s, at: i <= stage ? s.at : null, done: i < stage || (i === stage && item.status === "live"), current: i === stage && item.status !== "live" }));
}

// "Suggested by Jake B.": a member's first name and last initial (the same
// rule as a shared profile's default name), from their name or from a name
// staff typed. Null when there's nothing usable.
export function creditName(name: string | null | undefined): string | null {
  if (!tidyText(name ?? "")) return null;
  const short = defaultDisplayName(name);
  return short === FALLBACK_DISPLAY_NAME ? "a Royale Insider" : short;
}

// A web-address name for an item, from its title: "Latte flavors & free
// alt milks" -> "latte-flavors-free-alt-milks".
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
// out in. What's new and Back office both group with this.
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

export const SUGGESTION_MAX = 1000;
export const NOTE_MAX = 1000;
export const TITLE_MAX = 120;
export const SUMMARY_MAX = 1000;
