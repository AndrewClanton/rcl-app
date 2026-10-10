import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { giftCodeFrom, isGiftCode, type GiftTxKind, type IssuedGiftCard } from "@/lib/gift-cards";
import { cents, isGiftCardLine } from "@/lib/register-totals";

// The server's side of gift cards (lib/gift-cards.ts says how they work).
// Every balance change goes through a database function that locks the
// card (migration 20261009120000_gift_cards.sql).

type Db = ReturnType<typeof createAdminClient>;

// The table or function isn't there yet: the migration hasn't been applied.
export function giftCardsMissing(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42P01" || e.code === "42883" || e.code === "PGRST202" || e.code === "PGRST205" || /gift_card/.test(e.message ?? "") && /(does not exist|could not find|schema cache)/i.test(e.message ?? "");
}

export interface GiftCardLook {
  id: string;
  code: string;
  balance: number;
  initial: number;
  status: "active" | "void";
  memberId: string | null;
  memberName: string | null;
}

// One card by its code, for the register's balance check. Null: no such
// card. Throws "missing" when the migration isn't in.
export async function findGiftCard(code: string, db: Db = createAdminClient()): Promise<GiftCardLook | null> {
  if (!isGiftCode(code)) return null;
  const { data, error } = await db.from("gift_cards").select("id, code, balance, initial_amount, status, member_id").eq("code", code).maybeSingle();
  if (error) throw new Error(giftCardsMissing(error) ? "missing" : error.message);
  if (!data) return null;
  let memberName: string | null = null;
  if (data.member_id) {
    const { data: m } = await db.from("members").select("name").eq("id", data.member_id).maybeSingle();
    memberName = (m?.name as string | undefined) ?? null;
  }
  return {
    id: data.id as string,
    code: data.code as string,
    balance: Number(data.balance),
    initial: Number(data.initial_amount),
    status: data.status as "active" | "void",
    memberId: (data.member_id as string | null) ?? null,
    memberName,
  };
}

export type RedeemResult = { ok: true; balance: number; amount: number } | { ok: false; error: string; balance?: number };

// Takes `amount` off the card, all or nothing, in one locked step. A repeat
// with the same key takes nothing more.
export async function redeemGiftCard(code: string, amount: number, employeeId: string | null, key: string, db: Db = createAdminClient()): Promise<RedeemResult> {
  const { data, error } = await db.rpc("redeem_gift_card", { p_code: code, p_amount: cents(amount), p_employee_id: employeeId || null, p_key: key });
  if (error) return { ok: false, error: giftCardsMissing(error) ? "missing" : "failed" };
  const r = (data ?? {}) as { ok?: boolean; error?: string; balance?: number; amount?: number };
  if (!r.ok) return { ok: false, error: r.error ?? "failed", balance: r.balance === undefined ? undefined : Number(r.balance) };
  return { ok: true, balance: Number(r.balance), amount: Number(r.amount) };
}

export async function linkGiftCardRedemption(key: string, orderId: string, db: Db = createAdminClient()) {
  const { error } = await db.rpc("link_gift_card_redemption", { p_key: key, p_order_id: orderId });
  if (error) console.error("gift card redemption not linked to its order", key, orderId, error.message);
}

// A redemption whose sale never saved goes back on the card.
export async function undoGiftCardRedemption(key: string, employeeId: string | null, db: Db = createAdminClient()) {
  const { error } = await db.rpc("undo_gift_card_redemption", { p_key: key, p_employee_id: employeeId || null });
  if (error) console.error("gift card redemption not put back", key, error.message);
}

