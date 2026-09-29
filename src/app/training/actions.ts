"use server";

import { revalidatePath } from "next/cache";
import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTraining, gradeQuiz } from "@/lib/training/catalog";

// Who a training action is for. On a phone it's whoever is signed in. On
// the register (the shared iPad login) it's the on-shift person who opened
// it -- the same honor system as starting a shift or ticking a to-do.
async function trainee(forEmployeeId: string | null): Promise<{ employeeId: string; recordedBy: string; via: "register" | "phone" } | null> {
  const session = await assertStaff();
  if (!forEmployeeId) return { employeeId: session.employeeId, recordedBy: session.employeeId, via: "phone" };
  // Signing for someone else only works for a person who's on shift right
  // now, i.e. from the register.
  const supabase = createAdminClient();
  const [{ data: person }, { data: shift }] = await Promise.all([
    supabase.from("employees").select("id").eq("id", forEmployeeId).eq("active", true).neq("role", "display").maybeSingle(),
    supabase.from("shifts").select("id").eq("employee_id", forEmployeeId).is("ended_at", null).limit(1).maybeSingle(),
  ]);
  return person && (shift || forEmployeeId === session.employeeId) ? { employeeId: person.id as string, recordedBy: session.employeeId, via: "register" } : null;
}

// First open of an assigned training (tells "not started" from "started").
export async function markTrainingOpened(slug: string, forEmployeeId: string | null): Promise<void> {
  const who = await trainee(forEmployeeId);
  if (!who || !getTraining(slug)) return;
  await createAdminClient()
    .from("training_assignments")
    .update({ first_opened_at: new Date().toISOString() })
    .eq("employee_id", who.employeeId)
    .eq("module_slug", slug)
    .is("first_opened_at", null);
}

export type QuizCheck = { passed: true; why: Record<string, string> } | { passed: false; wrong: string[] };

// Checks quiz answers without signing off. The reasons behind each answer
// only come back once everything's right.
export async function checkTrainingQuiz(slug: string, answers: Record<string, number>): Promise<QuizCheck> {
  await assertStaff();
  const t = getTraining(slug);
  if (!t?.quiz) return { passed: true, why: {} };
  const g = gradeQuiz(t, answers);
  return g.wrong.length ? { passed: false, wrong: g.wrong } : { passed: true, why: g.why };
}

export type SignOffResult = { ok: true; completedAt: string } | { ok: false; error: string; wrong?: string[] };

// "I've read and understand this." Grades the quiz again on the server (a
// key training can't be signed without passing it) and records the
// version they agreed to.
export async function signOffTraining(slug: string, input: { forEmployeeId: string | null; answers: Record<string, number> | null }): Promise<SignOffResult> {
  const t = getTraining(slug);
  if (!t) return { ok: false, error: "That training doesn't exist anymore." };
  const who = await trainee(input.forEmployeeId);
  if (!who) return { ok: false, error: "Couldn't tell who's signing. Start your shift on the register first, or sign in on your phone." };

  let quiz: { correct: number; total: number } | null = null;
  if (t.quiz) {
    const g = gradeQuiz(t, input.answers ?? {});
    if (g.wrong.length) return { ok: false, error: "A few answers aren't right yet. Check the ones marked and try again.", wrong: g.wrong };
    quiz = { correct: g.correct, total: g.total };
  }

  const completedAt = new Date().toISOString();
  const { error } = await createAdminClient().from("training_completions").insert({
    employee_id: who.employeeId,
    module_slug: t.slug,
    module_version: t.version,
    completed_at: completedAt,
    quiz_correct: quiz?.correct ?? null,
    quiz_total: quiz?.total ?? null,
    via: who.via,
    recorded_by: who.recordedBy,
  });
  if (error) return { ok: false, error: "Couldn't save your sign-off. Try again." };
  revalidatePath("/training");
  revalidatePath("/admin/training");
  return { ok: true, completedAt };
}
