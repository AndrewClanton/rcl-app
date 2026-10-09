import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fortisBrandName, pastPurchasePoints, queueReason, type QueueReason } from "@/lib/fortis-claim";

// Past card purchases (Fortis): Back office's Needs approval list, and a
// member's old-register purchases for their purchase history. Card numbers
// stop at the last four.

type Db = ReturnType<typeof createAdminClient>;

export interface QueueCard {
  id: string;
  lastFour: string;
  brand: string;
  holderName: string | null;
  visits: number;
  firstAt: string | null;
  lastAt: string | null;
  netTotal: number;
  points: number;
  reason: QueueReason;
  member: { id: string; name: string } | null; // who it's matched to now
  candidates: { id: string; name: string }[]; // for a card more than one member fits
}

const CARD_COLUMNS =
  "id, last_four, brand, holder_name, visit_dates, first_purchase_at, last_purchase_at, net_total, match_status, match_kind, match_confidence, decision, matched_member_id, candidate_member_ids, granted_at, erased_at";

type CardRow = {
  id: string;
  last_four: string;
  brand: string | null;
  holder_name: string | null;
  visit_dates: string[] | null;
  first_purchase_at: string | null;
  last_purchase_at: string | null;
  net_total: number | string;
  match_status: string;
  match_kind: string | null;
  match_confidence: string | null;
  decision: string;
  matched_member_id: string | null;
  candidate_member_ids: string[] | null;
  granted_at: string | null;
  erased_at: string | null;
};

async function grantedByMember(db: Db, memberIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < memberIds.length; i += 150) {
    const { data, error } = await db.from("fortis_backfill_grants").select("member_id, points").in("member_id", memberIds.slice(i, i + 150));
    if (error) throw error;
    for (const g of data ?? []) out.set(g.member_id, (out.get(g.member_id) ?? 0) + Number(g.points));
  }
  return out;
}

// Every card waiting for a manager: biggest first.
export async function getApprovalQueue(): Promise<QueueCard[]> {
  const db = createAdminClient();
  const rows: CardRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("fortis_cards")
      .select(CARD_COLUMNS)
      .in("match_status", ["matched", "needs_pick"])
      .is("granted_at", null)
      .is("erased_at", null)
      .neq("decision", "skipped")
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as CardRow[]));
    if (!data || data.length < 1000) break;
  }
  const memberIds = [...new Set(rows.flatMap((r) => [r.matched_member_id, ...(r.candidate_member_ids ?? [])]).filter((x): x is string => !!x))];
  const granted = await grantedByMember(db, memberIds);
  const names = new Map<string, string>();
  for (let i = 0; i < memberIds.length; i += 150) {
    const { data, error } = await db.from("members").select("id, name").in("id", memberIds.slice(i, i + 150)).is("erased_at", null);
    if (error) throw error;
    for (const m of data ?? []) names.set(m.id, m.name);
  }
  const out: QueueCard[] = [];
  for (const r of rows) {
    const reason = queueReason(r, r.matched_member_id ? (granted.get(r.matched_member_id) ?? 0) : 0);
    if (!reason) continue;
    const member = r.matched_member_id && names.has(r.matched_member_id) ? { id: r.matched_member_id, name: names.get(r.matched_member_id)! } : null;
    out.push({
      id: r.id,
      lastFour: r.last_four,
      brand: fortisBrandName(r.brand),
      holderName: r.holder_name,
      visits: (r.visit_dates ?? []).length,
      firstAt: r.first_purchase_at,
      lastAt: r.last_purchase_at,
      netTotal: Number(r.net_total),
      points: pastPurchasePoints(Number(r.net_total)),
      reason,
      member,
      candidates: (r.candidate_member_ids ?? []).filter((id) => names.has(id)).map((id) => ({ id, name: names.get(id)! })),
    });
  }
  return out.sort((a, b) => b.points - a.points || (a.id < b.id ? -1 : 1));
}

// ---------- purchase history ----------

export interface OldRegisterPurchase {
  id: string;
  date: string;
  amount: number; // dollars as charged; a refund is negative
  refund: boolean;
}

// The sales on a member's approved (or paid) old-register cards. Empty when
// there are none, or the tables aren't there.
export async function oldRegisterPurchases(memberId: string): Promise<OldRegisterPurchase[]> {
  const db = createAdminClient();
  const { data: cards, error } = await db
    .from("fortis_cards")
    .select("card_key")
    .is("erased_at", null)
    .or(`granted_member_id.eq.${memberId},and(matched_member_id.eq.${memberId},decision.eq.approved)`);
  if (error || !cards?.length) return [];
  const keys = [...new Set(cards.map((c) => c.card_key as string))];
  const out: OldRegisterPurchase[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error: e } = await db
      .from("fortis_sales")
      .select("id, created_at, amount_cents, kind")
      .in("card_key", keys)
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (e) return out;
    for (const s of data ?? []) {
      const refund = s.kind === "refund";
      out.push({ id: s.id, date: s.created_at, amount: ((refund ? -1 : 1) * Number(s.amount_cents)) / 100, refund });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

export const OLD_REGISTER_LABEL = "Card purchase (old register)";
export const OLD_REGISTER_REFUND_LABEL = "Card refund (old register)";
