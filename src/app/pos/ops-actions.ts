"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { assertStaff } from "@/lib/auth";
import { businessDay, centralMinutes, clock, recentBusinessDays, shortDay } from "@/lib/ops/time";
import { evaluateReminders } from "@/lib/ops/reminders";
import type {
  DueReminder,
  OnShift,
  ParItem,
  ReminderKind,
  ReminderRow,
  Result,
  ShiftStatus,
  ShoppingList,
  TaskRow,
  Timing,
  TodayTask,
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

async function logChange(entity: "task" | "par_item" | "reminder", entityId: string | null, action: "added" | "changed" | "removed" | "restored", summary: string, by: string | null) {
  await db().from("ops_changes").insert({ entity, entity_id: entityId, action, summary, changed_by: by });
}

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
  const names = await employeeNames();

  const [shiftsRes, tasksRes, doneRes, countRes] = await Promise.all([
    supabase.from("shifts").select("id, employee_id, started_at").is("ended_at", null).order("started_at"),
    supabase.from("shift_tasks").select("id, title, details, timing, days, assignee_id, sort_order").eq("active", true).order("sort_order"),
    supabase.from("task_completions").select("task_id, completed_by, completed_at").eq("work_date", today.date),
    supabase.from("par_counts").select("id, completed_at, counted_by").order("completed_at", { ascending: false }).limit(1),
  ]);

  const onShift: OnShift[] = (shiftsRes.data ?? []).map((s) => ({
    shiftId: s.id,
    employeeId: s.employee_id,
    name: names.get(s.employee_id) ?? "Someone",
    startedAt: s.started_at,
  }));

  const done = new Map((doneRes.data ?? []).map((d) => [d.task_id as string, d]));
  const tasks: TodayTask[] = ((tasksRes.data ?? []) as TaskRow[])
    .filter((t) => !t.days || t.days.length === 0 || t.days.includes(today.dow))
    .map((t) => {
      const d = done.get(t.id);
      return {
        id: t.id,
        title: t.title,
        details: t.details,
        timing: t.timing,
        assigneeName: t.assignee_id ? names.get(t.assignee_id) ?? null : null,
        done: d ? { byName: d.completed_by ? names.get(d.completed_by) ?? null : null, at: d.completed_at } : null,
      };
    });

  let lastCount: ShiftStatus["lastCount"] = null;
  const c = countRes.data?.[0];
  if (c) {
    const { data: lines } = await supabase.from("par_count_lines").select("qty, par_qty").eq("count_id", c.id);
    const below = (lines ?? []).filter((l) => l.par_qty !== null && Number(l.qty) < Number(l.par_qty)).length;
    lastCount = { id: c.id, at: c.completed_at, byName: c.counted_by ? names.get(c.counted_by) ?? null : null, below };
  }

  return { workDate: today.date, onShift, tasks, reminders: await dueReminders(names), lastCount };
}

// ---------- shifts ----------

export async function startShift(employeeId: string): Promise<Result<{ shiftId: string }>> {
  await assertStaff();
  const emp = await validEmployee(employeeId);
  if (!emp) return { ok: false, error: "Pick someone from the staff list." };
  const { data: open } = await db().from("shifts").select("id").eq("employee_id", emp).is("ended_at", null).maybeSingle();
  if (open) return { ok: true, shiftId: open.id };
  const { data, error } = await db().from("shifts").insert({ employee_id: emp }).select("id").single();
  if (error) return { ok: false, error: "Couldn't start the shift. Try again." };
  return { ok: true, shiftId: data.id };
}

export async function endShift(shiftId: string, closedForNight: boolean): Promise<Result> {
  await assertStaff();
  const { error } = await db().from("shifts").update({ ended_at: new Date().toISOString(), closed_for_night: closedForNight }).eq("id", shiftId).is("ended_at", null);
  return error ? { ok: false, error: "Couldn't end the shift. Try again." } : { ok: true };
}

// ---------- tasks ----------

export async function setTaskDone(taskId: string, done: boolean, employeeId: string | null, shiftId: string | null): Promise<Result> {
  await assertStaff();
  const supabase = db();
  const date = businessDay().date;
  if (!done) {
    const { error } = await supabase.from("task_completions").delete().eq("task_id", taskId).eq("work_date", date);
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
    supabase.from("shift_tasks").select("id, title, details, timing, days, assignee_id, sort_order, active").order("sort_order"),
    supabase.from("reminders").select("id, kind, message, minutes, time_of_day, days, assignee_id, active").order("created_at"),
    supabase.from("employees").select("id, name").eq("active", true).neq("role", "display").order("name"),
  ]);
  return { tasks: (t.data ?? []) as TaskRow[], reminders: (r.data ?? []) as ReminderRow[], staff: (e.data ?? []) as { id: string; name: string }[] };
}