// The cards a saved sale sold: one per gift card on its lines (a line of 2
// is two cards). Safe to repeat: each card's key is the order, the line and
// which one, so a retry hands back the cards already made.
export async function issueOrderGiftCards(
  sale: {
    orderId: string;
    employeeId: string | null;
    lines: { menu_item_id: string | null; screening_id?: string | null; reward_id?: string | null; name: string; unit_price: number; quantity: number; gift_member_id?: string | null }[];
  },
  db: Db = createAdminClient(),
): Promise<{ cards: IssuedGiftCard[]; failed: number }> {
  const cards: IssuedGiftCard[] = [];
  let failed = 0;
  const names = new Map<string, string | null>();
  for (let i = 0; i < sale.lines.length; i++) {
    const l = sale.lines[i];
    if (!isGiftCardLine(l)) continue;
    const amount = cents(Number(l.unit_price));
    const qty = Math.max(0, Math.min(20, Math.round(Number(l.quantity) || 0)));
    if (!(amount > 0)) continue;
    let memberId: string | null = null;
    if (l.gift_member_id && /^[0-9a-f-]{36}$/i.test(l.gift_member_id)) {
      if (!names.has(l.gift_member_id)) {
        const { data } = await db.from("members").select("name").eq("id", l.gift_member_id).is("erased_at", null).maybeSingle();
        names.set(l.gift_member_id, (data?.name as string | undefined) ?? null);
      }
      if (names.get(l.gift_member_id)) memberId = l.gift_member_id;
    }
    for (let n = 0; n < qty; n++) {
      const key = `issue:${sale.orderId}:${i}:${n}`;
      let made: { code: string } | null = null;
      // A clash on the code (one in a billion) gets a new one.
      for (let attempt = 0; attempt < 5 && !made; attempt++) {
        const { data, error } = await db.rpc("issue_gift_card", {
          p_code: giftCodeFrom(randomBytes(24)),
          p_amount: amount,
          p_order_id: sale.orderId,
          p_member_id: memberId,
          p_employee_id: sale.employeeId || null,
          p_key: key,
        });
        if (error) {
          console.error("gift card not issued", sale.orderId, error.message);
          break;
        }
        const row = (Array.isArray(data) ? data[0] : data) as { code?: string } | null;
        if (row?.code) made = { code: row.code };
      }
      if (made) cards.push({ code: made.code, amount, member: memberId ? (names.get(memberId) ?? null) : null });
      else failed++;
    }
  }
  return { cards, failed };
}

// A refunded order: what gift cards paid goes back on them, and cards it
// sold are voided. Null when there were none (or gift cards aren't set up).
export async function refundOrderGiftCards(orderId: string, employeeId: string | null, db: Db = createAdminClient()): Promise<{ restored: { code: string; amount: number; balance: number }[]; voided: { code: string; left: number; spent: number }[] } | null> {
  const { data, error } = await db.rpc("refund_order_gift_cards", { p_order_id: orderId, p_employee_id: employeeId || null });
  if (error) {
    if (!giftCardsMissing(error)) console.error("gift cards on a refunded order weren't settled", orderId, error.message);
    return null;
  }
  const r = (data ?? {}) as { restored?: { code: string; amount: number; balance: number }[]; voided?: { code: string; left: number; spent: number }[] };
  const restored = (r.restored ?? []).map((x) => ({ code: x.code, amount: Number(x.amount), balance: Number(x.balance) }));
  const voided = (r.voided ?? []).map((x) => ({ code: x.code, left: Number(x.left), spent: Number(x.spent) }));
  return restored.length || voided.length ? { restored, voided } : null;
}

// ---------- reading them ----------

