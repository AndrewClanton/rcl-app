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
