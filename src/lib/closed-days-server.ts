import "server-only";
import { DAY_STARTS_AT_HOUR, shiftDate } from "@/lib/ops/time";
import { CLOSED_DAYS_NOTE, isClosedDate } from "@/lib/closed-days";

// Why a public booking for this Central date and start time ("2026-10-10",
// "19:00") is refused because it lands on a closed day, or null when we're
// open. Goes by business day, which rolls over at 4 a.m.: 1 a.m. Sunday is
// still Saturday night, 1 a.m. Monday is still Sunday. The date and time
// are already Central wall clock, so that's plain arithmetic, DST or not.
// Only the public booking actions call this; staff aren't held to it.
export function closedDayError(date: string, time: string): string | null {
  const t = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T12:00:00Z`).getTime())) return "Pick a date and time.";
  if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) return "Pick a date and time.";
  const businessDate = Number(t[1]) < DAY_STARTS_AT_HOUR ? shiftDate(date, -1) : date;
  return isClosedDate(businessDate) ? `${CLOSED_DAYS_NOTE} Pick another day.` : null;
}
