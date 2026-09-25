// Shared by the register's shift tools (client) and their server actions.

export type Timing = "opening" | "closing" | "anytime";
export type ReminderKind = "before_screening" | "daily" | "schedule_low";

export const TIMING_LABEL: Record<Timing, string> = { opening: "Opening", closing: "Closing", anytime: "Any time" };
export const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface OnShift {
  shiftId: string;
  employeeId: string;
  name: string;
  startedAt: string;
}

export interface TodayTask {
  id: string;
  title: string;
  details: string | null;
  timing: Timing;
  assigneeName: string | null;
  done: { byName: string | null; at: string } | null;
}

export interface DueReminder {
  reminderId: string;
  occurrence: string;
  message: string;
  detail: string;
  assigneeName: string | null;
  urgent: boolean;
}

export interface ShiftStatus {
  workDate: string;
  onShift: OnShift[];
  tasks: TodayTask[];
  reminders: DueReminder[];
  lastCount: { id: string; at: string; byName: string | null; below: number } | null;
}

export interface ParItem {
  id: string;
  area: string;
  section: string | null;
  name: string;
  par_qty: number | null;
  unit: string | null;
  source: string | null;
  sort_order: number;
  active: boolean;
}

export interface TaskRow {
  id: string;
  title: string;
  details: string | null;
  timing: Timing;
  days: number[] | null;
  assignee_id: string | null;
  sort_order: number;
  active: boolean;
}

export interface ReminderRow {
  id: string;
  kind: ReminderKind;
  message: string;
  minutes: number | null;
  time_of_day: string | null;
  days: number[] | null;
  assignee_id: string | null;
  active: boolean;
}

export interface ShoppingLine {
  itemId: string;
  name: string;
  area: string;
  have: number;
  par: number;
  unit: string | null;
  need: number;
}

export interface ShoppingList {
  countId: string;
  at: string;
  byName: string | null;
  bySource: { source: string; lines: ShoppingLine[] }[];
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

// A quantity the way staff read it on the shelf: "1/2", "1 1/4", "3".
export function qtyLabel(n: number | null): string {
  if (n === null || n === undefined) return "—";
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 4) / 4;
  const f = frac === 0.25 ? "¼" : frac === 0.5 ? "½" : frac === 0.75 ? "¾" : "";
  if (!f) return String(Math.round(n * 100) / 100);
  return whole ? `${whole}${f}` : f;
}

export function parLabel(item: Pick<ParItem, "par_qty" | "unit">): string {
  if (item.par_qty === null) return item.unit ? item.unit : "No par set";
  return `${qtyLabel(item.par_qty)}${item.unit ? ` ${item.unit}` : ""}`;
}

// Items with a fractional par (½ shaker, ¼ bag) count in quarters.
export function stepFor(item: Pick<ParItem, "par_qty">): number {
  return item.par_qty !== null && !Number.isInteger(item.par_qty) ? 0.25 : 1;
}

export function daysLabel(days: number[] | null): string {
  if (!days || days.length === 0 || days.length === 7) return "Every day";
  return [...days].sort().map((d) => DAY_NAMES[d]).join(", ");
}
