"use server";

import { revalidatePath } from "next/cache";
import { assertManager, hasAdminAccess } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowAttempt } from "@/lib/rate-limit";
import { maskEmail, maskPhone } from "@/lib/contact-mask";
import { LOOKUP_LIMIT, assignRule, lookupGrantNote, lookupStatus, mayAssignTo, readLookup, type LookupForm } from "@/lib/fortis-lookup";
import { findRewindCards, getRewindCard, rewindPreview, type RewindCard, type RewindPreview, type RewindResult } from "@/lib/data/fortis-lookup";
import { sendToTablet } from "@/lib/tablet-broadcast";
import type { RewindFound } from "@/lib/checkin";

// Rewind: managers and up (a manager at the bar does this with the regular
// standing there). Every action re-checks the role (assertManager), since
// a Server Action is a public endpoint whatever page it sits under. Back
// office's Grant for everyone stays owners and admins (actions.ts).
//
// Nothing here logs card digits, names or amounts. Who assigned a card is
// on the card (decided_by, decided_at); who gave the points is on the grant
// and the points-history line.
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const PAGE = "/admin/members/past-purchases";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidate(memberId?: string) {
  revalidatePath(PAGE);
  revalidatePath("/admin/members/regulars/most-regular");
  if (memberId) revalidatePath(`/admin/members/${memberId}`);
}

function preview(p: RewindPreview | null): RewindPreview | null {
  if (!p) return null;
  const { member, cards, points, balance, after, visits, since, settings } = p;
  return { member, cards, points, balance, after, visits, since, settings };
}

// Find the card. Limited per staff member (lib/rate-limit.ts) so the list
// can't be walked one guess at a time.
export async function rewindFind(form: LookupForm): Promise<Result<{ result: RewindResult }>> {
  const staff = await assertManager();
  const read = readLookup({
    lastFour: String(form?.lastFour ?? ""),
    purchases: Array.isArray(form?.purchases) ? form.purchases.slice(0, 10) : [],
    postingDates: form?.postingDates === true,
  });
  if (!read.ok) return { ok: false, error: read.error };
  if (!(await allowAttempt(`rewind:${staff.employeeId}`, LOOKUP_LIMIT.max, LOOKUP_LIMIT.windowSeconds))) {
    return { ok: false, error: "That's a lot of lookups in a few minutes. Wait a bit and try again." };
  }
  try {
    return { ok: true, result: await findRewindCards(read.input, hasAdminAccess(staff.role)) };
  } catch {
    return { ok: false, error: "The lookup didn't work. Try again." };
  }
}

