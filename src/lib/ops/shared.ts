// Shared by the register's shift tools (client) and their server actions.

export type Timing = "opening" | "closing" | "anytime";
export type ReminderKind = "before_screening" | "daily" | "schedule_low";

export const TIMING_LABEL: Record<Timing, string> = { opening: "Opening", closing: "Closing", anytime: "Any time" };

// Daily tasks come up on their days. Weekly and monthly ones show every day
// until someone ticks them off, then return next week (Monday) or month.
export type Frequency = "daily" | "weekly" | "monthly";
export const FREQUENCY_LABEL: Record<Frequency, string> = { daily: "Every day", weekly: "Once a week", monthly: "Once a month" };
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
  frequency: Frequency;
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

// A one-off to-do from Back office → Team, for a person or for whoever's on.
// A training assigned to someone on shift that they haven't signed off yet
// (Back office → Training). Opens in the register's training window.
export interface ShiftTraining {
  employeeId: string;
  name: string; // first name
  slug: string;
  title: string;
  dueDate: string | null;
  overdue: boolean;
  updated: boolean; // signed an older version; needs signing again
}

export interface ShiftTodo {
  id: string;
  title: string;
  details: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  fromName: string | null;
}

// A booth held for today or tomorrow (confirmed bookings only), for the
// register's shift bar.
export interface BoothHold {
  id: string;
  booth: string;
  date: string; // YYYY-MM-DD
  window: string; // "7:00–9:00 PM"
  name: string;
  party: number;
  bookedAt: string;
  isNew: boolean; // booked in the last 24 hours
  cardPrintedAt: string | null;
}

export interface ShiftStatus {
  workDate: string;
  onShift: OnShift[];
  tasks: TodayTask[];
  reminders: DueReminder[];
  todos: ShiftTodo[];
  training: ShiftTraining[];
  booths: { today: BoothHold[]; tomorrow: BoothHold[] };
  // Today's staff schedule, by person: "4:00 PM–10:00 PM".
  scheduled: Record<string, string>;
  // The latest par count save and how many lines are under par across the
  // day's counts (what the Shopping tab lists).
  lastCount: { at: string; byName: string | null; today: boolean; below: number } | null;
  // Menu items 86'd right now, and how many "Ran out" reports are open.
  outs: RegisterOut[];
  ranOut: number;
}

// ---------- "Ran out" (86 it) ----------

export type OutageResolution = "bought" | "found" | "mistake";

// A menu item the register shouldn't sell right now.
export interface RegisterOut {
  itemId: string;
  reason: string; // "Out of hot dog buns"
  since: string;
  outageId: string | null;
  // What ran out ("Hot dog buns"), while that report is still open.
  what: string | null;
}

// An open "Ran out" report, for the shopping list.
export interface OpenOutage {
  id: string;
  parItemId: string | null;
  name: string;
  area: string | null;
  source: string | null;
  parQty: number | null;
  unit: string | null;
  note: string | null;
  reportedAt: string;
  byName: string | null;
  stopped: string[]; // menu item names still 86'd because of it
}

// What the "Ran out" sheet picks from.
export interface RanOutOptions {
  parItems: Pick<ParItem, "id" | "area" | "section" | "name" | "par_qty" | "unit" | "source">[];
  menu: { id: string; name: string; category: string; outSince: string | null }[];
  // Par line id → menu items whose recipe uses it.
  recipeUses: Record<string, string[]>;
  // Par line id → its open report.
  open: Record<string, { at: string; byName: string | null }>;
}

export const OUT_LABEL_MAX = 80;
export const OUT_NOTE_MAX = 300;
export const OUT_ITEMS_MAX = 40;

// "Hot dog buns" → "hot dog buns", for the middle of a sentence. A leading
// capital stays on an acronym ("SF vanilla").
export function midSentence(what: string): string {
  const w = what.trim();
  return w.length > 1 && w[1] === w[1].toLowerCase() ? w[0].toLowerCase() + w.slice(1) : w;
}

// "Hot dog buns" → "Out of hot dog buns"
export function outReason(what: string): string {
  return `Out of ${midSentence(what)}`;
}

export interface ParItem {
  id: string;
  area: string;
  section: string | null;
  name: string;
  par_qty: number | null;
  unit: string | null;
  // The size one unit comes in: "750 ml", "12.5 lb". Optional.
  unit_size: string | null;
  // What − and + move by: 0.25, 0.5 or 1. Null = automatic (stepFor).
  count_step: number | null;
  source: string | null;
  sort_order: number;
  active: boolean;
}

export interface TaskRow {
  id: string;
  title: string;
  details: string | null;
  timing: Timing;
  frequency: Frequency;
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
  unitSize: string | null;
  need: number; // par − have, exactly (can be ¾ of a bottle)
  buy: number; // whole units to get (you can't buy ¾ of a bottle)
  countedAt: string;
}

