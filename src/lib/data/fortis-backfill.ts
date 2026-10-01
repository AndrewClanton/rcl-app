import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CardDecision, MatchConfidence, MatchKind, MatchStatus } from "@/lib/fortis-backfill";

// Back office > Members > Points from past card purchases: what's loaded in
// fortis_cards, for owners and admins. Card numbers stop at the last four
// here: the first six stay in the database.

export type BackfillTab = "review" | "approved" | "pick" | "unclaimed" | "skipped" | "granted";
export const BACKFILL_TABS: BackfillTab[] = ["review", "approved", "pick", "unclaimed", "skipped", "granted"];
export const BACKFILL_PAGE_SIZE = 50;

export interface BackfillRow {
  id: string;
  lastFour: string;
  brand: string | null;
  holderName: string | null;
  saleCount: number;
  refundCount: number;
  netTotal: number;
  firstAt: string | null;
  lastAt: string | null;
  days: number;
  status: MatchStatus;
  kind: MatchKind | null;
  confidence: MatchConfidence | null;
  decision: CardDecision;
  member: { id: string; name: string } | null;
  candidates: { id: string; name: string }[];
  grantedAt: string | null;
  grantedPoints: number | null;
}

export interface BackfillSummary {
  cards: number;
  loadedAt: string | null;
  matched: number;
  needsPick: number;
  unclaimed: number;
  byKind: { email: number; phone: number; name: number; picked: number; pickName: number; pickSimilar: number; pickOther: number };
  tabs: Record<BackfillTab, number>;
  exactWaiting: number; // high-confidence matches nobody has approved yet
  dollars: { all: number; matched: number; approved: number; needsPick: number; unclaimed: number };
  granted: { members: number; points: number };
}

// One member's cards added up, for the live totals on the screen.
export interface MemberTotal {
  memberId: string;
  name: string;
  cards: number;
  approvedDollars: number; // approved, not granted yet
  waitingDollars: number; // matched, not approved yet
  alreadyGranted: number; // points earlier grants gave them
}

export interface BackfillData {
  summary: BackfillSummary;
  members: MemberTotal[];
  rows: BackfillRow[];
  total: number; // rows in this tab (and search)
  page: number;
}

interface CardRow {
  id: string;
  last_four: string;
  brand: string | null;
  holder_name: string | null;
  sale_count: number;
  refund_count: number;
  net_total: string | number;
  first_purchase_at: string | null;
  last_purchase_at: string | null;
  visit_dates: string[];
  match_status: MatchStatus;
  match_kind: MatchKind | null;
  match_confidence: MatchConfidence | null;
  matched_member_id: string | null;
  candidate_member_ids: string[];
  decision: CardDecision;
  granted_at: string | null;
  granted_points: string | number | null;
  loaded_at: string;
  erased_at: string | null;
}

const CARD_COLUMNS =
  "id, last_four, brand, holder_name, sale_count, refund_count, net_total, first_purchase_at, last_purchase_at, visit_dates, match_status, match_kind, match_confidence, matched_member_id, candidate_member_ids, decision, granted_at, granted_points, loaded_at, erased_at";

const cents = (n: number) => Math.round(n * 100) / 100;

export function tabOf(c: Pick<CardRow, "granted_at" | "decision" | "match_status">): BackfillTab {
  if (c.granted_at) return "granted";
  if (c.decision === "skipped") return "skipped";
  if (c.decision === "approved") return "approved";
  if (c.match_status === "matched") return "review";
  if (c.match_status === "needs_pick") return "pick";
  return "unclaimed";
}

async function readCards(): Promise<CardRow[]> {
  const supabase = createAdminClient();
  const out: CardRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("fortis_cards").select(CARD_COLUMNS).order("id").range(from, from + 999);
    if (error) throw error;
    out.push(...(data as CardRow[]));
    if (data.length < 1000) break;
  }
  return out;
}

// Names of these members (erased ones left out: they're never matched).
export async function memberNames(ids: Iterable<string>): Promise<Map<string, string>> {
  const supabase = createAdminClient();
  const all = [...new Set(ids)];
  const names = new Map<string, string>();
  for (let i = 0; i < all.length; i += 150) {
    const { data, error } = await supabase.from("members").select("id, name").in("id", all.slice(i, i + 150)).is("erased_at", null);
    if (error) throw error;
    for (const m of data ?? []) names.set(m.id, m.name);
  }
  return names;
}

