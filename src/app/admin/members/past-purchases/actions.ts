"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { maskEmail, maskPhone } from "@/lib/contact-mask";
import {
  BACKFILL_NOTE,
  buildMemberIndex,
  matchCard,
  matchColumns,
  planGrant,
  planTotals,
  sameMatch,
  shouldRematch,
  validSettings,
  type GrantSettings,
  type StoredMatch,
} from "@/lib/fortis-backfill";

// Owners and admins only: every action re-checks (assertAdmin), since a
// Server Action is a public endpoint whatever page it sits under.
// Failures come back as { ok: false, error } (production hides thrown
// messages).
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const PAGE = "/admin/members/past-purchases";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidate() {
  revalidatePath(PAGE);
  revalidatePath("/admin/members/regulars/most-regular");
}

// Approve or skip one card, or put it back to "not decided" (which also
// lets matching decide it again: a pick is undone).
export async function decideCard(cardId: string, decision: "approved" | "skipped" | "pending"): Promise<Result> {
  const staff = await assertAdmin();
  if (!UUID.test(cardId)) return { ok: false, error: "That card wasn't found." };
  const supabase = createAdminClient();
  const { data: card } = await supabase
    .from("fortis_cards")
    .select("id, card_key, name_keys, name_fulls, contact_email, contact_phone, matched_member_id, match_kind, granted_at, erased_at")
    .eq("id", cardId)
    .maybeSingle();
  if (!card) return { ok: false, error: "That card wasn't found." };
  if (card.granted_at) return { ok: false, error: "This card's points were already granted." };
  if (card.erased_at) return { ok: false, error: "This card's member asked for their info to be removed." };
  if (decision === "approved" && !card.matched_member_id) return { ok: false, error: "Pick a member for this card first." };

  let update: Record<string, unknown> = { decision, decided_by: staff.employeeId, decided_at: new Date().toISOString() };
  if (decision === "pending") {
    // Back to the automatic match, as if nobody had touched it.
    const idx = buildMemberIndex(await readMembers());
    const m = matchCard({ email: card.contact_email, phone: card.contact_phone, nameKeys: card.name_keys ?? [], nameFulls: card.name_fulls ?? [] }, idx);
    update = matchColumns(m, new Date().toISOString());
  }
  const { data, error } = await supabase.from("fortis_cards").update(update).eq("id", cardId).is("granted_at", null).select("id");
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  if (!data?.length) return { ok: false, error: "This card's points were already granted." };
  revalidate();
  return { ok: true };
}

// This card is this member's: a staff pick, approved.
export async function pickCardMember(cardId: string, memberId: string): Promise<Result> {
  const staff = await assertAdmin();
  if (!UUID.test(cardId) || !UUID.test(memberId)) return { ok: false, error: "That card or member wasn't found." };
  const supabase = createAdminClient();
  const { data: member } = await supabase.from("members").select("id").eq("id", memberId).is("erased_at", null).maybeSingle();
  if (!member) return { ok: false, error: "That member wasn't found." };
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("fortis_cards")
    .update({
      matched_member_id: memberId,
      match_status: "matched",
      match_kind: "picked",
      match_confidence: null,
      matched_at: now,
      decision: "approved",
      decided_by: staff.employeeId,
      decided_at: now,
    })
    .eq("id", cardId)
    .is("granted_at", null)
    .is("erased_at", null)
    .select("id");
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  if (!data?.length) return { ok: false, error: "This card can't be changed now (already granted, or its member's info was removed)." };
  revalidate();
  return { ok: true };
}

// Approve every high-confidence match nobody has decided yet.
export async function approveExactMatches(): Promise<Result<{ approved: number }>> {
  const staff = await assertAdmin();
  const { data, error } = await createAdminClient()
    .from("fortis_cards")
    .update({ decision: "approved", decided_by: staff.employeeId, decided_at: new Date().toISOString() })
    .eq("match_status", "matched")
    .eq("match_confidence", "high")
    .eq("decision", "pending")
    .not("matched_member_id", "is", null)
    .is("granted_at", null)
    .is("erased_at", null)
    .select("id");
  if (error) return { ok: false, error: "Couldn't approve them. Try again." };
  revalidate();
  return { ok: true, approved: data?.length ?? 0 };
}

