import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_GRANT_SETTINGS, planGrant, pointsForDollars, validSettings, type GrantSettings } from "@/lib/fortis-backfill";
import {
  MAX_SHOWN,
  assignRule,
  businessDateRange,
  lookupStatus,
  matchCards,
  monthYear,
  settingsLabel,
  verdictFor,
  type AssignRule,
  type LookupInput,
  type LookupStatus,
  type LookupVerdict,
  type SaleForLookup,
} from "@/lib/fortis-lookup";
import { firstNameOf } from "@/lib/checkin";

// Rewind (Back office > Members > Points from past card purchases): finding
// a regular's old card from a purchase or two off their bank app, and what
// their cards' visits add up to. Card numbers stop at the last four here;
// the first six never leave the server.

export interface RewindCard {
  id: string;
  lastFour: string;
  brand: string | null;
  holderName: string | null;
  purchases: number;
  visits: number; // business days with a purchase
  netTotal: number;
  firstAt: string | null;
  lastAt: string | null;
  since: string; // "March 2023"
  status: LookupStatus;
  approved: boolean; // a person approved its current match
  member: { id: string; name: string } | null; // matched or granted to
  grantedPoints: number | null;
  grantedAt: string | null;
  points: number; // what it gave, or what it's worth at today's settings (before any cap)
  assign: AssignRule; // for the staff member looking
  seen: { memberId: string | null; decision: string }; // its match as shown, sent back with an assign
}

export interface RewindResult {
  verdict: LookupVerdict;
  total: number; // cards that fit; up to MAX_SHOWN come back
  cards: RewindCard[];
}

// "Give <first name> these points now": this member's cards found with
// Rewind, approved and not given yet.
export interface RewindPreview {
  member: { id: string; name: string; firstName: string };
  cards: { id: string; lastFour: string }[];
  points: number;
  balance: number;
  after: number;
  visits: number;
  since: string;
  settings: string; // "1 point per $1 before tax"
}

const CARD_COLUMNS =
  "id, card_key, last_four, brand, holder_name, sale_count, net_total, first_purchase_at, last_purchase_at, visit_dates, match_status, matched_member_id, decision, granted_at, granted_member_id, granted_points, erased_at";

interface CardRow {
  id: string;
  card_key: string;
  last_four: string;
  brand: string | null;
  holder_name: string | null;
  sale_count: number;
  net_total: string | number;
  first_purchase_at: string | null;
  last_purchase_at: string | null;
  visit_dates: string[] | null;
  match_status: string;
  matched_member_id: string | null;
  decision: string;
  granted_at: string | null;
  granted_member_id: string | null;
  granted_points: string | number | null;
  erased_at: string | null;
}

// The settings the last grant used (Back office's Grant, or an earlier
// Rewind), so everyone's past visits count the same; the standard 1 point
// per $1 before tax until there's been one.
export async function currentGrantSettings(): Promise<GrantSettings> {
  const { data, error } = await createAdminClient().from("fortis_backfill_grants").select("settings, granted_at").order("granted_at", { ascending: false }).limit(1);
  if (error) throw error;
  const raw = (data?.[0]?.settings ?? null) as { rate?: unknown; cap?: unknown; taxOut?: unknown } | null;
  if (!raw) return DEFAULT_GRANT_SETTINGS;
  const s: GrantSettings = { rate: Number(raw.rate), cap: raw.cap === null || raw.cap === undefined ? null : Number(raw.cap), taxOut: raw.taxOut !== false };
  return validSettings(s) ? s : DEFAULT_GRANT_SETTINGS;
}

async function grantedSoFar(memberId: string): Promise<number> {
  const { data, error } = await createAdminClient().from("fortis_backfill_grants").select("points").eq("member_id", memberId);
  if (error) throw error;
  return (data ?? []).reduce((s, g) => s + Number(g.points), 0);
}

async function memberNames(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (!unique.length) return names;
  const { data, error } = await createAdminClient().from("members").select("id, name").in("id", unique).is("erased_at", null);
  if (error) throw error;
  for (const m of data ?? []) names.set(m.id, m.name);
  return names;
}

