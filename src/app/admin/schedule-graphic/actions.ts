"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertStaff } from "@/lib/auth";

// Both return { ok: false, error } when it didn't save, so the builder can
// say so (a failed add used to take the page down; a failed delete did
// nothing at all).
type Result = { ok: true } | { ok: false; error: string };

function revalidate() {
  revalidatePath("/admin/schedule-graphic");
}

export async function addCalendarNote(input: {
  noteDate: string;
  startTime: string | null;
  endTime: string | null;
  label: string;
}): Promise<Result> {
  const staff = await assertStaff();
  if (!input.label.trim()) return { ok: false, error: "Give the note a label." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.noteDate)) return { ok: false, error: "Pick a date for the note." };
  const supabase = createAdminClient();
  const { error } = await supabase.from("calendar_notes").insert({
    note_date: input.noteDate,
    start_time: input.startTime,
    end_time: input.endTime,
    label: input.label,
    created_by: staff.employeeId,
  });
  if (error) return { ok: false, error: "Couldn't add that note. Try again." };
  revalidate();
  return { ok: true };
}

export async function deleteCalendarNote(id: string): Promise<Result> {
  await assertStaff();
  const supabase = createAdminClient();
  const { error } = await supabase.from("calendar_notes").delete().eq("id", id);
  if (error) return { ok: false, error: "Couldn't remove that note. Try again." };
  revalidate();
  return { ok: true };
}