export interface GiftCardRow {
  id: string;
  code: string;
  initial: number;
  balance: number;
  status: "active" | "void";
  memberId: string | null;
  memberName: string | null;
  soldOrderNumber: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface GiftTxRow {
  id: string;
  kind: GiftTxKind;
  amount: number;
  balanceAfter: number;
  orderNumber: number | null;
  reason: string | null;
  by: string | null;
  at: string;
}

type CardDbRow = {
  id: string;
  code: string;
  initial_amount: number;
  balance: number;
  status: "active" | "void";
  member_id: string | null;
  created_at: string;
  updated_at: string;
  order: { order_number: number } | null;
};

async function memberNames(db: Db, ids: (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const { data } = await db.from("members").select("id, name").in("id", want);
  return new Map((data ?? []).map((m) => [m.id as string, m.name as string]));
}

function cardRow(r: CardDbRow, names: Map<string, string>): GiftCardRow {
  return {
    id: r.id,
    code: r.code,
    initial: Number(r.initial_amount),
    balance: Number(r.balance),
    status: r.status,
    memberId: r.member_id,
    memberName: r.member_id ? (names.get(r.member_id) ?? null) : null,
    soldOrderNumber: r.order?.order_number ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const CARD_COLUMNS = "id, code, initial_amount, balance, status, member_id, created_at, updated_at, order:orders!gift_cards_sold_order_id_fkey(order_number)";

// Back office: the latest cards (or those matching a code or a member's
// name). ready: false when the migration isn't in.
export async function listGiftCards(q = "", limit = 200): Promise<{ ready: boolean; cards: GiftCardRow[]; outstanding: number; count: number }> {
  const db = createAdminClient();
  let query = db.from("gift_cards").select(CARD_COLUMNS).order("created_at", { ascending: false }).limit(limit);
  const term = q.trim();
  if (term) {
    const code = term.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    const { data: people } = await db.from("members").select("id").ilike("name", `%${term.replace(/[%_,()]/g, "")}%`).limit(50);
    const ids = (people ?? []).map((p) => p.id as string);
    query = ids.length ? query.or(`code.ilike.%${code}%,member_id.in.(${ids.join(",")})`) : query.ilike("code", `%${code}%`);
  }
  const { data, error } = await query;
  if (error) {
    if (giftCardsMissing(error)) return { ready: false, cards: [], outstanding: 0, count: 0 };
    throw error;
  }
  const rows = (data ?? []) as unknown as CardDbRow[];
  const names = await memberNames(db, rows.map((r) => r.member_id));
  // What's still owed on every active card, not just the ones listed.
  const { data: all } = await db.from("gift_cards").select("balance").eq("status", "active").gt("balance", 0);
  const outstanding = cents((all ?? []).reduce((s, r) => s + Number(r.balance), 0));
  return { ready: true, cards: rows.map((r) => cardRow(r, names)), outstanding, count: (all ?? []).length };
}

export async function getGiftCard(id: string): Promise<{ card: GiftCardRow; history: GiftTxRow[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = createAdminClient();
  const { data, error } = await db.from("gift_cards").select(CARD_COLUMNS).eq("id", id).maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as CardDbRow;
  const names = await memberNames(db, [row.member_id]);
  const { data: tx } = await db
    .from("gift_card_transactions")
    .select("id, kind, amount, balance_after, reason, created_at, order:orders(order_number), employee:employees(name)")
    .eq("gift_card_id", id)
    .order("created_at", { ascending: false });
  type TxDb = { id: string; kind: GiftTxKind; amount: number; balance_after: number; reason: string | null; created_at: string; order: { order_number: number } | null; employee: { name: string } | null };
  return {
    card: cardRow(row, names),
    history: ((tx ?? []) as unknown as TxDb[]).map((t) => ({
      id: t.id,
      kind: t.kind,
      amount: Number(t.amount),
      balanceAfter: Number(t.balance_after),
      orderNumber: t.order?.order_number ?? null,
      reason: t.reason,
      by: t.employee?.name ?? null,
      at: t.created_at,
    })),
  };
}

// My Account: the member's own cards with something on them (or used
// lately). Never throws: no cards, or no migration, is an empty list.
export async function memberGiftCards(memberId: string): Promise<{ code: string; balance: number; initial: number }[]> {
  try {
    const { data, error } = await createAdminClient().from("gift_cards").select("code, balance, initial_amount").eq("member_id", memberId).eq("status", "active").order("created_at", { ascending: false }).limit(20);
    if (error) return [];
    return (data ?? []).map((r) => ({ code: r.code as string, balance: Number(r.balance), initial: Number(r.initial_amount) }));
  } catch {
    return [];
  }
}
