"use server";

import { revalidatePath } from "next/cache";
import { assertManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTraining } from "@/lib/training/catalog";

type Result = { ok: true; count?: number } | { ok: false; error: string };

function revalidate() {
  revalidatePath("/admin/training");
  revalidatePath("/training");
  revalidatePath("/pos");
}

// Assigns a training to people (managers and up). Assigning it again
// updates the due date and note; their progress is kept.
export async function assignTraining(slug: string, employeeIds: string[], dueDate: string | null, note: string): Promise<Result> {
  const session = await assertManager();
  if (!getTraining(slug)) return { ok: false, error: "That training doesn't exist." };
  const ids = [...new Set(employeeIds)].filter(Boolean);
  if (ids.length === 0) return { ok: false, error: "Pick at least one person." };
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return { ok: false, error: "Pick a valid due date." };
  const supabase = createAdminClient();
  const { data: people } = await supabase.from("employees").select("id").in("id", ids).eq("active", true).neq("role", "display");
  const valid = (people ?? []).map((p) => p.id as string);
  if (valid.length === 0) return { ok: false, error: "None of those people are active staff." };
  const { error } = await supabase.from("training_assignments").upsert(
    valid.map((employee_id) => ({
      employee_id,
      module_slug: slug,
      due_date: dueDate || null,
      note: note.trim().slice(0, 200) || null,
      assigned_by: session.employeeId,
      assigned_at: new Date().toISOString(),
    })),
    { onConflict: "employee_id,module_slug" },
  );
  if (error) return { ok: false, error: "Couldn't save the assignment. Try again." };
  revalidate();
  return { ok: true, count: valid.length };
}

export async function unassignTraining(assignmentId: string): Promise<Result> {
  await assertManager();
  const { error } = await createAdminClient().from("training_assignments").delete().eq("id", assignmentId);
  if (error) return { ok: false, error: "Couldn't remove it. Try again." };
  revalidate();
  return { ok: true };
}
