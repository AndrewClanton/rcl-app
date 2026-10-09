"use server";

import { revalidatePath } from "next/cache";
import { assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { openApproval } from "@/lib/approval-token";
import { firstName } from "@/lib/card-match";
import { oldCardScope } from "@/lib/old-card-offer";

// The buttons on "Old card on file?" (OldCardPrompt.tsx; the offer comes
// from lib/old-card-offer.ts). Claim pays the card to the sale's member
// through grant_fortis_card: 1,000 points or under now, over that it waits
// in Back office's Needs approval. Not theirs records that, so the card
// isn't offered to that member again. Both need the offer's token: this
// sign-in, this sale, this card, for 5 minutes. Nothing here logs card
// digits or names.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Result = { ok: true; message: string } | { ok: false; error: string };

async function allowed(orderId: unknown, cardId: unknown, token: unknown) {
  const staff = await assertStaff();
  if (typeof orderId !== "string" || !UUID.test(orderId) || typeof cardId !== "string" || !UUID.test(cardId)) return null;
  return openApproval(token, oldCardScope(orderId, cardId), staff.employeeId) ? staff : null;
}

const TOO_LATE = "This offer ran out. A manager can find the card in Back office (Members, Points from past card purchases).";

export async function claimOldCard(orderId: string, cardId: string, token: string): Promise<Result> {
  const staff = await allowed(orderId, cardId, token);
  if (!staff) return { ok: false, error: TOO_LATE };
  const db = createAdminClient();
  const { data: order } = await db.from("orders").select("member_id, member_source, member:members(name)").eq("id", orderId).maybeSingle();
  if (!order?.member_id || order.member_source) return { ok: false, error: "That sale has no member on it now." };
  const { data, error } = await db.rpc("grant_fortis_card", { p_card: cardId, p_member: order.member_id, p_by: staff.employeeId, p_mode: "register" });
  if (error) {
    console.error("grant_fortis_card (register) failed", error.code);
    return { ok: false, error: "Couldn't claim it. Try again." };
  }
  revalidatePath("/admin/members/past-purchases");
  revalidatePath(`/admin/members/${order.member_id}`);
  const who = firstName((order.member as unknown as { name: string } | null)?.name);
  const r = data as { status: string; points?: number | string };
  const pts = Number(r.points ?? 0).toLocaleString("en-US");
  switch (r.status) {
    case "granted":
      return { ok: true, message: `Claimed: ${pts} points to ${who} for past visits.` };
    case "queued":
      return { ok: true, message: `Claimed for ${who}. It's over 1,000 points, so a manager approves it in Back office first.` };
    case "already":
      return { ok: false, error: "That card's points were already given." };
    case "member_gone":
      return { ok: false, error: "That member's account can't get points." };
    default:
      return { ok: false, error: "That card was already claimed." };
  }
}

export async function notTheirOldCard(orderId: string, cardId: string, token: string): Promise<Result> {
  const staff = await allowed(orderId, cardId, token);
  if (!staff) return { ok: false, error: TOO_LATE };
  const db = createAdminClient();
  const { data: order } = await db.from("orders").select("member_id").eq("id", orderId).maybeSingle();
  if (!order?.member_id) return { ok: true, message: "OK." };
  const { error } = await db
    .from("fortis_card_rejections")
    .upsert({ card_id: cardId, member_id: order.member_id, source: "register", rejected_by: staff.employeeId }, { onConflict: "card_id,member_id", ignoreDuplicates: true });
  if (error) {
    console.error("old card rejection failed", error.code);
    return { ok: false, error: "Couldn't save that. Try again." };
  }
  return { ok: true, message: "OK, it won't be offered for them again." };
}
