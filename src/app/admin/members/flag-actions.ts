"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { clearFlag, takeBackFlaggedVisit } from "@/lib/member-flags-server";

// A flag from the register's "Flag suspicious activity" (lib/member-flags.ts),
// on the member's page (FlagBox.tsx). Admins and owners only.

const ID = /^[0-9a-f-]{36}$/i;

async function memberOf(flagId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("member_flags").select("member_id").eq("id", flagId).maybeSingle();
  return (data?.member_id as string | undefined) ?? null;
}

function refresh(memberId: string | null) {
  if (memberId) revalidatePath(`/admin/members/${memberId}`);
  revalidatePath("/admin");
}

// "Take back today's check-in points": the flagged check-in's visit, its
// badges and unused rewards go, and its points come off their balance as
// one line in their points history, by this admin.
export async function takeBackFlagPoints(flagId: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const admin = await assertAdmin();
  if (typeof flagId !== "string" || !ID.test(flagId)) return { ok: false, error: "Couldn't find that flag." };
  const r = await takeBackFlaggedVisit(flagId, admin.employeeId);
  if (!r.ok) return r;
  refresh(await memberOf(flagId));
  return { ok: true, message: r.taken > 0 ? `Check-in taken back: ${r.taken} point${r.taken === 1 ? "" : "s"} off their balance.` : "Check-in taken back (it paid no points)." };
}

// "Clear flag": done looking at it. Records who and when.
export async function clearMemberFlag(flagId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await assertAdmin();
  if (typeof flagId !== "string" || !ID.test(flagId)) return { ok: false, error: "Couldn't find that flag." };
  if (!(await clearFlag(flagId, admin.employeeId))) return { ok: false, error: "That flag was cleared already. Refresh the page." };
  refresh(await memberOf(flagId));
  return { ok: true };
}
