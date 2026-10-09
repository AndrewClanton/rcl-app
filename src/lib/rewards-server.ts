import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PAID_ENTRANCE_KEYS,
  isGoodSection,
  isPerkSlot,
  parseLook,
  perkOption,
  rewardLineName,
  sortOffers,
  type GoodSection,
  type MemberLook,
  type PerkSlot,
  type RewardKind,
  type RewardOffer,
} from "@/lib/rewards";
import { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";

// Spending points: the catalog, what one member can have, unlocking a perk,
// the goods on a sale, and the settings and reports in Back office -> Points.
// The rules that must hold with the member's row locked (enough points,
// within the limits, never twice) live in the database functions of
// migration 20261007020000; this file only calls them and words the answers.

export interface CatalogRow {
  id: string;
  name: string;
  description: string | null;
  kind: RewardKind;
  section: GoodSection | null; // a good's section; null: guessed from its name
  perk_slot: PerkSlot | null;
  perk_key: string | null;
  perk_days: number | null;
  points: number;
  real_cost: number | null;
  is_alcohol: boolean;
  daily_limit: number | null;
  monthly_limit: number | null;
  stock: number | null;
  active: boolean;
  sort: number;
}

const CATALOG_COLUMNS = "id, name, description, kind, section, perk_slot, perk_key, perk_days, points, real_cost, is_alcohol, daily_limit, monthly_limit, stock, active, sort";

function toRow(r: Record<string, unknown>): CatalogRow {
  return {
    id: String(r.id),
    name: String(r.name),
    description: (r.description as string | null) ?? null,
    kind: r.kind as RewardKind,
    section: isGoodSection(r.section) ? r.section : null,
    perk_slot: isPerkSlot(r.perk_slot) ? r.perk_slot : null,
    perk_key: (r.perk_key as string | null) ?? null,
    perk_days: r.perk_days === null || r.perk_days === undefined ? null : Number(r.perk_days),
    points: Number(r.points),
    real_cost: r.real_cost === null || r.real_cost === undefined ? null : Number(r.real_cost),
    is_alcohol: !!r.is_alcohol,
    daily_limit: r.daily_limit === null || r.daily_limit === undefined ? null : Number(r.daily_limit),
    monthly_limit: r.monthly_limit === null || r.monthly_limit === undefined ? null : Number(r.monthly_limit),
    stock: r.stock === null || r.stock === undefined ? null : Number(r.stock),
    active: !!r.active,
    sort: Number(r.sort) || 0,
  };
}

export async function rewardCatalog(activeOnly = false): Promise<CatalogRow[]> {
  let q = createAdminClient().from("reward_catalog").select(CATALOG_COLUMNS).order("sort").order("points");
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => toRow(r as Record<string, unknown>));
}

// ---------- owned perks ----------

export interface OwnedPerk {
  slot: PerkSlot;
  key: string;
  expiresAt: string | null;
}

export async function ownedPerks(memberId: string): Promise<OwnedPerk[]> {
  const { data } = await createAdminClient().from("member_perks").select("slot, perk_key, expires_at").eq("member_id", memberId);
  const now = Date.now();
  return (data ?? []).flatMap((r) => {
    const exp = (r.expires_at as string | null) ?? null;
    if (exp && Date.parse(exp) <= now) return [];
    return isPerkSlot(r.slot) ? [{ slot: r.slot, key: String(r.perk_key), expiresAt: exp }] : [];
  });
}

// A timed perk that ran out: whatever they show of it goes back to the
// default. Best effort; a failure leaves it showing a little longer.
export async function sweepPerks(memberId: string): Promise<void> {
  const { error } = await createAdminClient().rpc("sweep_member_perks", { p_member: memberId, p_paid_entrances: PAID_ENTRANCE_KEYS });
  if (error) console.error("sweep_member_perks failed", error.code, error.message);
}

export function lookOf(row: Record<string, unknown> | null | undefined): MemberLook {
  return parseLook(row ?? null);
}

// ---------- what one member can have ----------

export interface Wallet {
  firstName: string;
  points: number;
  earned: number;
  look: MemberLook;
  entrance: string | null;
  offers: RewardOffer[];
  owned: OwnedPerk[];
}

export async function lifetimeTotals(memberId: string): Promise<{ earned: number; spent: number }> {
  const { data } = await createAdminClient().from("member_points_totals").select("earned, spent").eq("member_id", memberId).maybeSingle();
  return { earned: Math.round(Number(data?.earned ?? 0)), spent: Math.round(Number(data?.spent ?? 0)) };
}

