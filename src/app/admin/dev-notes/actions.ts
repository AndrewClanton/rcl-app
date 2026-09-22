"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStaffSession } from "@/lib/auth";
import type { DevNoteStatus } from "@/lib/types";

function revalidate() {
  revalidatePath("/admin/dev-notes");
}

// Called from the global Develop Mate widget, which only renders for admins
// in the first place (see src/app/layout.tsx) -- this check is defense in
// depth against the action being invoked directly, not the primary gate.
export async function submitDevNote(input: { pagePath: string; pageTitle: string; message: string }) {
  const staff = await getStaffSession();
  if (!staff || staff.role !== "admin") throw new Error("Not authorized");

  const message = input.message.trim();
  if (!message) return;

  const supabase = createAdminClient();
  const { error } = await supabase.from("dev_notes").insert({
    page_path: input.pagePath,
    page_title: input.pageTitle || null,
    message,
    submitted_by: staff.employeeId,
  });
  if (error) throw error;
}

async function setStatus(id: string, status: DevNoteStatus) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("dev_notes").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
  revalidate();
}

export async function approveDevNote(id: string) {
  await setStatus(id, "approved");
}

export async function dismissDevNote(id: string) {
  await setStatus(id, "dismissed");
}

export async function markDevNoteDone(id: string) {
  await setStatus(id, "done");
}

export async function reopenDevNote(id: string) {
  await setStatus(id, "new");
}

export async function deleteDevNote(id: string) {
  const supabase = createAdminClient();
  await supabase.from("dev_notes").delete().eq("id", id);
  revalidate();
}
