"use server";

import { trainingDueFor } from "@/lib/training/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertStaff } from "@/lib/auth";
import { businessDay, businessDayWindow, centralMinutes, clock, recentBusinessDays, shortDay } from "@/lib/ops/time";
import { evaluateReminders } from "@/lib/ops/reminders";
import { boothWindow } from "@/lib/booth-time";
import { logOpsChange } from "@/lib/ops/changes";
import { currentOuts, finishTodo, reopenTodo } from "@/lib/ops/outages";
import { startShiftFor } from "@/lib/ops/shifts";
import { countsOf, currentLines, latestLines } from "@/lib/ops/par-counts";
import {
  buyQty,
  type BoothHold,
  type CountChange,
  type CountComparison,
  type DueReminder,
  type OnShift,
  type ParItem,
  type ReminderKind,
  type ReminderRow,
  type Result,
  type ShiftStatus,
  type ShiftTodo,
  type ShoppingLine,
  type ShoppingList,
  type Frequency,
  type TaskRow,
  type Timing,
  type TodayTask,
} from "@/lib/ops/shared";

// Server side of the register's shift tools. Every action checks the staff
// session; `employeeId` is whoever is on shift at the tablet, recorded on
// ticks, counts and list edits (same trust model as orders).

const db = () => createAdminClient();

async function employeeNames(): Promise<Map<string, string>> {
  const { data } = await db().from("employees").select("id, name");
  return new Map((data ?? []).map((e) => [e.id as string, (e.name as string).split(" ")[0]]));
}

async function validEmployee(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const { data } = await db().from("employees").select("id").eq("id", id).eq("active", true).neq("role", "display").maybeSingle();
  return data ? (data.id as string) : null;
}

const logChange = logOpsChange;

// ---------- status (polled by the register every minute) ----------

async function dueReminders(names: Map<string, string>): Promise<DueReminder[]> {
  const supabase = db();
  const { data: rows } = await supabase.from("reminders").select("*").eq("active", true);
  const reminders = (rows ?? []) as ReminderRow[];
  if (reminders.length === 0) return [];
  const now = new Date();

  const lead = Math.min(240, Math.max(5, ...reminders.filter((r) => r.kind === "before_screening").map((r) => r.minutes ?? 5)));
  const [{ data: screenings }, { data: last }, { data: dismissed }] = await Promise.all([
    supabase
      .from("screenings")
      .select("id, starts_at, movie:movies(title), room:rooms(name)")
      .gte("starts_at", new Date(now.getTime() - 10 * 60_000).toISOString())
      .lte("starts_at", new Date(now.getTime() + lead * 60_000).toISOString())
      .order("starts_at"),
    supabase.from("screenings").select("starts_at").gte("starts_at", now.toISOString()).order("starts_at", { ascending: false }).limit(1),
    supabase.from("reminder_dismissals").select("reminder_id, occurrence").in("reminder_id", reminders.map((r) => r.id)),
  ]);

  return evaluateReminders({
    reminders,
    screenings: (screenings ?? []).map((x) => ({
      id: x.id as string,
      startsAt: x.starts_at as string,
      title: (x.movie as unknown as { title: string } | null)?.title ?? "Screening",
      room: ((x.room as unknown as { name: string } | null)?.name ?? "").split(" — ")[0],
    })),
    lastScheduledAt: (last?.[0]?.starts_at as string | undefined) ?? null,
    nowMs: now.getTime(),
    nowMinutes: centralMinutes(now),
    today: businessDay(now),
    dismissed: new Set((dismissed ?? []).map((d) => `${d.reminder_id}:${d.occurrence}`)),
    names,
    clock,
    shortDay,
  });
}