// Members to assign a card to, by name, email or phone. Contact comes back
// shortened, as on the rest of this screen: enough to tell two Sarahs apart.
export async function rewindSearchMembers(query: string): Promise<Result<{ members: { id: string; name: string; hint: string }[] }>> {
  await assertManager();
  const q = String(query ?? "").trim().slice(0, 80);
  if (q.length < 2) return { ok: true, members: [] };
  const escaped = q.replace(/[%_]/g, (c) => `\\${c}`).replace(/[,()"\\]/g, " ");
  const digits = q.replace(/\D/g, "");
  const filters = [`name.ilike.%${escaped}%`, `email.ilike.%${escaped}%`];
  if (digits.length >= 4) filters.push(`phone_digits.like.%${digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits}%`);
  const { data, error } = await createAdminClient()
    .from("members")
    .select("id, name, email, phone")
    .is("erased_at", null)
    .or(filters.join(","))
    .order("name")
    .limit(8);
  if (error) return { ok: false, error: "Search didn't work. Try again." };
  return {
    ok: true,
    members: (data ?? []).map((m) => ({ id: m.id, name: m.name, hint: [maskEmail(m.email), maskPhone(m.phone)].filter(Boolean).join(" · ") })),
  };
}

// This card is this member's: matched, approved, found with Rewind, by this
// staff member. `seen` is the card's match as the screen showed it; if it
// changed since (someone else assigned it), nothing is written.
export async function rewindAssign(
  cardId: string,
  memberId: string,
  seen: { memberId: string | null; decision: string },
): Promise<Result<{ card: RewindCard | null; preview: RewindPreview | null }>> {
  const staff = await assertManager();
  if (!UUID.test(String(cardId)) || !UUID.test(String(memberId))) return { ok: false, error: "That card or member wasn't found." };
  const isAdmin = hasAdminAccess(staff.role);
  const supabase = createAdminClient();
  const [{ data: member }, { data: card }] = await Promise.all([
    supabase.from("members").select("id").eq("id", memberId).is("erased_at", null).maybeSingle(),
    supabase.from("fortis_cards").select("id, match_status, match_kind, matched_member_id, decision, granted_at, erased_at").eq("id", cardId).maybeSingle(),
  ]);
  if (!member) return { ok: false, error: "That member wasn't found." };
  if (!card) return { ok: false, error: "That card wasn't found." };

  const status = lookupStatus(card);
  if (status === "granted") return { ok: false, error: "This card's points were already given." };
  if (status === "removed") return { ok: false, error: "This card's member asked for their info to be removed. It can't be assigned." };
  // Pressed twice: the first one did it.
  if (card.decision === "approved" && card.match_kind === "lookup" && card.matched_member_id === memberId) {
    return { ok: true, card: await getRewindCard(cardId, isAdmin), preview: preview(await rewindPreview(memberId)) };
  }
  if (!mayAssignTo(assignRule(status, card.decision === "approved", isAdmin), card.matched_member_id, memberId)) {
    return {
      ok: false,
      error:
        status === "skipped"
          ? "An owner or admin skipped this card, so it can't be assigned here. Ask one of them."
          : "This card is already approved for another member. An owner or admin can change it in the list.",
    };
  }
  if ((seen?.memberId ?? null) !== card.matched_member_id || seen?.decision !== card.decision) {
    return { ok: false, error: "This card changed since you looked it up. Look it up again." };
  }

  const now = new Date().toISOString();
  let update = supabase
    .from("fortis_cards")
    .update({
      matched_member_id: memberId,
      match_status: "matched",
      match_kind: "lookup",
      match_confidence: null,
      matched_at: now,
      decision: "approved",
      decided_by: staff.employeeId,
      decided_at: now,
    })
    .eq("id", cardId)
    .eq("decision", card.decision)
    .is("granted_at", null)
    .is("erased_at", null);
  update = card.matched_member_id ? update.eq("matched_member_id", card.matched_member_id) : update.is("matched_member_id", null);
  const { data, error } = await update.select("id");
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  if (!data?.length) return { ok: false, error: "This card changed since you looked it up. Look it up again." };
  revalidate(memberId);
  return { ok: true, card: await getRewindCard(cardId, isAdmin), preview: preview(await rewindPreview(memberId)) };
}

// The confirm step's numbers, fresh.
export async function rewindGetPreview(memberId: string): Promise<Result<{ preview: RewindPreview | null }>> {
  await assertManager();
  if (!UUID.test(String(memberId))) return { ok: false, error: "That member wasn't found." };
  return { ok: true, preview: preview(await rewindPreview(memberId)) };
}

// "Give <first name> these points now": only this member's cards found
// with Rewind, the ones the confirm step showed, through
// grant_fortis_backfill (a card is paid once, ever; a second press finds
// them paid and says so). Then, if asked, the tablet at the bar celebrates;
// if it can't be reached the points are still in.
export async function rewindGive(
  memberId: string,
  cardIds: string[],
  expectedPoints: number,
  celebrate: boolean,
): Promise<Result<{ points: number; balance: number; already: boolean; tablet: "sent" | "off" | "missed" }>> {
  const staff = await assertManager();
  const ids = Array.isArray(cardIds) ? [...new Set(cardIds.map(String))] : [];
  if (!UUID.test(String(memberId)) || !ids.length || ids.length > 20 || !ids.every((id) => UUID.test(id))) {
    return { ok: false, error: "Those cards weren't found." };
  }
  const supabase = createAdminClient();

  const alreadyGiven = async () => {
    const { data } = await supabase.from("fortis_cards").select("id, granted_at, granted_member_id, granted_points").in("id", ids);
    if (!data || data.length !== ids.length || !data.every((c) => c.granted_at && c.granted_member_id === memberId)) return null;
    const { data: m } = await supabase.from("members").select("points").eq("id", memberId).maybeSingle();
    return { points: data.reduce((s, c) => s + Number(c.granted_points ?? 0), 0), balance: Number(m?.points ?? 0) };
  };

  const p = await rewindPreview(memberId, ids);
  if (!p || p.cards.length !== ids.length) {
    const done = await alreadyGiven();
    if (done) return { ok: true, ...done, already: true, tablet: "off" };
    return { ok: false, error: "These cards changed since you looked. Look the card up again." };
  }
  if (p.points !== Number(expectedPoints)) {
    return { ok: false, error: `The points changed since you looked (now ${p.points.toLocaleString("en-US")}). Nothing was given. Check and press again.` };
  }

  const { error } = await supabase.rpc("grant_fortis_backfill", {
    p_grants: [{ member_id: memberId, points: p.points, dollars: p.dollars, cards: p.plan }],
    p_settings: { ...p.settingsUsed, via: "rewind" },
    p_note: lookupGrantNote(p.cards.map((c) => c.lastFour)),
    p_by: staff.employeeId,
  });
  revalidate(memberId);
  if (error) {
    const done = await alreadyGiven();
    if (done) return { ok: true, ...done, already: true, tablet: "off" };
    if (error.hint === "changed") return { ok: false, error: "These cards changed or were already given (another screen?). Nothing was given. Look the card up again." };
    return { ok: false, error: "Nothing was given: the database refused it. Try again, and tell Andrew if it keeps happening." };
  }

  const { data: m } = await supabase.from("members").select("points, flair_color").eq("id", memberId).maybeSingle();
  const balance = Number(m?.points ?? p.after);
  let tablet: "sent" | "off" | "missed" = "off";
  if (celebrate === true && p.points > 0) {
    const found: RewindFound = {
      firstName: p.member.firstName.slice(0, 40),
      visits: p.visits,
      since: p.since,
      earned: p.points,
      balance: Math.round(balance),
      color: m?.flair_color ?? null,
    };
    tablet = (await sendToTablet("rewind", { ...found })) ? "sent" : "missed";
  }
  revalidatePath("/admin/members");
  return { ok: true, points: p.points, balance, already: false, tablet };
}