// Each card's visit days: its sales in fortis_sales, or the days stored on
// the card when its sales aren't loaded.
export async function visitDaysByCard(cards: { card_key: string; visit_dates: string[] | null }[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const keys = [...new Set(cards.map((c) => c.card_key))];
  const supabase = createAdminClient();
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("fortis_sales")
        .select("id, card_key, business_date")
        .in("card_key", chunk)
        .eq("kind", "sale")
        .order("id")
        .range(from, from + 999);
      if (error) throw error;
      for (const s of data ?? []) {
        const set = out.get(s.card_key) ?? new Set<string>();
        set.add(s.business_date);
        out.set(s.card_key, set);
      }
      if (!data || data.length < 1000) break;
    }
  }
  for (const c of cards) if (!out.has(c.card_key) && c.visit_dates?.length) out.set(c.card_key, new Set(c.visit_dates));
  return out;
}

function toRewindCard(c: CardRow, names: Map<string, string>, s: GrantSettings, isAdmin: boolean, days: Set<string> | undefined): RewindCard {
  const status = lookupStatus(c);
  const memberId = status === "granted" ? (c.granted_member_id ?? c.matched_member_id) : c.matched_member_id;
  const dates = [...(days ?? new Set(c.visit_dates ?? []))].sort();
  const net = Number(c.net_total);
  return {
    id: c.id,
    lastFour: c.last_four,
    brand: c.brand,
    holderName: c.holder_name,
    purchases: c.sale_count,
    visits: dates.length,
    netTotal: net,
    firstAt: c.first_purchase_at,
    lastAt: c.last_purchase_at,
    since: monthYear(dates[0] ?? c.first_purchase_at),
    status,
    approved: c.decision === "approved",
    member: memberId && names.has(memberId) ? { id: memberId, name: names.get(memberId)! } : null,
    grantedPoints: c.granted_points === null ? null : Number(c.granted_points),
    grantedAt: c.granted_at,
    points: c.granted_at ? Number(c.granted_points ?? 0) : pointsForDollars(net, s),
    assign: assignRule(status, c.decision === "approved", isAdmin),
    seen: { memberId: c.matched_member_id, decision: c.decision },
  };
}

// The cards with a sale for every purchase given (and the last 4, if given).
export async function findRewindCards(input: LookupInput, isAdmin: boolean): Promise<RewindResult> {
  const supabase = createAdminClient();
  const sales: SaleForLookup[] = [];
  for (const p of input.purchases) {
    const r = businessDateRange(p.date, input.postingDates);
    let q = supabase
      .from("fortis_sales")
      .select("id, card_key, business_date, amount_cents, created_at, kind")
      .eq("kind", "sale")
      .eq("amount_cents", p.cents)
      .gte("business_date", r.from)
      .lte("business_date", r.to);
    if (input.lastFour) q = q.eq("last_four", input.lastFour);
    const { data, error } = await q.order("id").limit(1000);
    if (error) throw error;
    for (const s of data ?? []) {
      sales.push({ id: s.id, cardKey: s.card_key, businessDate: s.business_date, amountCents: s.amount_cents, createdAt: s.created_at, kind: s.kind });
    }
  }
  const keys = matchCards(sales, input);
  if (!keys.length) return { verdict: "none", total: 0, cards: [] };

  const { data, error } = await supabase.from("fortis_cards").select(CARD_COLUMNS).in("card_key", keys.slice(0, 200));
  if (error) throw error;
  const rows = (data ?? []) as CardRow[];
  rows.sort((a, b) => (b.visit_dates?.length ?? 0) - (a.visit_dates?.length ?? 0) || (a.id < b.id ? -1 : 1));
  const shown = rows.slice(0, MAX_SHOWN);
  const [names, settings, days] = await Promise.all([
    memberNames(shown.flatMap((c) => [c.matched_member_id, c.granted_member_id].filter((x): x is string => !!x))),
    currentGrantSettings(),
    visitDaysByCard(shown),
  ]);
  // (Every sale's card has a row; past the first 200, just count them.)
  const total = keys.length > 200 ? keys.length : rows.length;
  return {
    verdict: verdictFor(total),
    total,
    cards: shown.map((c) => toRewindCard(c, names, settings, isAdmin, days.get(c.card_key))),
  };
}