// Every active reward, for this member: cheapest first, each with whether
// they own it (a perk) and why they can't have it right now (a limit, all
// gone), besides points. pending: rewards already on their order (counted
// against the limits as if used).
export async function walletFor(memberId: string, pending: { rewardId: string; qty: number }[] = []): Promise<Wallet | null> {
  await sweepPerks(memberId);
  const supabase = createAdminClient();
  const [{ data: m }, catalog, owned, totals] = await Promise.all([
    supabase.from("members").select("*").eq("id", memberId).is("erased_at", null).maybeSingle(),
    rewardCatalog(true),
    ownedPerks(memberId),
    lifetimeTotals(memberId),
  ]);
  if (!m) return null;
  const ownedKey = new Map(owned.map((o) => [`${o.slot}:${o.key}`, o]));
  const pendingGoods = pending.reduce((s, p) => s + (catalog.find((c) => c.id === p.rewardId)?.kind === "good" ? p.qty : 0), 0);
  const problems = await Promise.all(
    catalog.map(async (c) => {
      if (c.kind === "perk" && c.perk_slot === "mobile") return "Coming soon.";
      // Nothing to count: only goods, and anything with a limit or stock.
      if (c.kind !== "good" && c.daily_limit === null && c.monthly_limit === null && c.stock === null) return null;
      const same = pending.filter((p) => p.rewardId === c.id).reduce((s, p) => s + p.qty, 0);
      const { data } = await supabase.rpc("reward_limit_problem", { p_member: memberId, p_reward: c.id, p_qty: 1, p_pending: same, p_pending_goods: pendingGoods });
      return (data as string | null) ?? null;
    }),
  );
  const offers: RewardOffer[] = catalog.flatMap((c, i) => {
    if (c.kind === "perk" && (!c.perk_slot || !perkOption(c.perk_slot, c.perk_key))) return [];
    const own = c.perk_slot && c.perk_key ? ownedKey.get(`${c.perk_slot}:${c.perk_key}`) : undefined;
    return [
      {
        id: c.id,
        name: c.name,
        description: c.description,
        kind: c.kind,
        section: c.section,
        slot: c.perk_slot,
        key: c.perk_key,
        days: c.perk_days,
        points: c.kind === "discount" ? POINTS_PER_REWARD : c.points,
        alcohol: c.is_alcohol,
        owned: !!own,
        until: own?.expiresAt ?? null,
        soon: c.perk_slot === "mobile",
        // A perk they own for good can't be bought again; a timed one can be extended.
        problem: own && !own.expiresAt ? null : problems[i],
      },
    ];
  });
  const row = m as Record<string, unknown>;
  return {
    firstName: String(row.display_name || row.name || "").split(/\s+/)[0] || "Member",
    points: Math.max(0, Math.floor(Number(row.points) || 0)),
    earned: totals.earned,
    look: lookOf(row),
    entrance: (row.flair_effect as string | null) ?? null,
    offers: sortOffers(offers),
    owned,
  };
}

// ---------- unlocking a perk ----------

export type UnlockResult =
  | { ok: true; status: "ok" | "owned"; balance: number; expiresAt: string | null; slot: PerkSlot; key: string; name: string }
  | { ok: false; error: string };

export async function unlockPerk(memberId: string, rewardId: string, by: string | null): Promise<UnlockResult> {
  const supabase = createAdminClient();
  const { data: reward } = await supabase.from("reward_catalog").select(CATALOG_COLUMNS).eq("id", rewardId).maybeSingle();
  const r = reward ? toRow(reward as Record<string, unknown>) : null;
  if (!r || r.kind !== "perk" || !r.perk_slot || !r.perk_key) return { ok: false, error: "That isn't one you can unlock." };
  if (r.perk_slot === "mobile") return { ok: false, error: "That one's coming with mobile ordering." };
  const { data, error } = await supabase.rpc("unlock_reward_perk", { p_member: memberId, p_reward: rewardId, p_by: by });
  if (error || !data) {
    if (error) console.error("unlock_reward_perk failed", error.code, error.message);
    return { ok: false, error: "That didn't go through. Try again in a moment." };
  }
  const res = data as { status: string; balance?: number | string; expires_at?: string | null; problem?: string };
  const balance = Math.floor(Number(res.balance ?? 0));
  if (res.status === "ok" || res.status === "owned") {
    return { ok: true, status: res.status, balance, expiresAt: res.expires_at ?? null, slot: r.perk_slot, key: r.perk_key, name: r.name };
  }
  if (res.status === "short") return { ok: false, error: `That's ${r.points - balance} more points.` };
  if (res.status === "limit") return { ok: false, error: res.problem ?? "Not right now." };
  return { ok: false, error: "That reward isn't available right now." };
}