async function grantedSoFar(): Promise<Map<string, number>> {
  const supabase = createAdminClient();
  const out = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("fortis_backfill_grants").select("id, member_id, points").order("id").range(from, from + 999);
    if (error) throw error;
    for (const g of data ?? []) out.set(g.member_id, (out.get(g.member_id) ?? 0) + Number(g.points));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function getBackfillData(opts: { tab: BackfillTab; query?: string; page?: number }): Promise<BackfillData> {
  const [cards, already] = await Promise.all([readCards(), grantedSoFar()]);
  const ids = new Set<string>();
  for (const c of cards) {
    if (c.matched_member_id) ids.add(c.matched_member_id);
    for (const id of c.candidate_member_ids ?? []) ids.add(id);
  }
  for (const id of already.keys()) ids.add(id);
  const names = await memberNames(ids);

  // ---- summary ----
  const tabs = Object.fromEntries(BACKFILL_TABS.map((t) => [t, 0])) as Record<BackfillTab, number>;
  const byKind = { email: 0, phone: 0, name: 0, picked: 0, pickName: 0, pickSimilar: 0, pickOther: 0 };
  const dollars = { all: 0, matched: 0, approved: 0, needsPick: 0, unclaimed: 0 };
  let matched = 0;
  let needsPick = 0;
  let unclaimed = 0;
  let exactWaiting = 0;
  let loadedAt: string | null = null;
  const totals = new Map<string, MemberTotal>();
  for (const c of cards) {
    const net = Number(c.net_total);
    const tab = tabOf(c);
    tabs[tab]++;
    dollars.all += net;
    if (!loadedAt || c.loaded_at > loadedAt) loadedAt = c.loaded_at;
    if (c.match_status === "matched" && c.matched_member_id && c.decision !== "skipped") {
      matched++;
      dollars.matched += net;
      if (c.match_kind === "email" || c.match_kind === "phone" || c.match_kind === "name" || c.match_kind === "picked") byKind[c.match_kind]++;
    } else if (c.match_status === "needs_pick" && c.decision !== "skipped") {
      needsPick++;
      dollars.needsPick += net;
      if (c.match_kind === "name") byKind.pickName++;
      else if (c.match_kind === "similar") byKind.pickSimilar++;
      else byKind.pickOther++;
    } else if (c.decision !== "skipped") {
      unclaimed++;
      dollars.unclaimed += net;
    }
    if (tab === "review" && c.match_confidence === "high") exactWaiting++;
    if ((tab === "approved" || tab === "review") && c.matched_member_id && names.has(c.matched_member_id)) {
      const t = totals.get(c.matched_member_id) ?? {
        memberId: c.matched_member_id,
        name: names.get(c.matched_member_id)!,
        cards: 0,
        approvedDollars: 0,
        waitingDollars: 0,
        alreadyGranted: already.get(c.matched_member_id) ?? 0,
      };
      t.cards++;
      if (tab === "approved") t.approvedDollars += Math.max(0, net);
      else t.waitingDollars += Math.max(0, net);
      totals.set(c.matched_member_id, t);
    }
    if (tab === "approved") dollars.approved += net;
  }
  const members = [...totals.values()].map((t) => ({ ...t, approvedDollars: cents(t.approvedDollars), waitingDollars: cents(t.waitingDollars) }));

  // ---- the list ----
  const q = (opts.query ?? "").trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  const inTab = cards.filter((c) => tabOf(c) === opts.tab);
  const found = !q
    ? inTab
    : inTab.filter((c) => {
        if (digits.length >= 2 && digits.length <= 4 && c.last_four.includes(digits)) return true;
        const hay = [c.holder_name, nameOf(c.matched_member_id), ...(c.candidate_member_ids ?? []).map(nameOf)].filter(Boolean).join(" ").toLowerCase();
        return q.split(/\s+/).every((w) => hay.includes(w));
      });
  found.sort((a, b) => Number(b.net_total) - Number(a.net_total) || (a.id < b.id ? -1 : 1));
  const pages = Math.max(1, Math.ceil(found.length / BACKFILL_PAGE_SIZE));
  const page = Math.min(Math.max(1, opts.page ?? 1), pages);
  const rows: BackfillRow[] = found.slice((page - 1) * BACKFILL_PAGE_SIZE, page * BACKFILL_PAGE_SIZE).map((c) => ({
    id: c.id,
    lastFour: c.last_four,
    brand: c.brand,
    holderName: c.holder_name,
    saleCount: c.sale_count,
    refundCount: c.refund_count,
    netTotal: Number(c.net_total),
    firstAt: c.first_purchase_at,
    lastAt: c.last_purchase_at,
    days: c.visit_dates?.length ?? 0,
    status: c.match_status,
    kind: c.match_kind,
    confidence: c.match_confidence,
    decision: c.decision,
    member: c.matched_member_id && names.has(c.matched_member_id) ? { id: c.matched_member_id, name: names.get(c.matched_member_id)! } : null,
    candidates: (c.candidate_member_ids ?? []).filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! })),
    grantedAt: c.granted_at,
    grantedPoints: c.granted_points === null ? null : Number(c.granted_points),
  }));

  return {
    summary: {
      cards: cards.length,
      loadedAt,
      matched,
      needsPick,
      unclaimed,
      byKind,
      tabs,
      exactWaiting,
      dollars: {
        all: cents(dollars.all),
        matched: cents(dollars.matched),
        approved: cents(dollars.approved),
        needsPick: cents(dollars.needsPick),
        unclaimed: cents(dollars.unclaimed),
      },
      granted: { members: [...already.values()].filter((p) => p > 0).length, points: [...already.values()].reduce((s, p) => s + p, 0) },
    },
    members,
    rows,
    total: found.length,
    page,
  };
}