export async function saveTask(
  input: { id?: string; title: string; details?: string | null; timing: Timing; days: number[] | null; assignee_id: string | null },
  employeeId: string | null
): Promise<Result<{ id: string }>> {
  await assertStaff();
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Give the task a name." };
  if (!["opening", "closing", "anytime"].includes(input.timing)) return { ok: false, error: "Pick when it happens." };
  const by = await validEmployee(employeeId);
  const days = input.days && input.days.length > 0 && input.days.length < 7 ? [...new Set(input.days)].filter((d) => d >= 0 && d <= 6).sort() : null;
  const fields = { title, details: input.details?.trim() || null, timing: input.timing, days, assignee_id: input.assignee_id || null, updated_by: by, updated_at: new Date().toISOString() };
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

export async function getParSheet(): Promise<{ items: ParItem[]; last: Record<string, number>; lastAt: string | null }> {
  await assertStaff();
  const supabase = db();
  const { data: items } = await supabase.from("par_items").select("id, area, section, name, par_qty, unit, source, sort_order, active").order("sort_order");
  const { data: lastCount } = await supabase.from("par_counts").select("id, completed_at").order("completed_at", { ascending: false }).limit(1);
  const last: Record<string, number> = {};
  if (lastCount?.[0]) {
    const { data: lines } = await supabase.from("par_count_lines").select("item_id, qty").eq("count_id", lastCount[0].id);
    for (const l of lines ?? []) last[l.item_id] = Number(l.qty);
  }
  return {
    items: (items ?? []).map((i) => ({ ...i, par_qty: i.par_qty === null ? null : Number(i.par_qty) })) as ParItem[],
    last,
    lastAt: lastCount?.[0]?.completed_at ?? null,
  };
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

export async function getShoppingList(countId?: string): Promise<ShoppingList | null> {
  await assertStaff();
  const supabase = db();
  let id = countId;
  if (!id) {
    const { data } = await supabase.from("par_counts").select("id").order("completed_at", { ascending: false }).limit(1);
    id = data?.[0]?.id;
  }
  if (!id) return null;
  const [{ data: count }, { data: lines }, names] = await Promise.all([
    supabase.from("par_counts").select("id, completed_at, counted_by").eq("id", id).single(),
    supabase.from("par_count_lines").select("qty, par_qty, item:par_items(id, name, area, unit, source, sort_order)").eq("count_id", id),
    employeeNames(),
  ]);
  if (!count) return null;
  const groups = new Map<string, ShoppingList["bySource"][number]["lines"]>();
  type Line = { qty: number; par_qty: number | null; item: { id: string; name: string; area: string; unit: string | null; source: string | null; sort_order: number } };
  const below = ((lines ?? []) as unknown as Line[])
    .filter((l) => l.item && l.par_qty !== null && Number(l.qty) < Number(l.par_qty))
    .sort((a, b) => a.item.sort_order - b.item.sort_order);
  for (const l of below) {
    const source = l.item.source || "No store listed";
    const list = groups.get(source) ?? [];
    list.push({
      itemId: l.item.id,
      name: l.item.name,
      area: l.item.area,
      have: Number(l.qty),
      par: Number(l.par_qty),
      unit: l.item.unit,
      need: Math.round((Number(l.par_qty) - Number(l.qty)) * 100) / 100,
    });
    groups.set(source, list);
  }
  return {
    countId: count.id,
    at: count.completed_at,
    byName: count.counted_by ? names.get(count.counted_by) ?? null : null,
    bySource: [...groups.entries()]
      .sort((a, b) => (a[0] === "No store listed" ? 1 : b[0] === "No store listed" ? -1 : a[0].localeCompare(b[0])))
      .map(([source, lines]) => ({ source, lines })),
  };
}

export async function saveParItem(
  input: { id?: string; area: string; section: string | null; name: string; par_qty: number | null; unit: string | null; source: string | null },
  employeeId: string | null
): Promise<Result<{ id: string }>> {
  await assertStaff();
  const name = input.name.trim();
  const area = input.area.trim();
  if (!name) return { ok: false, error: "Give the item a name." };
  if (!area) return { ok: false, error: "Pick which sheet it goes on." };
  if (input.par_qty !== null && !(input.par_qty >= 0 && input.par_qty < 100000)) return { ok: false, error: "Par should be a number, like 1 or 0.5." };
  const by = await validEmployee(employeeId);
  const fields = {
    area,
    section: input.section?.trim() || null,
    name,
    par_qty: input.par_qty,
    unit: input.unit?.trim() || null,
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
  changes: { at: string; byName: string | null; action: string; summary: string }[];
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
    supabase.from("ops_changes").select("changed_at, changed_by, action, summary").order("changed_at", { ascending: false }).limit(25),
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
    changes: (changes.data ?? []).map((c) => ({ at: c.changed_at, byName: c.changed_by ? names.get(c.changed_by) ?? null : null, action: c.action, summary: c.summary })),
  };
}