// ---------- what they show ----------

const LOOK_COLUMN: Record<Exclude<PerkSlot, "mobile">, string> = {
  sound: "perk_sound",
  entrance: "flair_effect",
  frame: "perk_frame",
  name_color: "perk_name_color",
  title: "perk_title",
};

// Picks one they own for a slot (null: the default). The free entrances
// are picked on the account's Profile tab as before.
export async function setLook(memberId: string, slot: PerkSlot, key: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (slot === "mobile") return { ok: false, error: "Coming soon." };
  if (key !== null) {
    if (!perkOption(slot, key)) return { ok: false, error: "That isn't one of the choices." };
    const owned = await ownedPerks(memberId);
    if (!owned.some((o) => o.slot === slot && o.key === key)) return { ok: false, error: "Unlock that one with points first." };
  }
  const value = key ?? (slot === "entrance" ? "classic" : null);
  const { error } = await createAdminClient().from("members").update({ [LOOK_COLUMN[slot]]: value }).eq("id", memberId);
  return error ? { ok: false, error: "That didn't save. Try again." } : { ok: true };
}

// ---------- goods on an order ----------

export type OrderRewardCheck =
  | { ok: true; rewardId: string; kind: "good" | "discount"; name: string; lineName: string; points: number; isAlcohol: boolean }
  | { ok: false; error: string };

// Whether a good (or the $5 off) can go on this member's order now: active,
// within its limits and the goods limits (counting what's on the order
// already), and covered by their points after what's on the order.
// pending: the order's reward lines; pendingPoints: points the order
// already uses (its reward lines and any $5 off).
export async function checkRewardForOrder(
  memberId: string,
  rewardId: string,
  pending: { rewardId: string; qty: number }[],
  pendingPoints: number,
  discountOn: boolean,
): Promise<OrderRewardCheck> {
  const supabase = createAdminClient();
  const [{ data: reward }, { data: m }] = await Promise.all([
    supabase.from("reward_catalog").select(CATALOG_COLUMNS).eq("id", rewardId).maybeSingle(),
    supabase.from("members").select("points").eq("id", memberId).is("erased_at", null).maybeSingle(),
  ]);
  const r = reward ? toRow(reward as Record<string, unknown>) : null;
  if (!r || !r.active || r.kind === "perk") return { ok: false, error: "That reward isn't available right now." };
  if (!m) return { ok: false, error: "Their account couldn't be found." };
  if (r.kind === "discount" && discountOn) return { ok: false, error: "The $5 off is already on this order." };
  const cost = r.kind === "discount" ? POINTS_PER_REWARD : r.points;
  const have = Math.floor(Number(m.points) || 0) - Math.max(0, Math.round(pendingPoints));
  if (have < cost) return { ok: false, error: `That's ${cost - have} more points.` };
  const ids = new Set(pending.map((p) => p.rewardId));
  const goods = ids.size ? await supabase.from("reward_catalog").select("id, kind").in("id", [...ids]) : { data: [] as { id: string; kind: string }[] };
  const goodIds = new Set((goods.data ?? []).filter((g) => g.kind === "good").map((g) => g.id as string));
  const same = pending.filter((p) => p.rewardId === rewardId).reduce((s, p) => s + p.qty, 0);
  const pendingGoods = pending.filter((p) => goodIds.has(p.rewardId)).reduce((s, p) => s + p.qty, 0);
  const { data: problem, error } = await supabase.rpc("reward_limit_problem", { p_member: memberId, p_reward: rewardId, p_qty: 1, p_pending: same, p_pending_goods: pendingGoods });
  if (error) return { ok: false, error: "That couldn't be checked just now. Try again." };
  if (problem) return { ok: false, error: String(problem) };
  return { ok: true, rewardId: r.id, kind: r.kind, name: r.name, lineName: rewardLineName(r.name, cost), points: cost, isAlcohol: r.is_alcohol };
}

// Once the sale is saved: the goods on it come out of their points (see
// redeem_order_rewards). Never throws: the sale already stands. Returns
// what couldn't be covered, for a manager.
export async function redeemOrderRewards(args: {
  memberId: string;
  orderId: string;
  items: { rewardId: string; qty: number }[];
  discountPoints: number;
  by: string | null;
}): Promise<{ short: { name?: string; points?: number; balance?: number }[] } | null> {
  if (!args.items.length && !args.discountPoints) return { short: [] };
  const { data, error } = await createAdminClient().rpc("redeem_order_rewards", {
    p_member: args.memberId,
    p_order: args.orderId,
    p_items: args.items.map((i) => ({ reward_id: i.rewardId, quantity: i.qty })),
    p_discount_points: args.discountPoints,
    p_by: args.by,
  });
  if (error) {
    console.error("redeem_order_rewards failed", error.code, error.message);
    return null;
  }
  const res = data as { short?: { name?: string; points?: number; balance?: number }[] };
  return { short: res.short ?? [] };
}