async function readMembers() {
  const supabase = createAdminClient();
  const out: { id: string; name: string; email: string | null; phoneDigits: string | null; erased: boolean }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("members").select("id, name, email, phone_digits, erased_at").order("id").range(from, from + 999);
    if (error) throw error;
    for (const m of data ?? []) out.push({ id: m.id, name: m.name, email: m.email, phoneDigits: m.phone_digits, erased: !!m.erased_at });
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Match again against today's members (people who joined since the load,
// names fixed). Only cards nobody has decided are touched.
export async function recheckMatches(): Promise<Result<{ changed: number; matched: number }>> {
  await assertAdmin();
  const supabase = createAdminClient();
  const members = await readMembers();
  const live = new Set(members.filter((m) => !m.erased).map((m) => m.id));
  const idx = buildMemberIndex(members);
  const now = new Date().toISOString();
  type Stored = StoredMatch & { id: string; card_key: string; name_keys: string[]; name_fulls: string[]; contact_email: string | null; contact_phone: string | null };
  const updates: { id: string; decision: string; cols: Record<string, unknown> }[] = [];
  let matched = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("fortis_cards")
      .select(
        "id, card_key, name_keys, name_fulls, contact_email, contact_phone, decision, match_status, match_kind, match_confidence, matched_member_id, candidate_member_ids, matched_at, granted_at, erased_at",
      )
      .order("id")
      .range(from, from + 999);
    if (error) return { ok: false, error: "Couldn't read the cards." };
    for (const raw of (data ?? []) as Stored[]) {
      const r = raw.matched_member_id && !live.has(raw.matched_member_id) ? { ...raw, matched_member_id: null } : raw;
      if (!shouldRematch(r)) continue;
      const m = matchCard({ email: r.contact_email, phone: r.contact_phone, nameKeys: r.name_keys ?? [], nameFulls: r.name_fulls ?? [] }, idx);
      if (m.status === "matched") matched++;
      if (sameMatch(r, m)) continue;
      updates.push({ id: r.id, decision: raw.decision, cols: matchColumns(m, now) });
    }
    if (!data || data.length < 1000) break;
  }
  // One card at a time, and only if nobody decided it (or granted it) since
  // it was read here.
  let changed = 0;
  for (let i = 0; i < updates.length; i += 10) {
    const results = await Promise.all(
      updates.slice(i, i + 10).map((u) =>
        supabase.from("fortis_cards").update(u.cols).eq("id", u.id).eq("decision", u.decision).is("granted_at", null).is("erased_at", null).select("id"),
      ),
    );
    if (results.some((r) => r.error)) return { ok: false, error: `Stopped after ${changed} changes. Press it again to finish.` };
    changed += results.reduce((n, r) => n + (r.data?.length ?? 0), 0);
  }
  revalidate();
  return { ok: true, changed, matched };
}

// Members to pick from, by name, email or phone. Contact comes back
// shortened: enough to tell two Sarahs apart.
export async function searchMembersToPick(query: string): Promise<Result<{ members: { id: string; name: string; hint: string }[] }>> {
  await assertAdmin();
  const q = String(query ?? "").trim().slice(0, 80);
  if (q.length < 2) return { ok: true, members: [] };
  // The same escaping as the Members search: no wildcards, and nothing
  // that would break the filter itself.
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

// Grant: one points-history row per member for their approved cards, at
// the settings on the screen. `expected` is what the confirm step showed;
// if the approved cards changed since, nothing is granted.
export async function grantBackfillPoints(settings: GrantSettings, expected: { members: number; points: number }): Promise<Result<{ members: number; points: number }>> {
  const staff = await assertAdmin();
  const s: GrantSettings = { rate: Number(settings?.rate), cap: settings?.cap === null || settings?.cap === undefined ? null : Number(settings.cap), taxOut: settings?.taxOut !== false };
  if (!validSettings(s)) return { ok: false, error: "Check the rate and the cap." };
  const supabase = createAdminClient();

  const cards: { id: string; matched_member_id: string; net_total: string | number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("fortis_cards")
      .select("id, matched_member_id, net_total")
      .eq("decision", "approved")
      .not("matched_member_id", "is", null)
      .is("granted_at", null)
      .is("erased_at", null)
      .order("id")
      .range(from, from + 999);
    if (error) return { ok: false, error: "Couldn't read the approved cards." };
    cards.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  if (!cards.length) return { ok: false, error: "No approved cards are waiting. Approve some first." };

  const already = new Map<string, number>();
  const memberIds = [...new Set(cards.map((c) => c.matched_member_id))];
  for (let i = 0; i < memberIds.length; i += 150) {
    const { data, error } = await supabase.from("fortis_backfill_grants").select("member_id, points").in("member_id", memberIds.slice(i, i + 150));
    if (error) return { ok: false, error: "Couldn't read earlier grants." };
    for (const g of data ?? []) already.set(g.member_id, (already.get(g.member_id) ?? 0) + Number(g.points));
  }

  const plan = planGrant(
    cards.map((c) => ({ id: c.id, memberId: c.matched_member_id, dollars: Number(c.net_total) })),
    s,
    already,
  );
  const totals = planTotals(plan);
  if (totals.points !== expected?.points || totals.members !== expected?.members) {
    return { ok: false, error: `The totals changed since you looked (now ${totals.points.toLocaleString()} points to ${totals.members} members). Nothing was granted. Check them and press Grant again.` };
  }

  const { data, error } = await supabase.rpc("grant_fortis_backfill", {
    p_grants: plan.map((p) => ({ member_id: p.memberId, points: p.points, dollars: p.dollars, cards: p.cards })),
    p_settings: s,
    p_note: BACKFILL_NOTE,
    p_by: staff.employeeId,
  });
  revalidate();
  if (error) {
    if (error.hint === "changed") return { ok: false, error: "Some of these cards changed or were already granted (another tab?). Nothing was granted. Check the totals and try again." };
    return { ok: false, error: "Nothing was granted: the database refused it. Try again, and tell Andrew if it keeps happening." };
  }
  const r = data as { members: number; points: number };
  revalidatePath("/admin/members");
  return { ok: true, members: Number(r.members), points: Number(r.points) };
}
