// The schedule check's last result, settings key "calendar_sync_status".
// Every way the calendar is synced writes it: Back office > Showtimes > Sync
// from calendar, scripts/sync-calendar.mjs --apply (and the hourly
// scripts/calendar-hourly.mjs that runs it), and the hourly Google Drive
// cron (/api/cron/calendar-sync). The "Schedule not checked" banner (Back
// office and the register) and the alert email (/api/cron/calendar-alert)
// read it.
//
// No server-only imports: plain node scripts load this file too, and the
// banner (a client component) uses it, so only types come from
// calendar-sync (which reads .xlsx with node code).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SyncPlan } from "@/lib/calendar-sync";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayHead = (d: string) => `${DAY[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

export const CALENDAR_STATUS_KEY = "calendar_sync_status";
// Older than this and the schedule counts as not checked.
export const STALE_MINUTES = 60;

export interface CalendarSyncStatus {
  ok: boolean;
  at: string; // ISO
  source: string;
  added?: number;
  changed?: number;
  removed?: number;
  flagged?: number;
  titlesToPick?: number;
  flaggedLines?: string[];
  error?: string;
  lastOkAt?: string; // on a failed result: the last good check before it
}

export function statusFromPlan(plan: SyncPlan, source: string, done: { added: number; changed: number; removed: number }): CalendarSyncStatus {
  return {
    ok: true,
    at: new Date().toISOString(),
    source,
    added: done.added,
    changed: done.changed,
    removed: done.removed,
    flagged: plan.flagged.length,
    titlesToPick: plan.looks.filter((l) => !l.picked || l.picked === "skip").length,
    flaggedLines: plan.flagged.slice(0, 10).map((l) => l.say ?? `${dayHead(l.date)} ${l.clock} ${l.title}: ${l.detail}`),
  };
}

export function failedStatus(source: string, error: string): CalendarSyncStatus {
  return { ok: false, at: new Date().toISOString(), source, error: error.slice(0, 300) };
}

export async function recordSyncStatus(db: SupabaseClient, status: CalendarSyncStatus): Promise<void> {
  if (!status.ok) {
    // Keep when the schedule was last checked, for "not checked since".
    const { data } = await db.from("settings").select("value").eq("key", CALENDAR_STATUS_KEY).maybeSingle();
    const prev = readStatus(data?.value);
    const lastOk = prev ? (prev.ok ? prev.at : prev.lastOkAt) : undefined;
    if (lastOk) status = { ...status, lastOkAt: lastOk };
  }
  const { error } = await db.from("settings").upsert({ key: CALENDAR_STATUS_KEY, value: status, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) console.error("calendar sync status:", error.message);
}

export function readStatus(raw: unknown): CalendarSyncStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<CalendarSyncStatus>;
  if (typeof s.at !== "string" || Number.isNaN(Date.parse(s.at))) return null;
  return {
    ok: s.ok === true,
    at: s.at,
    source: typeof s.source === "string" ? s.source : "",
    added: Number(s.added ?? 0),
    changed: Number(s.changed ?? 0),
    removed: Number(s.removed ?? 0),
    flagged: Number(s.flagged ?? 0),
    titlesToPick: Number(s.titlesToPick ?? 0),
    flaggedLines: Array.isArray(s.flaggedLines) ? s.flaggedLines.filter((l): l is string => typeof l === "string").slice(0, 10) : [],
    ...(typeof s.error === "string" ? { error: s.error } : {}),
    ...(typeof s.lastOkAt === "string" && !Number.isNaN(Date.parse(s.lastOkAt)) ? { lastOkAt: s.lastOkAt } : {}),
  };
}

// "2:07 PM" today (Central), "Oct 8, 2:07 PM" on another day.
export function sinceLabel(iso: string, now = Date.now()): string {
  const tz = "America/Chicago";
  const day = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(ms));
  const at = Date.parse(iso);
  const sameDay = day(at) === day(now);
  return new Date(at).toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", ...(sameDay ? {} : { month: "short", day: "numeric" }) });
}

// The problem to warn about, or null when the schedule was checked within
// the hour. `since` is the last good check we know of, null when there
// isn't one.
export interface ScheduleProblem {
  since: string | null;
  failed: boolean;
  error: string | null;
}

export function scheduleProblem(status: CalendarSyncStatus | null, now = Date.now()): ScheduleProblem | null {
  if (!status) return { since: null, failed: false, error: null };
  const old = now - Date.parse(status.at) > STALE_MINUTES * 60_000;
  if (status.ok && !old) return null;
  return { since: status.ok ? status.at : (status.lastOkAt ?? null), failed: !status.ok, error: status.ok ? null : (status.error ?? null) };
}

export function problemSentence(p: ScheduleProblem, now = Date.now()): string {
  if (!p.since) return p.failed ? "The schedule check against the calendar is failing, so the website's showtimes may be wrong." : "The schedule hasn't been checked against the calendar yet, so the website's showtimes may be wrong.";
  return `Schedule not checked since ${sinceLabel(p.since, now)}, so the website's showtimes may be wrong.`;
}