export async function getRewindCard(cardId: string, isAdmin: boolean): Promise<RewindCard | null> {
  const { data, error } = await createAdminClient().from("fortis_cards").select(CARD_COLUMNS).eq("id", cardId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const c = data as CardRow;
  const [names, settings, days] = await Promise.all([
    memberNames([c.matched_member_id, c.granted_member_id].filter((x): x is string => !!x)),
    currentGrantSettings(),
    visitDaysByCard([c]),
  ]);
  return toRewindCard(c, names, settings, isAdmin, days.get(c.card_key));
}

// The member's Rewind cards waiting to be given (all of them, or just
// cardIds), worked out the same way Back office's Grant would: today's
// settings, any cap counting what earlier grants gave them.
export async function rewindPreview(memberId: string, cardIds?: string[]): Promise<(RewindPreview & { plan: { id: string; points: number }[]; dollars: number; settingsUsed: GrantSettings }) | null> {
  const supabase = createAdminClient();
  const { data: member, error: mErr } = await supabase.from("members").select("id, name, points").eq("id", memberId).is("erased_at", null).maybeSingle();
  if (mErr) throw mErr;
  if (!member) return null;
  let q = supabase
    .from("fortis_cards")
    .select("id, card_key, last_four, net_total, visit_dates")
    .eq("matched_member_id", memberId)
    .eq("decision", "approved")
    .eq("match_kind", "lookup")
    .is("granted_at", null)
    .is("erased_at", null);
  if (cardIds) q = q.in("id", cardIds);
  const { data: cards, error } = await q.order("id");
  if (error) throw error;
  if (!cards?.length) return null;
  const [settings, already, days] = await Promise.all([currentGrantSettings(), grantedSoFar(memberId), visitDaysByCard(cards)]);
  const [plan] = planGrant(
    cards.map((c) => ({ id: c.id, memberId, dollars: Number(c.net_total) })),
    settings,
    new Map([[memberId, already]]),
  );
  const allDays = [...new Set(cards.flatMap((c) => [...(days.get(c.card_key) ?? [])]))].sort();
  const balance = Number(member.points);
  return {
    member: { id: member.id, name: member.name, firstName: firstNameOf(member.name) },
    cards: cards.map((c) => ({ id: c.id, lastFour: c.last_four })),
    points: plan.points,
    balance,
    after: balance + plan.points,
    visits: allDays.length,
    since: monthYear(allDays[0]),
    settings: settingsLabel(settings),
    plan: plan.cards,
    dollars: plan.dollars,
    settingsUsed: settings,
  };
}

// ---------- a member's visits before the new system ----------

export interface PastVisits {
  days: number; // on cards a person confirmed: approved (by review or Rewind) or granted
  first: string | null;
  since: string; // "March 2023"
  waiting: number; // more days on cards matched to them that nobody has reviewed yet
}

// Visit days only, never card digits. Cards whose member's info was removed
// are unlinked (members_erase_fortis_cards), so they drop out on their own.
export async function getPastVisits(memberId: string): Promise<PastVisits | null> {
  const { data, error } = await createAdminClient()
    .from("fortis_cards")
    .select("card_key, decision, visit_dates")
    .eq("matched_member_id", memberId)
    .neq("decision", "skipped")
    .is("erased_at", null);
  if (error) throw error;
  if (!data?.length) return null;
  const days = await visitDaysByCard(data);
  const confirmed = new Set<string>();
  const all = new Set<string>();
  for (const c of data) {
    for (const d of days.get(c.card_key) ?? []) {
      all.add(d);
      if (c.decision === "approved") confirmed.add(d);
    }
  }
  if (!all.size) return null;
  const first = [...confirmed].sort()[0] ?? null;
  return { days: confirmed.size, first, since: monthYear(first), waiting: all.size - confirmed.size };
}
