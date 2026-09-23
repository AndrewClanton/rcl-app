"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertStaff } from "@/lib/auth";

function revalidate() {
  revalidatePath("/admin/schedule-graphic");
}

export async function addCalendarNote(input: {
  noteDate: string;
  startTime: string | null;
  endTime: string | null;
  label: string;
}) {
  const staff = await assertStaff();
  const supabase = createAdminClient();
  const { error } = await supabase.from("calendar_notes").insert({
    note_date: input.noteDate,
    start_time: input.startTime,
    end_time: input.endTime,
    label: input.label,
    created_by: staff.employeeId,
  });
  if (error) throw error;
  revalidate();
}

export async function deleteCalendarNote(id: string) {
  await assertStaff();
  const supabase = createAdminClient();
  await supabase.from("calendar_notes").delete().eq("id", id);
  revalidate();
}