export interface RedeemShort {
  reward_id?: string;
  name?: string;
  points?: number;
  balance?: number;
  why?: "short" | "limit" | "stock" | "not_found";
  problem?: string;
}

// The sale's whole points spending in one locked step: the $5 off
// (discountPoints) and the goods, each checked against the balance, its
// limits and stock (redeem_order_points, 20261008030000). Never throws: the
// sale already stands. null: it couldn't run; short: what wasn't taken.
export async function redeemOrderPoints(args: {
  memberId: string;
  orderId: string;
  items: { rewardId: string; qty: number }[];
  discountPoints: number;
  by: string | null;
}): Promise<{ short: RedeemShort[]; discountTaken: boolean } | null> {
  if (!args.items.length && !args.discountPoints) return { short: [], discountTaken: false };
  const { data, error } = await createAdminClient().rpc("redeem_order_points", {
    p_member: args.memberId,
    p_order: args.orderId,
    p_items: args.items.map((i) => ({ reward_id: i.rewardId, quantity: i.qty })),
    p_discount_points: args.discountPoints,
    p_by: args.by,
  });
  if (error) {
    console.error("redeem_order_points failed", error.code, error.message);
    return null;
  }
  const res = data as { short?: RedeemShort[]; discount_taken?: boolean };
  return { short: res.short ?? [], discountTaken: !!res.discount_taken };
}

// ---------- settings ----------

export interface PointsSettings {
  bonusDailyCap: number;
  earnDailyCap: number;
  goodsDailyLimit: number;
  goodsMonthlyLimit: number;
}

export const DEFAULT_SETTINGS: PointsSettings = { bonusDailyCap: 600, earnDailyCap: 2500, goodsDailyLimit: 3, goodsMonthlyLimit: 20 };

export async function pointsSettings(): Promise<PointsSettings> {
  const { data } = await createAdminClient().from("points_settings").select("*").eq("id", true).maybeSingle();
  if (!data) return DEFAULT_SETTINGS;
  return {
    bonusDailyCap: Number(data.bonus_daily_cap),
    earnDailyCap: Number(data.earn_daily_cap),
    goodsDailyLimit: Number(data.goods_daily_limit),
    goodsMonthlyLimit: Number(data.goods_monthly_limit),
  };
}

// ---------- the watch list ----------

export interface WatchRow {
  memberId: string;
  name: string;
  reasons: { rule: string; reason: string }[];
  weight: number;
  lastAt: string;
  flagged: boolean;
  points: number;
}

export async function watchList(days = 30): Promise<WatchRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("points_watch_list", { p_days: days });
  if (error) throw error;
  const rows = (data ?? []) as { member_id: string; rule: string; reason: string; weight: number; last_at: string }[];
  const ids = [...new Set(rows.map((r) => r.member_id))];
  if (!ids.length) return [];
  const [{ data: members }, { data: flags }] = await Promise.all([
    supabase.from("members").select("id, name, phone, points").in("id", ids).is("erased_at", null),
    supabase.from("member_flags").select("member_id").in("member_id", ids).is("cleared_at", null),
  ]);
  const byId = new Map((members ?? []).map((m) => [m.id as string, m]));
  const flagged = new Set((flags ?? []).map((f) => f.member_id as string));
  const out = new Map<string, WatchRow>();
  for (const r of rows) {
    const m = byId.get(r.member_id);
    if (!m) continue;
    const cur = out.get(r.member_id) ?? {
      memberId: r.member_id,
      name: (m.name as string | null)?.trim() || (m.phone ? `Phone account ··${String(m.phone).slice(-4)}` : "Member"),
      reasons: [],
      weight: 0,
      lastAt: r.last_at,
      flagged: flagged.has(r.member_id),
      points: Math.floor(Number(m.points) || 0),
    };
    cur.reasons.push({ rule: r.rule, reason: r.reason });
    cur.weight += 1;
    if (r.last_at > cur.lastAt) cur.lastAt = r.last_at;
    out.set(r.member_id, cur);
  }
  return [...out.values()].sort((a, b) => b.reasons.length - a.reasons.length || b.lastAt.localeCompare(a.lastAt));
}

