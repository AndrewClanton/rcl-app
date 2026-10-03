"use server";

import { revalidatePath } from "next/cache";
import { assertManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay, centralToIso, shiftDate } from "@/lib/ops/time";
import { finishTodo, removeTodo, reopenTodo } from "@/lib/ops/outages";
import { centralLocal } from "@/lib/hours";

type Result = { ok: true } | { ok: false; error: string };

function revalidate() {
  revalidatePath("/admin/team");
  revalidatePath("/pos");
}

// ---------- fixing a clock-in or clock-out ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;
const MAX_SHIFT_MS = 24 * 3_600_000;

// A forgotten End shift, or times that were plainly wrong. Times come in as
// Central wall-clock "2026-09-28T23:00" (the picker's format); an empty
// clock-out leaves someone who's on right now still on. Every fix needs a
// reason, is marked on the shift, and is kept (before and after) in
// shift_edits.
export async function editShiftTimes(input: { shiftId: string; clockIn: string; clockOut: string; note: string }): Promise<Result> {
  const staff = await assertManager();
  if (!input || typeof input.shiftId !== "string" || !UUID.test(input.shiftId)) return { ok: false, error: "That shift isn't there any more. Reload the page." };
  if (typeof input.clockIn !== "string" || typeof input.clockOut !== "string" || typeof input.note !== "string") return { ok: false, error: "Pick the times and say why." };
  const note = input.note.trim().replace(/\s+/g, " ");
  if (note.length < 3) return { ok: false, error: "Say why you're changing it, in a few words." };
  if (note.length > 200) return { ok: false, error: "Keep the reason under 200 characters." };

  const supabase = createAdminClient();
  const { data: shift } = await supabase.from("shifts").select("id, employee_id, started_at, ended_at").eq("id", input.shiftId).maybeSingle();
  if (!shift) return { ok: false, error: "That shift isn't there any more. Reload the page." };

  const toIso = (v: string) => {
    const m = LOCAL.exec(v);
    if (!m || Number(m[2].slice(0, 2)) > 23 || Number(m[2].slice(3)) > 59) return null;
    try {
      const iso = centralToIso(m[1], m[2]);
      // A day that doesn't exist (Feb 31) rolls over; don't accept it.
      return centralLocal(iso).slice(0, 10) === m[1] ? iso : null;
    } catch {
      return null;
    }
  };
  // A time left as it was keeps its seconds, so an untouched clock-in still
  // lines up exactly with the shift before it.
  const clockIn = input.clockIn === centralLocal(shift.started_at) ? shift.started_at : toIso(input.clockIn);
  if (!clockIn) return { ok: false, error: "Pick the clock-in day and time." };
  let clockOut: string | null = null;
  if (input.clockOut === "") {
    if (shift.ended_at) return { ok: false, error: "Pick the clock-out day and time." };
    if (businessDay(new Date(clockIn)).date !== businessDay().date) return { ok: false, error: "They never clocked out. Pick when they left." };
  } else {
    clockOut = shift.ended_at && input.clockOut === centralLocal(shift.ended_at) ? shift.ended_at : toIso(input.clockOut);
    if (!clockOut) return { ok: false, error: "Pick the clock-out day and time." };
  }

  const now = Date.now();
  const inMs = new Date(clockIn).getTime();
  const outMs = clockOut ? new Date(clockOut).getTime() : null;
  if (inMs > now + 60_000) return { ok: false, error: "The clock-in can't be in the future." };
  if (outMs !== null) {
    if (outMs > now + 60_000) return { ok: false, error: "The clock-out can't be in the future." };
    if (outMs <= inMs) return { ok: false, error: "The clock-out has to be after the clock-in." };
    if (outMs - inMs > MAX_SHIFT_MS) return { ok: false, error: "That's more than 24 hours. Check the days." };
  }
  if (inMs === new Date(shift.started_at).getTime() && (outMs ?? null) === (shift.ended_at ? new Date(shift.ended_at).getTime() : null)) {
    return { ok: false, error: "Those are the times it already has." };
  }

  // Not on top of another of their shifts (a minute's slack for back-to-back ones).
  const { data: theirs } = await supabase
    .from("shifts")
    .select("id, started_at, ended_at")
    .eq("employee_id", shift.employee_id)
    .neq("id", shift.id)
    .gte("started_at", new Date(inMs - 2 * MAX_SHIFT_MS).toISOString())
    .lte("started_at", new Date((outMs ?? now) + MAX_SHIFT_MS).toISOString());
  const clash = (theirs ?? []).find((o) => {
    const s = new Date(o.started_at).getTime();
    const e = o.ended_at ? new Date(o.ended_at).getTime() : now;
    return s < (outMs ?? now) - 60_000 && e > inMs + 60_000;
  });
  if (clash) return { ok: false, error: "That runs into another of their shifts. Fix that one first, or pick other times." };

  // The record first, so a fix can't land without one.
  const { data: log, error: logError } = await supabase
    .from("shift_edits")
    .insert({ shift_id: shift.id, edited_by: staff.employeeId, note, old_started_at: shift.started_at, old_ended_at: shift.ended_at, new_started_at: clockIn, new_ended_at: clockOut })
    .select("id")
    .single();
  if (logError || !log) return { ok: false, error: "Couldn't save that. Try again." };

  // Only if nobody changed it meanwhile (they clocked out on the register, or another fix).
  let update = supabase
    .from("shifts")
    .update({ started_at: clockIn, ended_at: clockOut, edited_by: staff.employeeId, edited_at: new Date(now).toISOString(), edit_note: note })
    .eq("id", shift.id)
    .eq("started_at", shift.started_at);
  update = shift.ended_at ? update.eq("ended_at", shift.ended_at) : update.is("ended_at", null);
  const { data: changed, error } = await update.select("id");
  if (error || !changed?.length) {
    await supabase.from("shift_edits").delete().eq("id", log.id);
    return { ok: false, error: error ? "Couldn't save that. Try again." : "That shift just changed (they may have clocked out). Reload and check it." };
  }

  revalidatePath("/admin/team");
  revalidatePath("/admin/my-hours");
  return { ok: true };
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

// Mark done, or Reopen. A restock to-do from "Ran out" is done when it's
// bought: that closes its report and puts what it stopped back on sale.
export async function setTodoDoneFromOffice(id: string, done: boolean): Promise<Result> {
  const staff = await assertManager();
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "That to-do isn't there any more. Reload the page." };
  const r = done ? await finishTodo(id.toLowerCase(), staff.employeeId) : await reopenTodo(id.toLowerCase());
  revalidate();
  if (done && r.ok) revalidatePath("/admin/menu");
  return r.ok ? { ok: true } : r;
}