export async function getShiftStatus(): Promise<ShiftStatus> {
  await assertStaff();
  const supabase = db();
  const today = businessDay();
  // 86'd menu items ride along on this poll so every register greys them out within a minute.
  const outsP = currentOuts();
  const names = await employeeNames();

  const window = businessDayWindow(today.date);
  const [shiftsRes, tasksRes, doneRes, shopping, todosRes, schedRes] = await Promise.all([
    // On shift now: started this business day and not ended. One left open
    // from an earlier day is a forgotten End shift (Team → Timesheets), not
    // someone here now.
    supabase.from("shifts").select("id, employee_id, started_at").is("ended_at", null).gte("started_at", window.start).order("started_at"),
    supabase.from("shift_tasks").select("id, title, details, timing, frequency, days, assignee_id, sort_order").eq("active", true).order("sort_order"),
    supabase.from("task_completions").select("task_id, work_date, completed_by, completed_at").gte("work_date", periodStart(today.date, "weekly") < periodStart(today.date, "monthly") ? periodStart(today.date, "weekly") : periodStart(today.date, "monthly")).order("completed_at", { ascending: false }),
    // The Shopping button's count: the same list the Shopping tab shows.
    buildShoppingList(names, false).catch((e) => {
      console.error("ops: shopping list for the status poll", e);
      return null;
    }),
    // Not the restock to-dos from Ran out: the purchasers are emailed and
    // mark it back in stock in Back office. The register shows a quiet
    // "Out of …" line instead (outNotices).
    supabase.from("staff_todos").select("id, title, details, assignee_id, due_date, created_by, audience, outage_id").is("done_at", null).is("outage_id", null).order("due_date", { ascending: true, nullsFirst: false }).order("created_at"),
    supabase.from("staff_schedule").select("employee_id, starts_at, ends_at").gte("starts_at", window.start).lt("starts_at", window.end).order("starts_at"),
  ]);

  const todos: ShiftTodo[] = (todosRes.data ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    details: t.details,
    assigneeId: t.assignee_id,
    assigneeName: t.assignee_id ? (names.get(t.assignee_id) ?? null) : null,
    dueDate: t.due_date,
    fromName: t.created_by ? (names.get(t.created_by) ?? null) : null,
    // The register shows these only while a manager's using it.
    forManagers: t.audience === "managers",
    outageId: t.outage_id ?? null,
  }));
  const scheduled: Record<string, string> = {};
  for (const s of schedRes.data ?? []) {
    const t = `${clock(s.starts_at)}–${clock(s.ends_at)}`;
    scheduled[s.employee_id] = scheduled[s.employee_id] ? `${scheduled[s.employee_id]}, ${t}` : t;
  }

  const onShift: OnShift[] = (shiftsRes.data ?? []).map((s) => ({
    shiftId: s.id,
    employeeId: s.employee_id,
    name: names.get(s.employee_id) ?? "Someone",
    startedAt: s.started_at,
  }));

  const tasks: TodayTask[] = ((tasksRes.data ?? []) as TaskRow[])
    .filter((t) => t.frequency !== "daily" || !t.days || t.days.length === 0 || t.days.includes(today.dow))
    .map((t) => {
      // Done for today (daily), this week or this month: the latest tick in its period.
      const since = periodStart(today.date, t.frequency);
      const d = (doneRes.data ?? []).find((c) => c.task_id === t.id && (c.work_date as string) >= since);
      return {
        id: t.id,
        title: t.title,
        details: t.details,
        timing: t.timing,
        frequency: t.frequency,
        assigneeName: t.assignee_id ? names.get(t.assignee_id) ?? null : null,
        done: d ? { byName: d.completed_by ? names.get(d.completed_by) ?? null : null, at: d.completed_at } : null,
      };
    });

  const latest = shopping?.counts.at(-1);
  const lastCount: ShiftStatus["lastCount"] = latest
    ? { at: latest.at, byName: latest.byName, today: shopping!.today, below: shopping!.bySource.reduce((n, g) => n + g.lines.length, 0) }
    : null;

  const training = (await trainingDueFor(onShift.map((o) => o.employeeId)).catch(() => [])).map((t) => ({
    employeeId: t.employeeId,
    name: names.get(t.employeeId) ?? "Someone",
    slug: t.slug,
    title: t.title,
    dueDate: t.dueDate,
    overdue: t.overdue,
    updated: t.state === "update",
  }));

  const outs = await outsP;
  return {
    workDate: today.date,
    onShift,
    tasks,
    reminders: await dueReminders(names),
    lastCount,
    todos,
    training,
    scheduled,
    booths: await boothHolds(today.date),
    outs: outs.outs,
    ranOut: outs.open,
    outNotices: outs.notices,
  };
}

