import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFlagReason, type FlagReason, type MemberFlag } from "@/lib/member-flags";
import { undoVisit } from "@/lib/visits-server";
import { visitBusinessDate } from "@/lib/visits";

// The flags on member accounts (lib/member-flags.ts; the table is
// supabase/migrations/20261002060000_member_flags.sql). Server-only: the
// register and Back office reach these through their own staff-checked
// server actions.

const SELECT =
  "id, member_id, reason, note, visit_id, visit_date, flagged_at, taken_back_at, taken_back_points, cleared_at, " +
  "flagger:employees!member_flags_flagged_by_fkey(name), taker:employees!member_flags_taken_back_by_fkey(name), clearer:employees!member_flags_cleared_by_fkey(name)";

type Named = { name: string } | { name: string }[] | null;
const nameOf = (e: Named) => (Array.isArray(e) ? e[0]?.name : e?.name) ?? null;

function toFlag(r: Record<string, unknown>): MemberFlag {
  return {
    id: r.id as string,
    memberId: r.member_id as string,
    reason: isFlagReason(r.reason) ? r.reason : "other",
    note: (r.note as string | null) ?? null,
    visitId: (r.visit_id as string | null) ?? null,
    visitDate: (r.visit_date as string | null) ?? null,
    flaggedBy: nameOf(r.flagger as Named),
    flaggedAt: r.flagged_at as string,
    takenBackBy: nameOf(r.taker as Named),
    takenBackAt: (r.taken_back_at as string | null) ?? null,
    takenBackPoints: r.taken_back_points === null || r.taken_back_points === undefined ? null : Number(r.taken_back_points),
    clearedBy: nameOf(r.clearer as Named),
    clearedAt: (r.cleared_at as string | null) ?? null,
  };
}

// A member's flags, newest first (cleared ones too, unless openOnly). Empty
// when there are none or they couldn't be read (say, before the migration).
export async function memberFlags(memberId: string, openOnly = false): Promise<MemberFlag[]> {
  let q = createAdminClient().from("member_flags").select(SELECT).eq("member_id", memberId);
  if (openOnly) q = q.is("cleared_at", null);
  const { data, error } = await q.order("flagged_at", { ascending: false }).limit(50);
  if (error || !data) return [];
  return (data as unknown as Record<string, unknown>[]).map(toFlag);
}

// Which of these members have a flag that isn't cleared.
export async function flaggedAmong(memberIds: string[]): Promise<Set<string>> {
  if (!memberIds.length) return new Set();
  const { data, error } = await createAdminClient().from("member_flags").select("member_id").in("member_id", memberIds.slice(0, 200)).is("cleared_at", null);
  if (error || !data) return new Set();
  return new Set(data.map((r) => r.member_id as string));
}

// Every flag not cleared yet, newest first, with the member's name: Back
// office's "Flagged accounts" on the Today page.
export async function openFlags(limit = 20): Promise<{ flag: MemberFlag; memberName: string }[]> {
  const db = createAdminClient();
  const { data, error } = await db.from("member_flags").select(SELECT).is("cleared_at", null).order("flagged_at", { ascending: false }).limit(limit);
  if (error || !data?.length) return [];
  const flags = (data as unknown as Record<string, unknown>[]).map(toFlag);
  const { data: members } = await db.from("members").select("id, name").in("id", [...new Set(flags.map((f) => f.memberId))]);
  const names = new Map((members ?? []).map((m) => [m.id as string, ((m.name as string | null) ?? "").trim() || "A phone account"]));
  return flags.filter((f) => names.has(f.memberId)).map((flag) => ({ flag, memberName: names.get(flag.memberId)! }));
}

// Records a flag: who (an employee id), the reason, an optional note, and
// that business day's check-in if they have one. Null if it couldn't be
// saved.
export async function addFlag(memberId: string, reason: FlagReason, note: string | null, by: string | null): Promise<MemberFlag | null> {
  const db = createAdminClient();
  const date = visitBusinessDate(new Date());
  const { data: visit } = await db.from("member_visits").select("id").eq("member_id", memberId).eq("business_date", date).maybeSingle();
  const { data, error } = await db
    .from("member_flags")
    .insert({ member_id: memberId, reason, note, visit_id: visit?.id ?? null, visit_date: visit ? date : null, flagged_by: by })
    .select(SELECT)
    .single();
  if (error || !data) {
    if (error) console.error("addFlag:", error.code, error.message);
    return null;
  }
  return toFlag(data as unknown as Record<string, unknown>);
}

// Clears a flag (once): who and when. False if it was cleared already or
// isn't there.
export async function clearFlag(flagId: string, by: string | null): Promise<boolean> {
  const { data } = await createAdminClient().from("member_flags").update({ cleared_at: new Date().toISOString(), cleared_by: by }).eq("id", flagId).is("cleared_at", null).select("id");
  return !!data?.length;
}

// Takes back the flagged check-in's points (lib/visits-server.ts undoVisit:
// the visit, its badges and unused rewards go, and what it paid comes off
// their balance as one line in their points history), and records it on
// the flag.
export async function takeBackFlaggedVisit(flagId: string, by: string | null): Promise<{ ok: true; taken: number } | { ok: false; error: string }> {
  const db = createAdminClient();
  const { data: f, error } = await db.from("member_flags").select("id, member_id, visit_id, taken_back_at").eq("id", flagId).maybeSingle();
  if (error || !f) return { ok: false, error: "Couldn't find that flag." };
  if (f.taken_back_at) return { ok: false, error: "That check-in's points were taken back already." };
  if (!f.visit_id) return { ok: false, error: "There's no check-in on this flag to take back." };
  const r = await undoVisit(f.member_id as string, by, { visitId: f.visit_id as string, note: "Check-in taken back (flagged)" });
  if (!r) return { ok: false, error: "That check-in is gone already, or couldn't be read. Refresh and try again." };
  await db.from("member_flags").update({ taken_back_at: new Date().toISOString(), taken_back_by: by, taken_back_points: r.taken }).eq("id", flagId);
  return { ok: true, taken: r.taken };
}