// One save of the par count.
export interface CountRef {
  id: string;
  at: string;
  byName: string | null;
}

// Under par, merged from every count saved today: each item's latest line
// today. When nothing's been counted today, each item's latest line ever.
export interface ShoppingList {
  today: boolean;
  counts: CountRef[]; // the saves the numbers came from, oldest first
  bySource: { source: string; lines: ShoppingLine[] }[];
  // Active par lines with no count in that set: not counted today (or, with
  // no count today, never counted), so nothing drops off silently.
  notCounted: { itemId: string; name: string; area: string; section: string | null; lastAt: string | null }[];
}

// "Since the last count": each line counted on a day against its count
// before that day.
export interface CountChange {
  itemId: string;
  name: string;
  area: string;
  section: string | null;
  unit: string | null;
  unitSize: string | null;
  par: number | null;
  now: { qty: number; at: string; byName: string | null };
  prev: { qty: number; at: string; byName: string | null } | null;
  diff: number | null; // now − prev; negative = used
}

export interface CountComparison {
  date: string; // the business date of the counts compared
  today: boolean; // counted today, or the latest day with a count
  counts: CountRef[];
  rows: CountChange[]; // biggest drop first
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

// "bottles" → "bottle", "boxes" → "box", "spray bottles" → "spray bottle".
export function singularUnit(unit: string): string {
  if (/(x|ch|sh|ss)es$/i.test(unit)) return unit.slice(0, -2);
  if (/[^s]s$/i.test(unit)) return unit.slice(0, -1);
  return unit;
}

// The unit as it reads next to a number: "1 bottle", "¾ bottle", "2 bottles".
export function unitFor(unit: string | null, n: number | null): string {
  if (!unit) return "";
  return n !== null && n > 0 && n <= 1 ? singularUnit(unit) : unit;
}

// "1¼ bottles", "3 boxes", "¾ bottle".
export function qtyUnit(n: number, unit: string | null): string {
  const u = unitFor(unit, n);
  return u ? `${qtyLabel(n)} ${u}` : qtyLabel(n);
}

export function parLabel(item: Pick<ParItem, "par_qty" | "unit">): string {
  if (item.par_qty === null) return item.unit ? `not set (${item.unit})` : "not set";
  return qtyUnit(item.par_qty, item.unit);
}

// What you'd actually buy: a whole unit for any part of one.
export function buyQty(need: number): number {
  return need > 0 ? Math.ceil(Math.round(need * 100) / 100) : 0;
}

// ---------- counting in quarters ----------

export const COUNT_STEPS = [1, 0.5, 0.25] as const;
export const COUNT_STEP_LABEL: Record<string, string> = { "1": "Whole", "0.5": "Halves", "0.25": "Quarters" };

// Units that are opened and used a bit at a time. Spray bottles are counted
// whole. (Same rule as the 20260930041000 migration's backfill.)
const QUARTER_UNITS = /\b(bottles?|kegs?|jugs?|gallons?|quarts?|cartons?)\b/i;
const WHOLE_UNITS = /\bspray\s+bottles?\b/i;

// The automatic step: quarters for bottles, kegs, jugs, gallons, quarts and
// cartons, and for anything with a fractional par (½ shaker, ¼ bag);
// whole units for everything else.
export function autoStep(unit: string | null, par: number | null): number {
  if (par !== null && !Number.isInteger(par)) return 0.25;
  if (unit && WHOLE_UNITS.test(unit)) return 1;
  if (unit && QUARTER_UNITS.test(unit)) return 0.25;
  return 1;
}

export function stepFor(item: Pick<ParItem, "par_qty" | "unit"> & { count_step?: number | null }): number {
  const s = item.count_step;
  return s === 0.25 || s === 0.5 || s === 1 ? s : autoStep(item.unit, item.par_qty);
}

// The units the par sheet is counted in, for the item form's suggestions.
export const PAR_UNITS = [
  "bottles",
  "boxes",
  "bags",
  "cans",
  "cartons",
  "cases",
  "gallons",
  "jugs",
  "kegs",
  "packs",
  "quarts",
  "shakers",
  "sheets",
  "sleeves",
  "spray bottles",
  "24-packs",
];
export const PAR_SIZES = ["750 ml", "1 L", "1.75 L", "1/2 barrel", "1/6 barrel", "1 gal", "half gallon", "#10", "1 lb", "2 lb", "5 lb", "12.5 lb", "10 ct"];

// "Used 1¼ bottles", "Restocked 2 boxes", "No change".
export function changeLabel(diff: number, unit: string | null): string {
  const d = Math.round(diff * 100) / 100;
  if (d === 0) return "No change";
  return `${d < 0 ? "Used" : "Restocked"} ${qtyUnit(Math.abs(d), unit)}`;
}

export function daysLabel(days: number[] | null): string {
  if (!days || days.length === 0 || days.length === 7) return "Every day";
  return [...days].sort().map((d) => DAY_NAMES[d]).join(", ");
}
