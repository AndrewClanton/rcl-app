"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { UUID } from "@/lib/data/member-merge";
import { mergeSentence } from "@/lib/member-merge";
import { memberPhotoPath, removeMemberPhotos } from "@/lib/member-photos";

// Merging a duplicate member into another (Back office → Members → a
// member → "Merge a duplicate into this account"). Owner and admin only,
// checked here as well as on the page. The database does the whole merge
// in one transaction (merge_members, migration 20261001150000): either
// everything moves or nothing does.

export type MergeResult = { ok: true; keepId: string; sentence: string } | { ok: false; error: string };

export async function mergeMemberAccounts(keepId: string, dropId: string): Promise<MergeResult> {
  const staff = await assertAdmin();
  if (!UUID.test(keepId) || !UUID.test(dropId)) return { ok: false, error: "Pick the two accounts to merge." };
  const admin = createAdminClient();
  // The duplicate's photo, for the clean-up after (its row is gone then).
  const { data: before } = await admin.from("members").select("avatar_url").eq("id", dropId).maybeSingle();
  const { data, error } = await admin.rpc("merge_members", { p_keep: keepId, p_drop: dropId, p_staff: staff.employeeId });
  if (error) {
    // A refusal (both have logins, one is gone...): the database's own words.
    if (error.code === "P0001") return { ok: false, error: error.message };
    if (error.code === "PGRST202" || error.code === "42883") {
      return { ok: false, error: "Merging isn't set up yet: the database update for it (20261001150000) hasn't been applied. Nothing was changed." };
    }
    console.error("merge_members failed", error.code, error.message);
    return { ok: false, error: "Couldn't merge them just now. Nothing was changed; try again." };
  }
  // The duplicate's stored photos go, except the one the kept account took
  // over (still named after the duplicate; erasing the kept account later
  // finds it through member_merges). Otherwise a photo the record no
  // longer points at would stay reachable at its public address. Not
  // fatal: the merge is done either way.
  const { data: kept, error: keptErr } = await admin.from("members").select("avatar_url").eq("id", keepId).maybeSingle();
  if (!keptErr && kept) {
    const res = await removeMemberPhotos([dropId], { extra: [memberPhotoPath(before?.avatar_url)], keep: memberPhotoPath(kept.avatar_url) }).catch(() => ({ ok: false }));
    if (!res.ok) console.error("merge: the merged-in account's photo files weren't deleted", dropId);
  }
  const r = (data ?? {}) as { name?: string; points?: number | string; visits?: number };
  revalidatePath("/admin/members");
  revalidatePath("/admin/members/duplicates");
  revalidatePath("/admin/members/[id]", "page");
  revalidatePath("/admin/reports");
  return { ok: true, keepId, sentence: mergeSentence(r.name ?? "They", Number(r.points ?? 0), Number(r.visits ?? 0), true) };
}
