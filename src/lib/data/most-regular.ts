import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay } from "@/lib/ops/time";
import { compareRegulars, regularity, type Regularity, type RegularSort } from "@/lib/regularity";
import { shiftDay, weekStart } from "@/lib/visits";
import type { MemberTier } from "@/lib/types";

// "Most regular regulars", all time: the days each member came in, from
// the cards matched to them in fortis_cards (the old card machine, before
// mid-September 2026) and, with check-ins on, the days they checked in on
// the new system (member_visits). Staff screens only.
//
// A card counts once it's matched to a member and nobody skipped the match
// (approved, waiting for review, or granted). A week counts as open when
// anybody's card was used or anybody checked in that week.

export type RegularsSource = "cards" | "all";

export interface MostRegularRow extends Regularity {
  memberId: string;
  name: string;
  avatarUrl: string | null;
  tier: MemberTier;
}

export interface MostRegularReport {
  rows: MostRegularRow[];
  ranked: number; // members with at least one visit day
  asOf: string; // the day current runs are counted to
  cardsThrough: string | null; // the last day in the card history
}

export async function getMostRegular(source: RegularsSource, sort: RegularSort, limit = 50): Promise<MostRegularReport> {
  const supabase = createAdminClient();
  const days = new Map<string, Set<string>>();
  const openWeeks = new Set<string>();
  let cardsThrough: string | null = null;
  const add = (memberId: string, date: string) => {
    const set = days.get(memberId) ?? new Set<string>();
    set.add(date);
    days.set(memberId, set);
  };

  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("fortis_cards").select("id, matched_member_id, decision, visit_dates").order("id").range(from, from + 999);
    if (error) throw error;
    for (const c of data ?? []) {
      const dates: string[] = c.visit_dates ?? [];
      for (const d of dates) {
        openWeeks.add(weekStart(d));
        if (!cardsThrough || d > cardsThrough) cardsThrough = d;
      }
      if (c.matched_member_id && c.decision !== "skipped") for (const d of dates) add(c.matched_member_id, d);
    }
    if (!data || data.length < 1000) break;
  }

  if (source === "all") {
    const checkinWeeks = new Set<string>();
    let firstCheckin: string | null = null;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("member_visits").select("id, member_id, business_date").order("id").range(from, from + 999);
      if (error) throw error;
      for (const v of data ?? []) {
        checkinWeeks.add(weekStart(v.business_date));
        if (!firstCheckin || v.business_date < firstCheckin) firstCheckin = v.business_date;
        add(v.member_id, v.business_date);
      }
      if (!data || data.length < 1000) break;
    }
    // The card history stops partway through its last week (the export was
    // taken that day) and check-ins started after it, so that week is only
    // half seen: like a closed week, it can't break anyone's run.
    if (cardsThrough && (!firstCheckin || firstCheckin > shiftDay(cardsThrough, 1)) && !checkinWeeks.has(weekStart(cardsThrough))) {
      openWeeks.delete(weekStart(cardsThrough));
    }
    for (const w of checkinWeeks) openWeeks.add(w);
  }

  // Cards only: runs are counted to the end of the card history, since the
  // weeks after it have no card data for anyone.
  const asOf = source === "cards" ? (cardsThrough ?? businessDay().date) : businessDay().date;

  // Erased members (and any deleted since) drop out.
  const ids = [...days.keys()];
  const people = new Map<string, { name: string; avatar_url: string | null; tier: MemberTier }>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase.from("members").select("id, name, avatar_url, tier").in("id", ids.slice(i, i + 150)).is("erased_at", null);
    if (error) throw error;
    for (const m of data ?? []) people.set(m.id, m);
  }

  const ranked = [...days.entries()]
    .filter(([id]) => people.has(id))
    .map(([id, set]) => {
      const p = people.get(id)!;
      return { memberId: id, name: p.name, avatarUrl: p.avatar_url, tier: p.tier, ...regularity(set, openWeeks, asOf) };
    })
    .filter((r) => r.days > 0)
    .sort(compareRegulars(sort));

  return { rows: ranked.slice(0, limit), ranked: ranked.length, asOf, cardsThrough };
}
