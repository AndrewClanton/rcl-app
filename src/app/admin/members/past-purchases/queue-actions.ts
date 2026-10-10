"use server";

import { revalidatePath } from "next/cache";
import { assertManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Needs approval (NeedsApproval.tsx): managers and up approve, reject or
// reassign one old-register card at a time. Approve and Reassign pay the
// card through grant_fortis_card (migration 20261009120000), once, ever,
// at 1 point per $1 rounded down. Every action re-checks the role, since a
// Server Action is a public endpoint whatever page it sits under. Nothing
// here logs card digits or names.
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidate(memberId?: string | null) {
  revalidatePath("/admin/members/past-purchases");
  revalidatePath("/admin/members/regulars/most-regular");
  if (memberId) revalidatePath(`/admin/members/${memberId}`);
}

// Approve (the member it's matched to) or Reassign (someone else): pay it.
export async function approveQueuedCard(cardId: string, memberId: string): Promise<Result<{ points: number }>> {
  const staff = await assertManager();
  if (!UUID.test(String(cardId)) || !UUID.test(String(memberId))) return { ok: false, error: "That card or member wasn't found." };
  const { data, error } = await createAdminClient().rpc("grant_fortis_card", { p_card: cardId, p_member: memberId, p_by: staff.employeeId, p_mode: "approve" });
  revalidate(memberId);
  if (error) {
    console.error("grant_fortis_card (approve) failed", error.code);
    return { ok: false, error: "Nothing was given: the database refused it. Try again." };
  }
  const r = data as { status: string; points?: number | string };
  switch (r.status) {
    case "granted":
      return { ok: true, points: Number(r.points ?? 0) };
    case "already":
      return { ok: false, error: "This card's points were already given." };
    case "removed":
      return { ok: false, error: "This card's member asked for their info to be removed." };
    case "member_gone":
      return { ok: false, error: "That member's account is gone or their info was removed." };
    default:
      return { ok: false, error: "That card wasn't found." };
  }
}

// Reject: not paid, and off the list. The member it was matched to won't be
// offered it at the register again.
export async function rejectQueuedCard(cardId: string): Promise<Result> {
  const staff = await assertManager();
  if (!UUID.test(String(cardId))) return { ok: false, error: "That card wasn't found." };
  const db = createAdminClient();
  const { data: card } = await db.from("fortis_cards").select("id, matched_member_id, granted_at").eq("id", cardId).maybeSingle();
  if (!card) return { ok: false, error: "That card wasn't found." };
  if (card.granted_at) return { ok: false, error: "This card's points were already given." };
  const { data, error } = await db
    .from("fortis_cards")
    .update({ decision: "skipped", decided_by: staff.employeeId, decided_at: new Date().toISOString() })
    .eq("id", cardId)
    .is("granted_at", null)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "Couldn't save that. Try again." };
  if (card.matched_member_id) {
    await db
      .from("fortis_card_rejections")
      .upsert({ card_id: cardId, member_id: card.matched_member_id, source: "backoffice", rejected_by: staff.employeeId }, { onConflict: "card_id,member_id", ignoreDuplicates: true });
  }
  revalidate(card.matched_member_id);
  return { ok: true };
}
