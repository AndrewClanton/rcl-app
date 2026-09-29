import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay, businessDayWindow } from "@/lib/ops/time";
import type { MemberTier } from "@/lib/types";

// "Top regulars": who came in most, and who spent most, in one business
// month (4 a.m. on the 1st to 4 a.m. on the 1st of the next, Central) --
// for picking prize winners. A visit is a business day with a completed
// order on their account, or a movie they had an online ticket for (on the
// day of the showing, once it's started). Register ticket sales are already
// inside their order. Spend is what they paid, tax included, tips not.

export interface RegularRow {
  memberId: string;
  name: string;
  tier: MemberTier;
  avatarUrl: string | null;
  points: number;
  visits: number;
  spend: number;
  lastVisit: string;
}

export interface RegularsReport {
  month: string; // "YYYY-MM"
  visitors: number; // members with at least one visit
  byVisits: RegularRow[];
  bySpend: RegularRow[];
}

// The business month it is right now, "YYYY-MM".
export function currentBusinessMonth(): string {
  return businessDay().date.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export async function getTopRegulars(month: string, limit = 25): Promise<RegularsReport> {
  const supabase = createAdminClient();
  const start = businessDayWindow(`${month}-01`).start;
  const end = businessDayWindow(`${shiftMonth(month, 1)}-01`).start;
  const nowIso = new Date().toISOString();

  const tally = new Map<string, { days: Set<string>; spend: number; last: string }>();
  const add = (memberId: string, at: string, amount: number) => {
    const t = tally.get(memberId) ?? { days: new Set<string>(), spend: 0, last: at };
    t.days.add(businessDay(new Date(at)).date);
    t.spend += amount;
    if (at > t.last) t.last = at;
    tally.set(memberId, t);
  };

  // Paged: the database returns at most 1,000 rows per request.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("orders")
      .select("id, member_id, completed_at, total, tip")
      .eq("status", "completed")
      .not("member_id", "is", null)
      .gte("completed_at", start)
      .lt("completed_at", end)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    for (const o of data ?? []) add(o.member_id, o.completed_at, Number(o.total) - Number(o.tip ?? 0));
    if (!data || data.length < 1000) break;
  }

  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("bookings")
      .select("id, member_id, quantity, unit_price, tax_amount, screening:screenings!inner(starts_at)")
      .eq("status", "confirmed")
      .is("order_id", null)
      .not("member_id", "is", null)
      .gte("screening.starts_at", start)
      .lt("screening.starts_at", end < nowIso ? end : nowIso)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    type Row = { member_id: string; quantity: number; unit_price: number; tax_amount: number | null; screening: { starts_at: string } | { starts_at: string }[] | null };
    for (const b of (data ?? []) as unknown as Row[]) {
      const s = Array.isArray(b.screening) ? b.screening[0] : b.screening;
      if (s) add(b.member_id, s.starts_at, b.quantity * Number(b.unit_price) + Number(b.tax_amount ?? 0));
    }
    if (!data || data.length < 1000) break;
  }

  const ranked = [...tally.entries()].map(([memberId, t]) => ({ memberId, visits: t.days.size, spend: Math.round(t.spend * 100) / 100, lastVisit: t.last }));
  const byVisits = [...ranked].sort((a, b) => b.visits - a.visits || b.spend - a.spend || b.lastVisit.localeCompare(a.lastVisit)).slice(0, limit);
  const bySpend = [...ranked].sort((a, b) => b.spend - a.spend || b.visits - a.visits || b.lastVisit.localeCompare(a.lastVisit)).slice(0, limit);

  // Names and points for just the members shown (erased accounts drop out).
  const ids = [...new Set([...byVisits, ...bySpend].map((r) => r.memberId))];
  const members = new Map<string, { name: string; tier: MemberTier; avatar_url: string | null; points: number }>();
  if (ids.length) {
    const { data, error } = await supabase.from("members").select("id, name, tier, avatar_url, points").in("id", ids).is("erased_at", null);
    if (error) throw error;
    for (const m of data ?? []) members.set(m.id, { name: m.name, tier: m.tier, avatar_url: m.avatar_url, points: Number(m.points) });
  }
  const withMember = (rows: typeof ranked): RegularRow[] =>
    rows.flatMap((r) => {
      const m = members.get(r.memberId);
      return m ? [{ ...r, name: m.name, tier: m.tier, avatarUrl: m.avatar_url, points: m.points }] : [];
    });

  return { month, visitors: tally.size, byVisits: withMember(byVisits), bySpend: withMember(bySpend) };
}