// ---------- booths ----------

// Confirmed booth bookings for today and tomorrow. (Booths can't be booked
// same-day, so tomorrow's list is where new bookings show up first.)
async function boothHolds(today: string): Promise<ShiftStatus["booths"]> {
  const next = new Date(`${today}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const tomorrow = next.toISOString().slice(0, 10);
  const { data, error } = await db()
    .from("booth_reservations")
    .select("id, reservation_date, start_time, hours, customer_name, party_size, created_at, card_printed_at, booth:booths(label)")
    .eq("status", "confirmed")
    .in("reservation_date", [today, tomorrow])
    .order("start_time");
  if (error) return { today: [], tomorrow: [] };
  const holds: BoothHold[] = (data ?? []).map((r) => ({
    id: r.id as string,
    booth: ((r.booth as unknown as { label: string } | null)?.label ?? "Booth") as string,
    date: r.reservation_date as string,
    window: boothWindow(r.start_time as string, Number(r.hours)),
    name: r.customer_name as string,
    party: r.party_size as number,
    bookedAt: r.created_at as string,
    isNew: Date.now() - new Date(r.created_at as string).getTime() < 86_400_000,
    cardPrintedAt: (r.card_printed_at as string | null) ?? null,
  }));
  return { today: holds.filter((h) => h.date === today), tomorrow: holds.filter((h) => h.date === tomorrow) };
}

// The Reserved card for a booth was printed (or set out by hand).
export async function markBoothCardPrinted(reservationId: string): Promise<Result> {
  await assertStaff();
  const { error } = await db().from("booth_reservations").update({ card_printed_at: new Date().toISOString() }).eq("id", reservationId);
  return error ? { ok: false, error: "Couldn't save that. Try again." } : { ok: true };
}

// ---------- shifts ----------

// Reuses their open shift only if it started this business day; one left
// open from an earlier day stays open for a manager to fix (see
// src/lib/ops/shifts.ts).
export async function startShift(employeeId: string): Promise<Result<{ shiftId: string }>> {
  await assertStaff();
  const emp = await validEmployee(employeeId);
  if (!emp) return { ok: false, error: "Pick someone from the staff list." };
  const r = await startShiftFor(emp);
  return r.ok ? { ok: true, shiftId: r.shiftId } : r;
}

export async function endShift(shiftId: string, closedForNight: boolean): Promise<Result> {
  await assertStaff();
  const { error } = await db().from("shifts").update({ ended_at: new Date().toISOString(), closed_for_night: closedForNight }).eq("id", shiftId).is("ended_at", null);
  return error ? { ok: false, error: "Couldn't end the shift. Try again." } : { ok: true };
}

// ---------- tasks ----------

// First business date of a task's current period: today (daily), this
// Monday (weekly) or the 1st (monthly).
function periodStart(date: string, frequency: Frequency): string {
  if (frequency === "monthly") return `${date.slice(0, 8)}01`;
  if (frequency === "weekly") {
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return date;
}

export async function setTaskDone(taskId: string, done: boolean, employeeId: string | null, shiftId: string | null): Promise<Result> {
  await assertStaff();
  const supabase = db();
  const date = businessDay().date;
  if (!done) {
    // Undo the tick for its whole period (a weekly task ticked Tuesday, undone Thursday).
    const { data: task } = await supabase.from("shift_tasks").select("frequency").eq("id", taskId).maybeSingle();
    const { error } = await supabase.from("task_completions").delete().eq("task_id", taskId).gte("work_date", periodStart(date, (task?.frequency as Frequency) ?? "daily"));
    return error ? { ok: false, error: "Couldn't undo that. Try again." } : { ok: true };
  }
  const by = await validEmployee(employeeId);
  const { error } = await supabase.from("task_completions").insert({ task_id: taskId, work_date: date, completed_by: by, shift_id: shiftId });
  if (error && error.code !== "23505") return { ok: false, error: "Couldn't save that. Try again." };
  return { ok: true };
}

export async function getTaskRows(): Promise<{ tasks: TaskRow[]; reminders: ReminderRow[]; staff: { id: string; name: string }[] }> {
  await assertStaff();
  const supabase = db();
  const [t, r, e] = await Promise.all([
    supabase.from("shift_tasks").select("id, title, details, timing, frequency, days, assignee_id, sort_order, active").order("sort_order"),
    supabase.from("reminders").select("id, kind, message, minutes, time_of_day, days, assignee_id, active").order("created_at"),
    supabase.from("employees").select("id, name").eq("active", true).neq("role", "display").order("name"),
  ]);
  return { tasks: (t.data ?? []) as TaskRow[], reminders: (r.data ?? []) as ReminderRow[], staff: (e.data ?? []) as { id: string; name: string }[] };
}

export async function saveTask(
  input: { id?: string; title: string; details?: string | null; timing: Timing; frequency?: Frequency; days: number[] | null; assignee_id: string | null },
  employeeId: string | null
): Promise<Result<{ id: string }>> {
  await assertStaff();
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the task a name." };
  if (!["opening", "closing", "anytime"].includes(input.timing)) return { ok: false, error: "Pick when it happens." };
  const by = await validEmployee(employeeId);
  const frequency: Frequency = input.frequency === "weekly" || input.frequency === "monthly" ? input.frequency : "daily";
  // Days only apply to daily tasks; weekly/monthly ones float until done.
  const days = frequency === "daily" && input.days && input.days.length > 0 && input.days.length < 7 ? [...new Set(input.days)].filter((d) => d >= 0 && d <= 6).sort() : null;
  const fields = { title, details: input.details?.trim() || null, timing: input.timing, frequency, days, assignee_id: input.assignee_id || null, updated_by: by, updated_at: new Date().toISOString() };
  const supabase = db();
  if (input.id) {
    const { error } = await supabase.from("shift_tasks").update(fields).eq("id", input.id);
    if (error) return { ok: false, error: "Couldn't save. Try again." };
    await logChange("task", input.id, "changed", `Task "${title}"`, by);
    return { ok: true, id: input.id };
  }
  const { data: last } = await supabase.from("shift_tasks").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const { data, error } = await supabase
    .from("shift_tasks")
    .insert({ ...fields, sort_order: (last?.[0]?.sort_order ?? 0) + 10, created_by: by })
    .select("id")
    .single();
  if (error) return { ok: false, error: "Couldn't add it. Try again." };
  await logChange("task", data.id, "added", `Task "${title}"`, by);
  return { ok: true, id: data.id };
}

export async function setTaskActive(id: string, active: boolean, employeeId: string | null): Promise<Result> {
  await assertStaff();
  const by = await validEmployee(employeeId);
  const { data, error } = await db().from("shift_tasks").update({ active, updated_by: by, updated_at: new Date().toISOString() }).eq("id", id).select("title").single();
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  await logChange("task", id, active ? "restored" : "removed", `Task "${data.title}"`, by);
  return { ok: true };
}

// ---------- reminders ----------

export async function dismissReminder(reminderId: string, occurrence: string, employeeId: string | null): Promise<Result> {
  await assertStaff();
  const by = await validEmployee(employeeId);
  const { error } = await db().from("reminder_dismissals").insert({ reminder_id: reminderId, occurrence, dismissed_by: by });
  if (error && error.code !== "23505") return { ok: false, error: "Couldn't save. Try again." };
  return { ok: true };
}

export async function saveReminder(
  input: { id?: string; kind: ReminderKind; message: string; minutes: number | null; time_of_day: string | null; days: number[] | null; assignee_id: string | null },
  employeeId: string | null
): Promise<Result<{ id: string }>> {
  await assertStaff();
  const message = input.message.trim();
  if (!message) return { ok: false, error: "Write what the reminder should say." };
  if (!["before_screening", "daily", "schedule_low"].includes(input.kind)) return { ok: false, error: "Pick a kind of reminder." };
  if (input.kind !== "daily" && !(input.minutes && input.minutes > 0 && input.minutes <= 240)) {
    return { ok: false, error: input.kind === "before_screening" ? "Minutes before showtime should be 1 to 240." : "Days should be 1 to 240." };
  }
  if (input.kind === "daily" && !/^\d{2}:\d{2}/.test(input.time_of_day ?? "")) return { ok: false, error: "Pick a time of day." };
  const by = await validEmployee(employeeId);
  const days = input.days && input.days.length > 0 && input.days.length < 7 ? [...new Set(input.days)].sort() : null;
  const fields = {
    kind: input.kind,
    message,
    minutes: input.kind === "daily" ? null : input.minutes,
    time_of_day: input.kind === "daily" ? input.time_of_day : null,
    days: input.kind === "daily" ? days : null,
    assignee_id: input.assignee_id || null,
    updated_by: by,
    updated_at: new Date().toISOString(),
  };
  const supabase = db();
  if (input.id) {
    const { error } = await supabase.from("reminders").update(fields).eq("id", input.id);
    if (error) return { ok: false, error: "Couldn't save. Try again." };
    await logChange("reminder", input.id, "changed", `Reminder "${message}"`, by);
    return { ok: true, id: input.id };
  }
  const { data, error } = await supabase.from("reminders").insert({ ...fields, created_by: by }).select("id").single();
  if (error) return { ok: false, error: "Couldn't add it. Try again." };
  await logChange("reminder", data.id, "added", `Reminder "${message}"`, by);
  return { ok: true, id: data.id };
}

export async function setReminderActive(id: string, active: boolean, employeeId: string | null): Promise<Result> {
  await assertStaff();
  const by = await validEmployee(employeeId);
  const { data, error } = await db().from("reminders").update({ active, updated_by: by, updated_at: new Date().toISOString() }).eq("id", id).select("message").single();
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  await logChange("reminder", id, active ? "restored" : "removed", `Reminder "${data.message}"`, by);
  return { ok: true };
}

// ---------- par sheet ----------

const PAR_ITEM_COLUMNS = "id, area, section, name, par_qty, unit, unit_size, count_step, source, sort_order, active";

function toParItem(i: Record<string, unknown>): ParItem {
  return {
    ...(i as unknown as ParItem),
    par_qty: i.par_qty === null ? null : Number(i.par_qty),
    count_step: i.count_step === null || i.count_step === undefined ? null : Number(i.count_step),
    unit_size: (i.unit_size as string | null) ?? null,
  };
}

// In par sheet order: sheets in the order the count shows them (by their
// first line), then each sheet's own order.
async function parItems(): Promise<ParItem[]> {
  const { data, error } = await db().from("par_items").select(PAR_ITEM_COLUMNS).order("sort_order");
  if (error) throw new Error(`Couldn't read the par sheet: ${error.message}`);
  const items = (data ?? []).map(toParItem);
  const sheets = [...new Set(items.map((i) => i.area))];
  return items.sort((a, b) => sheets.indexOf(a.area) - sheets.indexOf(b.area) || a.sort_order - b.sort_order);
}

// `last`: each item's latest count, whichever save it was in.
export async function getParSheet(): Promise<{ items: ParItem[]; last: Record<string, { qty: number; at: string }>; outs: Record<string, string> }> {
  await assertStaff();
  const [items, latest, { data: open }] = await Promise.all([
    parItems(),
    latestLines(),
    // Lines reported out ("Ran out"), shown as a hint while counting.
    db().from("stock_outages").select("par_item_id, reported_at").is("resolved_at", null).not("par_item_id", "is", null),
  ]);
  const last: Record<string, { qty: number; at: string }> = {};
  for (const l of latest.values()) last[l.itemId] = { qty: l.qty, at: l.at };
  const outs: Record<string, string> = {};
  for (const o of open ?? []) outs[o.par_item_id as string] = o.reported_at as string;
  return { items, last, outs };
}

export async function submitParCount(lines: { itemId: string; qty: number }[], employeeId: string | null, shiftId: string | null): Promise<Result<{ countId: string }>> {
  await assertStaff();
  const clean = lines.filter((l) => Number.isFinite(l.qty) && l.qty >= 0 && l.qty < 100000);
  if (clean.length === 0) return { ok: false, error: "Count at least one item first." };
  const supabase = db();
  const by = await validEmployee(employeeId);
  const { data: items } = await supabase.from("par_items").select("id, par_qty").in("id", clean.map((l) => l.itemId));
  const par = new Map((items ?? []).map((i) => [i.id as string, i.par_qty === null ? null : Number(i.par_qty)]));
  const { data: count, error } = await supabase.from("par_counts").insert({ counted_by: by, shift_id: shiftId }).select("id").single();
  if (error) return { ok: false, error: "Couldn't save the count. Try again." };
  const { error: lineErr } = await supabase
    .from("par_count_lines")
    .insert(clean.filter((l) => par.has(l.itemId)).map((l) => ({ count_id: count.id, item_id: l.itemId, qty: l.qty, par_qty: par.get(l.itemId) ?? null })));
  if (lineErr) {
    await supabase.from("par_counts").delete().eq("id", count.id);
    return { ok: false, error: "Couldn't save the count. Try again." };
  }
  return { ok: true, countId: count.id };
}

// Everything under par, merged across every count saved this business day
// (each item's latest line today; with nothing counted today, each item's
// latest line ever), grouped by where it's bought.
export async function getShoppingList(): Promise<ShoppingList | null> {
  await assertStaff();
  return buildShoppingList(await employeeNames(), true);
}

const NO_STORE = "No store listed";

async function buildShoppingList(names: Map<string, string>, withLastAt: boolean): Promise<ShoppingList | null> {
  const supabase = db();
  const cur = await currentLines();
  if (!cur.lines.size) return null;
  const earliest = new Date(Math.min(...[...cur.lines.values()].map((l) => Date.parse(l.at)))).toISOString();
  // Lines reported "Ran out" are listed on their own above this list while
  // open, and once bought (or found) after they were counted they're
  // stocked again.
  const [items, { data: open }, { data: restocked }, before] = await Promise.all([
    parItems(),
    supabase.from("stock_outages").select("par_item_id").is("resolved_at", null).not("par_item_id", "is", null),
    supabase.from("stock_outages").select("par_item_id, resolved_at").gte("resolved_at", earliest).in("resolution", ["bought", "found"]).not("par_item_id", "is", null),
    // For "Not counted today": when each of those was last counted.
    withLastAt && cur.today ? latestLines({ before: cur.start }) : Promise.resolve(null),
  ]);
  const openIds = new Set((open ?? []).map((o) => o.par_item_id as string));
  const restockedAt = new Map<string, number>();
  for (const r of restocked ?? []) {
    const t = Date.parse(r.resolved_at as string);
    restockedAt.set(r.par_item_id as string, Math.max(t, restockedAt.get(r.par_item_id as string) ?? 0));
  }

  const groups = new Map<string, ShoppingLine[]>();
  const notCounted: ShoppingList["notCounted"] = [];
  for (const item of items) {
    const l = cur.lines.get(item.id);
    if (!l) {
      if (item.active) notCounted.push({ itemId: item.id, name: item.name, area: item.area, section: item.section, lastAt: before?.get(item.id)?.at ?? null });
      continue;
    }
    // Taken off the sheet since: not something to buy.
    if (!item.active || l.par === null || l.qty >= l.par) continue;
    if (openIds.has(item.id) || (restockedAt.get(item.id) ?? 0) >= Date.parse(l.at)) continue;
    const need = Math.round((l.par - l.qty) * 100) / 100;
    const source = item.source || NO_STORE;
    groups.set(source, [
      ...(groups.get(source) ?? []),
      { itemId: item.id, name: item.name, area: item.area, have: l.qty, par: l.par, unit: item.unit, unitSize: item.unit_size, need, buy: buyQty(need), countedAt: l.at },
    ]);
  }
  return {
    today: cur.today,
    counts: countsOf(cur.lines.values(), names),
    bySource: [...groups.entries()]
      .sort((a, b) => (a[0] === NO_STORE ? 1 : b[0] === NO_STORE ? -1 : a[0].localeCompare(b[0])))
      .map(([source, lines]) => ({ source, lines })),
    notCounted,
  };
}

// "Since the last count": everything counted today (or, before anyone's
// counted today, on the latest day with a count) against each line's latest
// count before that day. Biggest drop first, for spotting heavy use, waste
// or theft.
export async function getCountComparison(): Promise<CountComparison | null> {
  await assertStaff();
  const today = businessDay().date;
  let date = today;
  let win = businessDayWindow(date);
  let now = await latestLines({ since: win.start, before: win.end });
  if (!now.size) {
    const { data } = await db().from("par_counts").select("completed_at").order("completed_at", { ascending: false }).limit(1);
    const at = data?.[0]?.completed_at as string | undefined;
    if (!at) return null;
    date = businessDay(new Date(at)).date;
    win = businessDayWindow(date);
    now = await latestLines({ since: win.start, before: win.end });
  }
  const [prev, items, names] = await Promise.all([latestLines({ before: win.start }), parItems(), employeeNames()]);
  const who = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  const order = new Map(items.map((i, idx) => [i.id, idx]));
  const rows: CountChange[] = [];
  for (const item of items) {
    const l = now.get(item.id);
    if (!l) continue;
    const p = prev.get(item.id);
    rows.push({
      itemId: item.id,
      name: item.name,
      area: item.area,
      section: item.section,
      unit: item.unit,
      unitSize: item.unit_size,
      par: item.par_qty,
      now: { qty: l.qty, at: l.at, byName: who(l.by) },
      prev: p ? { qty: p.qty, at: p.at, byName: who(p.by) } : null,
      diff: p ? Math.round((l.qty - p.qty) * 100) / 100 : null,
    });
  }
  // Drops (biggest first), then restocks (biggest first), then no change,
  // then first counts; ties in par sheet order.
  const rank = (r: CountChange) => (r.diff === null ? 3 : r.diff < 0 ? 0 : r.diff > 0 ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || Math.abs(b.diff ?? 0) - Math.abs(a.diff ?? 0) || (order.get(a.itemId) ?? 0) - (order.get(b.itemId) ?? 0));
  return { date, today: date === today, counts: countsOf(now.values(), names), rows };
}

export async function saveParItem(
  input: {
    id?: string;
    area: string;
    section: string | null;
    name: string;
    par_qty: number | null;
    unit: string | null;
    unit_size?: string | null;
    count_step?: number | null;
    source: string | null;
  },
  employeeId: string | null
): Promise<Result<{ id: string }>> {
  await assertStaff();
  const name = input.name.trim();
  const area = input.area.trim();
  if (!name) return { ok: false, error: "Give the item a name." };
  if (!area) return { ok: false, error: "Pick which sheet it goes on." };
  if (input.par_qty !== null && !(input.par_qty >= 0 && input.par_qty < 100000)) return { ok: false, error: "Par should be a number, like 1 or 0.5." };
  const step = input.count_step ?? null;
  if (step !== null && step !== 0.25 && step !== 0.5 && step !== 1) return { ok: false, error: "Pick how it's counted: whole, halves, quarters or automatic." };
  const unitSize = typeof input.unit_size === "string" ? input.unit_size.replace(/\s+/g, " ").trim() : "";
  if (unitSize.length > 40) return { ok: false, error: "Keep the size short, like 750 ml or 12.5 lb." };
  const by = await validEmployee(employeeId);
  const fields = {
    area,
    section: input.section?.trim() || null,
    name,
    par_qty: input.par_qty,
    unit: input.unit?.trim() || null,
    unit_size: unitSize || null,
    count_step: step,
    source: input.source?.trim() || null,
    updated_by: by,
    updated_at: new Date().toISOString(),
  };
  const supabase = db();
  if (input.id) {
    const { error } = await supabase.from("par_items").update(fields).eq("id", input.id);
    if (error) return { ok: false, error: "Couldn't save. Try again." };
    await logChange("par_item", input.id, "changed", `Par item "${name}" (${area})`, by);
    return { ok: true, id: input.id };
  }
  // New items go to the end of their section (or sheet).
  const q = supabase.from("par_items").select("sort_order").eq("area", area).order("sort_order", { ascending: false }).limit(1);
  const { data: last } = fields.section ? await q.eq("section", fields.section) : await q;
  const { data, error } = await supabase
    .from("par_items")
    .insert({ ...fields, sort_order: (last?.[0]?.sort_order ?? 0) + 1, created_by: by })
    .select("id")
    .single();
  if (error) return { ok: false, error: "Couldn't add it. Try again." };
  await logChange("par_item", data.id, "added", `Par item "${name}" (${area})`, by);
  return { ok: true, id: data.id };
}

export async function setParItemActive(id: string, active: boolean, employeeId: string | null): Promise<Result> {
  await assertStaff();
  const by = await validEmployee(employeeId);
  const { data, error } = await db().from("par_items").update({ active, updated_by: by, updated_at: new Date().toISOString() }).eq("id", id).select("name, area").single();
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  await logChange("par_item", id, active ? "restored" : "removed", `Par item "${data.name}" (${data.area})`, by);
  return { ok: true };
}

// ---------- history ----------

export interface OpsHistory {
  dates: string[];
  tasks: { id: string; title: string; timing: Timing; active: boolean }[];
  ticks: { taskId: string; date: string; byName: string | null }[];
  totals: { name: string; count: number }[];
  counts: { id: string; at: string; byName: string | null; items: number; below: number }[];
  changes: { at: string; byName: string | null; entity: string; action: string; summary: string }[];
}

export async function getOpsHistory(days = 7): Promise<OpsHistory> {
  await assertStaff();
  const supabase = db();
  const dates = recentBusinessDays(days);
  const names = await employeeNames();
  const [tasks, ticks, counts, changes] = await Promise.all([
    supabase.from("shift_tasks").select("id, title, timing, active").order("sort_order"),
    supabase.from("task_completions").select("task_id, work_date, completed_by").in("work_date", dates),
    supabase.from("par_counts").select("id, completed_at, counted_by, lines:par_count_lines(qty, par_qty)").order("completed_at", { ascending: false }).limit(10),
    supabase.from("ops_changes").select("changed_at, changed_by, entity, action, summary").order("changed_at", { ascending: false }).limit(25),
  ]);
  const tally = new Map<string, number>();
  for (const t of ticks.data ?? []) {
    const n = t.completed_by ? names.get(t.completed_by) ?? "Someone" : "Someone";
    tally.set(n, (tally.get(n) ?? 0) + 1);
  }
  const tickedTaskIds = new Set((ticks.data ?? []).map((t) => t.task_id));
  return {
    dates,
    tasks: ((tasks.data ?? []) as OpsHistory["tasks"]).filter((t) => t.active || tickedTaskIds.has(t.id)),
    ticks: (ticks.data ?? []).map((t) => ({ taskId: t.task_id, date: t.work_date, byName: t.completed_by ? names.get(t.completed_by) ?? null : null })),
    totals: [...tally.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    counts: (counts.data ?? []).map((c) => {
      const lines = (c.lines ?? []) as { qty: number; par_qty: number | null }[];
      return {
        id: c.id,
        at: c.completed_at,
        byName: c.counted_by ? names.get(c.counted_by) ?? null : null,
        items: lines.length,
        below: lines.filter((l) => l.par_qty !== null && Number(l.qty) < Number(l.par_qty)).length,
      };
    }),
    changes: (changes.data ?? []).map((c) => ({ at: c.changed_at, byName: c.changed_by ? names.get(c.changed_by) ?? null : null, entity: c.entity, action: c.action, summary: c.summary })),
  };
}

// ---------- to-dos from Back office → Team ----------

const TODO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Done. A restock to-do from "Ran out" means it was bought: its report
// closes as bought and what it stopped goes back on sale (`restock`).
export async function setTodoDone(todoId: string, employeeId: string | null): Promise<Result<{ restock: { what: string; back: string[] } | null }>> {
  await assertStaff();
  if (typeof todoId !== "string" || !TODO_ID.test(todoId)) return { ok: false, error: "That to-do didn't come through. Try again." };
  return finishTodo(todoId.toLowerCase(), await validEmployee(employeeId));
}

// Undo, for an ordinary to-do (a restock to-do closed with its report).
export async function undoTodoDone(todoId: string): Promise<Result> {
  await assertStaff();
  if (typeof todoId !== "string" || !TODO_ID.test(todoId)) return { ok: false, error: "That to-do didn't come through. Try again." };
  return reopenTodo(todoId.toLowerCase());
}