export async function deleteTodo(id: string): Promise<Result> {
  await assertManager();
  if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: "That to-do isn't there any more. Reload the page." };
  const r = await removeTodo(id.toLowerCase());
  revalidate();
  return r;
}

// ---------- schedule ----------

export async function addScheduledShift(input: { employeeId: string; date: string; start: string; end: string; note: string }): Promise<Result> {
  const staff = await assertManager();
  if (!input.employeeId) return { ok: false, error: "Pick who's working." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{1,2}:\d{2}$/.test(input.start) || !/^\d{1,2}:\d{2}$/.test(input.end)) return { ok: false, error: "Pick a day, a start and an end time." };
  const startsAt = centralToIso(input.date, input.start);
  let endsAt = centralToIso(input.date, input.end);
  // Ends after midnight (a closing shift): that time on the next date, not 24
  // hours on, which is an hour off the night the clocks change.
  if (endsAt <= startsAt) endsAt = centralToIso(shiftDate(input.date, 1), input.end);
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
  // The week's business days, 4 a.m. Monday to 4 a.m. the next Monday by
  // the wall clock (not 7 x 24 hours, an hour off across a clock change).
  const from = centralToIso(weekStart, "04:00");
  const to = centralToIso(shiftDate(weekStart, 7), "04:00");
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
    .lt("starts_at", centralToIso(shiftDate(weekStart, 14), "04:00"));
  const taken = new Set((existing ?? []).map((e) => `${e.employee_id}|${new Date(e.starts_at).getTime()}`));
  const fresh = next.filter((s) => !taken.has(`${s.employee_id}|${new Date(s.starts_at).getTime()}`));
  if (fresh.length) {
    const { error } = await supabase.from("staff_schedule").insert(fresh);
    if (error) return { ok: false, error: "Couldn't copy the week. Try again." };
  }
  revalidate();
  return { ok: true, copied: fresh.length, skipped: next.length - fresh.length };
}
