import "server-only";
import { centralToIso, shiftDate } from "@/lib/ops/time";

// When marketing email may arrive: 9 AM to 7 PM Central, Monday to
// Saturday, never Sunday. Anything outside that moves to the next 10:30 AM
// slot. (Receipts and account mail aren't held back.) DST-aware through
// src/lib/ops/time.ts.

const TZ = "America/Chicago";
export const WINDOW_OPENS = 9 * 60;
export const WINDOW_CLOSES = 19 * 60;
export const SLOT = "10:30";

function central(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: p.weekday as string };
}

export function inSendWindow(d: Date): boolean {
  const c = central(d);
  return c.weekday !== "Sun" && c.minutes >= WINDOW_OPENS && c.minutes < WINDOW_CLOSES;
}

// `d` if it's inside the window; otherwise the next 10:30 AM on a Monday
// to Saturday.
export function nextSendSlot(d: Date): Date {
  if (inSendWindow(d)) return d;
  const c = central(d);
  let date = c.date;
  // Before 9 AM on a sending day: 10:30 the same day.
  if (!(c.weekday !== "Sun" && c.minutes < WINDOW_OPENS)) date = shiftDate(date, 1);
  for (let i = 0; i < 3; i++) {
    const at = new Date(centralToIso(date, SLOT));
    if (central(at).weekday !== "Sun") return at;
    date = shiftDate(date, 1);
  }
  return new Date(centralToIso(date, SLOT));
}

// The Tuesday lineup: this week's Tuesday 10:30 AM if it's still ahead
// (with time to approve it), otherwise next Tuesday's.
export function nextLineupSlot(now = new Date()): { date: string; at: Date } {
  const c = central(now);
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(c.weekday);
  let ahead = (2 - dow + 7) % 7;
  let date = shiftDate(c.date, ahead);
  let at = new Date(centralToIso(date, SLOT));
  if (at.getTime() <= now.getTime()) {
    ahead += 7;
    date = shiftDate(c.date, ahead);
    at = new Date(centralToIso(date, SLOT));
  }
  return { date, at };
}

// A Central date and time from the composer ("2026-10-13", "10:30").
export function centralDateTime(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const d = new Date(centralToIso(date, time));
  return Number.isFinite(d.getTime()) ? d : null;
}

export function centralParts(d: Date) {
  return central(d);
}

// The time the composer suggests: Tuesday 10:30 for the lineup, otherwise
// the next open slot at least 10 minutes out.
export function suggestedSlot(kind: string, now = new Date()): Date {
  return kind === "lineup" ? nextLineupSlot(now).at : nextSendSlot(new Date(now.getTime() + 10 * 60_000));
}

// ---------- too late ----------
// The latest a one-off email may arrive. Anything that would land later (a
// list that ran out of time, Resend asking us to slow down, a pause and a
// resume, sending switched back on) doesn't go on its own:
//   - `hard`: the words would be wrong by then (a "tonight" or "this
//     weekend" alert, an event email after its day, last week's lineup), so
//     those emails are cancelled;
//   - otherwise it's paused for an admin to decide (Resume sends the rest
//     anyway): past the end of the next sending day after it was meant to go.
// Automations have their own rule (dropped 2 days after being queued).
export interface SendBy {
  at: Date;
  hard: boolean;
  why: string;
}

type SendByInput = {
  kind: string;
  automation?: string | null;
  content?: { alert?: string | null; eventDate?: string | null; lineup?: { start?: string | null; days?: number | null } | null } | null;
  scheduled_for?: string | null;
  approved_at?: string | null;
  created_at?: string | null;
  lineup_start?: string | null;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const endOfDay = (date: string) => new Date(centralToIso(shiftDate(date, 1), "00:00"));
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export function sendByFor(c: SendByInput): SendBy | null {
  if (c.automation || c.kind === "automation") return null;
  const planned = Date.parse(c.scheduled_for ?? c.approved_at ?? c.created_at ?? "");
  if (!Number.isFinite(planned)) return null;
  const day = central(new Date(planned)).date;
  const later = (a: string, b: string) => (a > b ? a : b);
  if (c.kind === "alert") {
    const alert = c.content?.alert ?? null;
    if (alert === "tonight") return { at: endOfDay(day), hard: true, why: `a "tonight" email only goes on its own day (${dayLabel(day)})` };
    if (alert === "weekend") {
      const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
      const sunday = shiftDate(day, (7 - dow) % 7);
      return { at: endOfDay(sunday), hard: true, why: `a "this weekend" email only goes before that weekend is over (${dayLabel(sunday)})` };
    }
    const next = shiftDate(day, 1);
    return { at: endOfDay(next), hard: true, why: `an alert only goes within a day of when it was meant to (${dayLabel(day)})` };
  }
  if (c.kind === "event" && c.content?.eventDate && YMD.test(c.content.eventDate)) {
    const last = later(c.content.eventDate, day);
    return { at: endOfDay(last), hard: true, why: `an event email only goes up to the day of the event (${dayLabel(c.content.eventDate)})` };
  }
  if (c.kind === "lineup") {
    const start = c.content?.lineup?.start && YMD.test(c.content.lineup.start) ? c.content.lineup.start : c.lineup_start && YMD.test(c.lineup_start) ? c.lineup_start : null;
    if (start) {
      const days = Math.max(1, Math.min(14, Math.floor(Number(c.content?.lineup?.days) || 7)));
      const last = shiftDate(start, days - 1);
      return { at: endOfDay(later(last, day)), hard: true, why: `a lineup only goes during the week it covers (to ${dayLabel(last)})` };
    }
  }
  // Anything else: by the end of the next sending day (Sunday never sends,
  // so Saturday's leftovers still go on Monday).
  let next = shiftDate(day, 1);
  if (new Date(`${next}T12:00:00Z`).getUTCDay() === 0) next = shiftDate(next, 1);
  return { at: endOfDay(next), hard: false, why: `it was meant to go ${dayLabel(day)}, and the rest would now arrive after ${dayLabel(next)}` };
}
