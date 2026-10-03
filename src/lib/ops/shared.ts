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
  // For every manager, admin and owner, not one person: the register shows
  // it only while one of them is using it.
  forManagers: boolean;
  // A restock to-do made by "Ran out": Done means it was bought, which
  // closes that report and puts what it stopped back on sale.
  outageId: string | null;
}

// Managers and up (the same roles as hasManagerAccess in src/lib/auth.ts,
// which is server-only).
export function isManagerRole(role: string | null | undefined): boolean {
  return role === "manager" || role === "admin" || role === "owner";
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
  // Each open "Ran out" report, for the register's quiet "Out of …" line.
  outNotices: OutNotice[];
}

// "Out of Heavy whipping cream · Nathan and Mary have been emailed": an open
// report, and the first names its email reached (none if it didn't go out).
export interface OutNotice {
  id: string;
  what: string;
  emailed: string[];
}

// "Nathan", "Nathan and Mary", "Nathan, Mary and Bryce".
export function namesList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// The register's line for an open report. It never asks the cashier to buy
// anything: the purchasers have been told.
export function outNoticeText(n: OutNotice): string {
  const told = n.emailed.length
    ? `${namesList(n.emailed)} ${n.emailed.length === 1 ? "has" : "have"} been emailed`
    : "the email to the buyers didn't go out, so tell a manager";
  return `Out of ${n.what} · ${told}`;
}

// The ran-out email's suggestion. Running out before the week's shopping is
// over means the par (what's bought for the week) is too low.
export function ranOutSuggestion(o: { onSheet: boolean; parQty: number | null; unit: string | null; times: number }): string {
  const fix = !o.onSheet
    ? "Consider adding it to the par sheet."
    : o.parQty === null
      ? "It has no par yet. Consider setting one."
      : `Consider raising the par from ${qtyUnit(o.parQty, o.unit)}.`;
  const again = o.times >= 2 ? ` This is the ${ordinal(o.times)} time in ${OFTEN_OUT_DAYS} days.` : "";
  return `Ran out before the week was over. ${fix}${again}`;
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

// A par line that keeps running out: the managers are asked whether its par
// should go up. Nothing changes the par by itself.
export interface OftenOut {
  parItemId: string;
  name: string;
  area: string;
  times: number; // reports in the window, false alarms left out
  days: number; // the window: 30
  lastAt: string;
  parQty: number | null;
  unit: string | null;
  unitSize: string | null;
}

export const OFTEN_OUT_DAYS = 30;
export const OFTEN_OUT_TIMES = 2;

// "Ran out 3 times in 30 days. Raise par? It's 2 sleeves now."
export function raiseParText(o: Pick<OftenOut, "name" | "times" | "days" | "parQty" | "unit" | "unitSize">): string {
  const par = o.parQty === null ? "It has no par yet." : `It's ${qtyUnit(o.parQty, o.unit)}${o.unitSize ? ` (${o.unitSize})` : ""} now.`;
  return `${o.name} ran out ${o.times} times in ${o.days} days. Raise par? ${par}`;
}

// 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st.
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

// The managers' restock to-do for a "Ran out" report:
//   Buy Hot dog buns at Walmart
//   Ran out 7:45 PM Tue Sep 29, reported by Caleb. Par is 2 sleeves. This
//   is the 3rd time in 30 days: consider raising the par.
// A store that's a person ("Andrew" brings the popcorn) reads "Get … from".
export function restockTaskText(o: {
  what: string;
  onSheet: boolean;
  source: string | null;
  sourceIsPerson: boolean;
  reportedAt: string;
  byName: string | null;
  parQty: number | null;
  unit: string | null;
  unitSize: string | null;
  times: number; // this report included, false alarms left out
}): { title: string; details: string } {
  const source = o.source?.trim() || null;
  const title = source ? (o.sourceIsPerson ? `Get ${o.what} from ${source}` : `Buy ${o.what} at ${source}`) : `Buy ${o.what}`;
  const at = new Date(o.reportedAt);
  const tz = { timeZone: "America/Chicago" } as const;
  const time = at.toLocaleTimeString("en-US", { ...tz, hour: "numeric", minute: "2-digit" });
  const day = `${at.toLocaleDateString("en-US", { ...tz, weekday: "short" })} ${at.toLocaleDateString("en-US", { ...tz, month: "short", day: "numeric" })}`;
  const parts = [`Ran out ${time} ${day}${o.byName ? `, reported by ${o.byName}` : ""}.`];
  if (o.onSheet) parts.push(o.parQty === null ? "No par set yet." : `Par is ${qtyUnit(o.parQty, o.unit)}${o.unitSize ? ` (${o.unitSize})` : ""}.`);
  if (o.times >= 2) {
    parts.push(`This is the ${ordinal(o.times)} time in ${OFTEN_OUT_DAYS} days: ${o.onSheet ? "consider raising the par" : "consider adding it to the par sheet"}.`);
  }
  return { title: title.slice(0, 200), details: parts.join(" ") };
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
