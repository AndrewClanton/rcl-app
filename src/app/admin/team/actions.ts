"use server";

import { revalidatePath } from "next/cache";
import { assertManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { centralToIso } from "@/lib/ops/time";

type Result = { ok: true } | { ok: false; error: string };

function revalidate() {
  revalidatePath("/admin/team");
  revalidatePath("/pos");
}

// ---------- to-dos ----------

export async function addTodo(input: { title: string; details: string; assigneeId: string; dueDate: string }): Promise<Result> {
  const staff = await assertManager();
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Write what needs doing." };
  if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) return { ok: false, error: "That due date doesn't look right." };
  const { error } = await createAdminClient()
    .from("staff_todos")
    .insert({ title, details: input.details.trim() || null, assignee_id: input.assigneeId || null, due_date: input.dueDate || null, created_by: staff.employeeId });
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  revalidate();
  return { ok: true };
}

export async function setTodoDoneFromOffice(id: string, done: boolean): Promise<Result> {
  const staff = await assertManager();
  await createAdminClient()
    .from("staff_todos")
    .update(done ? { done_at: new Date().toISOString(), done_by: staff.employeeId } : { done_at: null, done_by: null })
    .eq("id", id);
  revalidate();
  return { ok: true };
}

export async function deleteTodo(id: string): Promise<Result> {
  await assertManager();
  await createAdminClient().from("staff_todos").delete().eq("id", id);
  revalidate();
  return { ok: true };
}

// ---------- schedule ----------

export async function addScheduledShift(input: { employeeId: string; date: string; start: string; end: string; note: string }): Promise<Result> {
  const staff = await assertManager();
  if (!input.employeeId) return { ok: false, error: "Pick who's working." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{1,2}:\d{2}$/.test(input.start) || !/^\d{1,2}:\d{2}$/.test(input.end)) return { ok: false, error: "Pick a day, a start and an end time." };
  const startsAt = centralToIso(input.date, input.start);
  let endsAt = centralToIso(input.date, input.end);
  // Ends after midnight (a closing shift): the next day.
  if (endsAt <= startsAt) endsAt = new Date(new Date(endsAt).getTime() + 86_400_000).toISOString();
  const { error } = await createAdminClient()
    .from("staff_schedule")
    .insert({ employee_id: input.employeeId, starts_at: startsAt, ends_at: endsAt, note: input.note.trim() || null, created_by: staff.employeeId });
  if (error) return { ok: false, error: error.code === "23505" ? "They're already scheduled to start then." : "Couldn't save that shift. Try again." };
  revalidate();
  return { ok: true };
}

// Removed, not erased: the record stays (who removed it and when) and Undo
// brings it back.
export async function deleteScheduledShift(id: string): Promise<Result> {
  const staff = await assertManager();
  await createAdminClient().from("staff_schedule").update({ deleted_at: new Date().toISOString(), deleted_by: staff.employeeId }).eq("id", id);
  revalidate();
  return { ok: true };
}

export async function restoreScheduledShift(id: string): Promise<Result> {
  await assertManager();
  const { error } = await createAdminClient().from("staff_schedule").update({ deleted_at: null, deleted_by: null }).eq("id", id);
  revalidate();
  return error ? { ok: false, error: "Couldn't bring it back: that person already has a shift starting then." } : { ok: true };
}

// Copies every shift from one week onto the next (same days and times), for
// a schedule that mostly repeats.
export async function copyWeekForward(weekStart: string): Promise<Result & { copied?: number; skipped?: number }> {
  const staff = await assertManager();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return { ok: false, error: "Pick a week." };
  const supabase = createAdminClient();
  const from = centralToIso(weekStart, "04:00");
  const to = new Date(new Date(from).getTime() + 7 * 86_400_000).toISOString();
  const { data } = await supabase.from("staff_schedule").select("employee_id, starts_at, ends_at, note").is("deleted_at", null).gte("starts_at", from).lt("starts_at", to);
  if (!data?.length) return { ok: false, error: "There's nothing on this week to copy." };
  const week = 7 * 86_400_000;
  // Same wall-clock times next week, even across a daylight-saving change.
  const shift = (iso: string) => {
    const d = new Date(new Date(iso).getTime() + week);
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    const date = new Date(`${get("year")}-${get("month")}-${get("day")}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 7);
    return centralToIso(date.toISOString().slice(0, 10), `${get("hour")}:${get("minute")}`) || d.toISOString();
  };
  // Skip anything already on next week, so copying twice can't double it.
  const next = data.map((s) => ({ employee_id: s.employee_id, starts_at: shift(s.starts_at), ends_at: shift(s.ends_at), note: s.note, created_by: staff.employeeId }));
  const { data: existing } = await supabase
    .from("staff_schedule")
    .select("employee_id, starts_at")
    .is("deleted_at", null)
    .gte("starts_at", to)
    .lt("starts_at", new Date(new Date(to).getTime() + 7 * 86_400_000).toISOString());
  const taken = new Set((existing ?? []).map((e) => `${e.employee_id}|${new Date(e.starts_at).getTime()}`));
  const fresh = next.filter((s) => !taken.has(`${s.employee_id}|${new Date(s.starts_at).getTime()}`));
  if (fresh.length) {
    const { error } = await supabase.from("staff_schedule").insert(fresh);
    if (error) return { ok: false, error: "Couldn't copy the week. Try again." };
  }
  revalidate();
  return { ok: true, copied: fresh.length, skipped: next.length - fresh.length };
}