// ---------- the points economy ----------

export interface EconomyMonth {
  month: string; // "2026-10"
  issued: number;
  redeemed: number;
  goodsCost: number;
}

export interface Economy {
  months: EconomyMonth[];
  outstanding: number; // points members hold
  liability: number; // what they're worth, in dollars
  topEarners: { memberId: string; name: string; points: number }[];
  topRedeemers: { memberId: string; name: string; points: number }[];
  byReward: { name: string; count: number; points: number; cost: number }[];
}

const EARN_REASONS = ["purchase", "visit", "badge", "welcome_bonus", "backfill", "adjustment"];

function monthKey(iso: string): string {
  // Central time, like the business day.
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" }).slice(0, 7);
}

export async function pointsEconomy(monthsBack = 6): Promise<Economy> {
  const supabase = createAdminClient();
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - (monthsBack - 1));
  start.setUTCHours(6, 0, 0, 0);
  const since = start.toISOString();

  // Paged: a busy month is a few thousand rows.
  const ledger: { member_id: string; delta: number; reason: string; created_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("points_ledger")
      .select("member_id, delta, reason, created_at")
      .gte("created_at", since)
      .in("reason", [...EARN_REASONS, "redeem", "refund"])
      .order("created_at")
      .range(from, from + 999);
    if (error) throw error;
    ledger.push(...((data ?? []) as typeof ledger));
    if (!data || data.length < 1000) break;
  }
  const { data: reds } = await supabase.from("reward_redemptions").select("member_id, name, points, real_cost, quantity, status, created_at").gte("created_at", since).eq("status", "used");
  const { data: holders } = await supabase.from("members").select("points").gt("points", 0).is("erased_at", null);

  const months = new Map<string, EconomyMonth>();
  const cursor = new Date(start);
  for (let i = 0; i < monthsBack; i++) {
    const k = monthKey(new Date(cursor.getTime() + 86_400_000).toISOString());
    months.set(k, { month: k, issued: 0, redeemed: 0, goodsCost: 0 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const earnedBy = new Map<string, number>();
  const spentBy = new Map<string, number>();
  for (const l of ledger) {
    const m = months.get(monthKey(l.created_at));
    const d = Number(l.delta);
    if (EARN_REASONS.includes(l.reason) && d > 0) {
      if (m) m.issued += d;
      earnedBy.set(l.member_id, (earnedBy.get(l.member_id) ?? 0) + d);
    } else if (l.reason === "redeem") {
      if (m) m.redeemed += -d;
      spentBy.set(l.member_id, (spentBy.get(l.member_id) ?? 0) - d);
    }
  }
  const byReward = new Map<string, { name: string; count: number; points: number; cost: number }>();
  for (const r of reds ?? []) {
    const m = months.get(monthKey(r.created_at as string));
    const cost = Number(r.real_cost ?? 0);
    if (m) m.goodsCost += cost;
    const cur = byReward.get(r.name as string) ?? { name: r.name as string, count: 0, points: 0, cost: 0 };
    cur.count += Number(r.quantity) || 1;
    cur.points += Number(r.points) || 0;
    cur.cost += cost;
    byReward.set(cur.name, cur);
  }
  const outstanding = Math.floor((holders ?? []).reduce((s, h) => s + Number(h.points), 0));
  const top = (map: Map<string, number>) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const earners = top(earnedBy);
  const redeemers = top(spentBy).filter(([, v]) => v > 0);
  const ids = [...new Set([...earners, ...redeemers].map(([id]) => id))];
  const { data: names } = ids.length ? await supabase.from("members").select("id, name, phone").in("id", ids) : { data: [] };
  const nameOf = new Map((names ?? []).map((n) => [n.id as string, (n.name as string | null)?.trim() || (n.phone ? `Phone account ··${String(n.phone).slice(-4)}` : "Member")]));
  return {
    months: [...months.values()].map((m) => ({ ...m, issued: Math.round(m.issued), redeemed: Math.round(m.redeemed), goodsCost: Math.round(m.goodsCost * 100) / 100 })),
    outstanding,
    liability: Math.round(outstanding * (REWARD_VALUE / POINTS_PER_REWARD) * 100) / 100,
    topEarners: earners.map(([id, v]) => ({ memberId: id, name: nameOf.get(id) ?? "Member", points: Math.round(v) })),
    topRedeemers: redeemers.map(([id, v]) => ({ memberId: id, name: nameOf.get(id) ?? "Member", points: Math.round(v) })),
    byReward: [...byReward.values()].sort((a, b) => b.points - a.points),
  };
}
