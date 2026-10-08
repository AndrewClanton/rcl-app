import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { applyPoints } from "@/lib/points";
import { cents, pointsEarned, registerTotals } from "@/lib/register-totals";
import { coffeeDay, dailyCoffeeUse } from "@/lib/daily-perk-server";
import { getBoardEntries } from "@/lib/data/barBook";
import { sendKitchenTicket } from "@/lib/print/kitchen";
import { pictureOf, textIconShown, type TextIcon } from "@/lib/menu-pictures/shared";
import type { IconSpec } from "@/lib/bar/icons";
import type { MemberTier } from "@/lib/types";
import {
  MAX_LINES,
  MAX_QTY,
  SEAT_CATEGORY_KEYS,
  boardLabel,
  isSpotCode,
  openStateLabel,
  seatOrderingOpen,
  type CartLineInput,
  type OrderSpot,
  type SeatSettings,
  type SeatStatus,
  type SeatTotals,
  type TipChoice,
} from "@/lib/seat-ordering";

// Order from your seat, on the server (lib/seat-ordering.ts has the plain
// values). The phone sends ids; everything is priced here from the menu,
// with the register's own math (registerTotals: Insiders+ 10%, the daily
// coffee, 8.725% tax). The card is charged by Stripe on the phone, and only
// a payment Stripe says succeeded becomes an order.

const db = () => createAdminClient();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

// ---------- the switch and the spots ----------

const OFF: SeatSettings = { enabled: false, opens: "16:00", closes: "23:30" };

export async function getSeatSettings(): Promise<SeatSettings> {
  const { data, error } = await db().from("seat_ordering_settings").select("enabled, opens, closes").eq("id", 1).maybeSingle();
  if (error || !data) return OFF;
  return { enabled: !!data.enabled, opens: String(data.opens), closes: String(data.closes) };
}

export async function seatOrderingIsOpen(now = new Date()): Promise<boolean> {
  return seatOrderingOpen(await getSeatSettings(), now).open;
}

const SPOT_COLUMNS = "id, kind, name, code, dark, active, sort_order, code_rotated_at";

export async function listSpots(): Promise<OrderSpot[]> {
  const { data, error } = await db().from("order_spots").select(SPOT_COLUMNS).order("sort_order").order("name");
  if (error) throw error;
  return (data ?? []) as OrderSpot[];
}

export async function spotByCode(code: string): Promise<OrderSpot | null> {
  if (!isSpotCode(code)) return null;
  const { data } = await db().from("order_spots").select(SPOT_COLUMNS).eq("code", code).eq("active", true).maybeSingle();
  return (data as OrderSpot | null) ?? null;
}

// ---------- the phone's menu ----------

export interface SeatOption {
  id: string;
  name: string;
  delta: number;
}
export interface SeatGroup {
  id: string;
  label: string;
  type: "single" | "multi";
  mustChoose: boolean;
  options: SeatOption[];
}
export interface SeatItem {
  id: string;
  name: string;
  price: number;
  isAlcohol: boolean;
  dailyPerk: boolean;
  photo: string | null;
  textIcon: TextIcon | null;
  icon: IconSpec | null; // a drink's Bar Book icon
  // Its one-line description from the Bar Book recipe, when it has one
  // (nothing is made up for the rest).
  description: string | null;
  // The section, when another section has an item of the same name (the
  // two "Americano"s), so the cart can tell them apart.
  kicker: string | null;
  category: string;
  groups: SeatGroup[];
}
export interface SeatSection {
  key: string;
  label: string;
  items: SeatItem[];
}

type Row = Record<string, unknown>;

// Food and drinks a manager hasn't hidden and nobody has marked ran out,
// with their choices. Alcohol by its Bar Book icon. A section with nothing
// left in it is left off.
export async function getSeatMenu(): Promise<SeatSection[]> {
  const supabase = db();
  const [cats, items, groups, options, board] = await Promise.all([
    supabase.from("menu_categories").select("id, key, label, parent_id, sort_order").order("sort_order"),
    supabase.from("menu_items").select("*").eq("active", true).order("sort_order"),
    supabase.from("menu_modifier_groups").select("*").order("sort_order"),
    supabase.from("menu_modifier_options").select("id, group_id, name, price_delta, sort_order").order("sort_order"),
    getBoardEntries().catch(() => ({ items: {}, recipes: {} })),
  ]);
  for (const r of [cats, items, groups, options]) if (r.error) throw r.error;

  const optsByGroup = new Map<string, SeatOption[]>();
  for (const o of (options.data ?? []) as Row[]) {
    const list = optsByGroup.get(o.group_id as string) ?? [];
    list.push({ id: o.id as string, name: o.name as string, delta: Number(o.price_delta) });
    optsByGroup.set(o.group_id as string, list);
  }
  const groupsByItem = new Map<string, SeatGroup[]>();
  for (const g of (groups.data ?? []) as Row[]) {
    const opts = optsByGroup.get(g.id as string) ?? [];
    if (!opts.length) continue;
    const list = groupsByItem.get(g.item_id as string) ?? [];
    list.push({ id: g.id as string, label: g.label as string, type: g.type === "multi" ? "multi" : "single", mustChoose: !!g.must_choose, options: opts });
    groupsByItem.set(g.item_id as string, list);
  }

  const catRows = (cats.data ?? []) as { id: string; key: string; label: string; parent_id: string | null; sort_order: number }[];
  const catById = new Map(catRows.map((c) => [c.id, c]));
  const boardItems = (board.items ?? {}) as Record<string, { spec: IconSpec; card?: { description?: string | null } | null }>;
  const byCat = new Map<string, SeatItem[]>();
  for (const i of (items.data ?? []) as Row[]) {
    if (i.out_since || i.is_event_item) continue;
    const cat = catById.get(i.category_id as string);
    if (!cat || !SEAT_CATEGORY_KEYS.has(cat.key)) continue;
    const pic = pictureOf(i as never);
    const list = byCat.get(cat.id) ?? [];
    list.push({
      id: i.id as string,
      name: i.name as string,
      price: Number(i.price),
      isAlcohol: !!i.is_alcohol,
      dailyPerk: !!i.daily_perk,
      photo: pic.image_url,
      textIcon: textIconShown(pic),
      icon: i.is_alcohol ? (boardItems[i.id as string]?.spec ?? null) : null,
      description: boardItems[i.id as string]?.card?.description?.trim().slice(0, 160) || null,
      kicker: null,
      category: cat.key,
      groups: groupsByItem.get(i.id as string) ?? [],
    });
    byCat.set(cat.id, list);
  }

  // Top-level categories in order; one with subcategories (Alcohol) is
  // listed as its subcategories (Beer, Wine, Cocktails, Shots).
  const sections: SeatSection[] = [];
  const roots = catRows.filter((c) => !c.parent_id);
  for (const root of roots) {
    const subs = catRows.filter((c) => c.parent_id === root.id);
    for (const c of [root, ...subs]) {
      const list = byCat.get(c.id);
      if (list?.length) sections.push({ key: c.key, label: c.label, items: list });
    }
  }
  // A name in two sections: each one carries its section.
  const nameKey = (n: string) => n.trim().toLowerCase();
  const sectionsOf = new Map<string, Set<string>>();
  for (const sec of sections) for (const it of sec.items) sectionsOf.set(nameKey(it.name), (sectionsOf.get(nameKey(it.name)) ?? new Set<string>()).add(sec.key));
  for (const sec of sections) for (const it of sec.items) if ((sectionsOf.get(nameKey(it.name))?.size ?? 0) > 1) it.kicker = sec.label;
  return sections;
}

// ---------- pricing a cart ----------

export interface PricedLine {
  menu_item_id: string;
  name: string;
  unit_price: number;
  quantity: number;
  modifiers: string[];
  is_alcohol: boolean;
}

export type SeatMember = { id: string; tier: MemberTier; points: number } | null;

export type Priced =
  | { ok: true; lines: PricedLine[]; totals: SeatTotals; idCheck: boolean; dailyPerkDate: string | null }
  | { ok: false; error: string };

// The cart as the server sees it: each line from today's menu (an item
// hidden or ran out since the page loaded is refused, by name), its options
// by id, a "pick one" answered. Then the register's math for the member.
export async function priceCart(input: CartLineInput[], member: SeatMember, tipPercent: TipChoice): Promise<Priced> {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: "Your order is empty." };
  if (input.length > MAX_LINES) return { ok: false, error: "That's a big order. Order part of it at the counter." };
  const lines = input.map((l) => ({
    itemId: String(l?.itemId ?? ""),
    optionIds: Array.isArray(l?.optionIds) ? l.optionIds.map(String).slice(0, 20) : [],
    qty: Math.floor(Number(l?.qty)),
  }));
  if (lines.some((l) => !isUuid(l.itemId) || l.optionIds.some((o) => !isUuid(o)) || !(l.qty >= 1 && l.qty <= MAX_QTY))) {
    return { ok: false, error: "Something in your order didn't look right. Reload the menu and try again." };
  }
  const menu = await getSeatMenu();
  const byId = new Map(menu.flatMap((s) => s.items).map((i) => [i.id, i]));

  const priced: PricedLine[] = [];
  const totalsLines: { unit: number; qty: number; perkBase: number | null }[] = [];
  for (const l of lines) {
    const item = byId.get(l.itemId);
    if (!item) return { ok: false, error: "Something in your order just sold out or came off the menu. Reload the menu and try again." };
    const chosen = new Set(l.optionIds);
    const mods: string[] = [];
    let unit = item.price;
    for (const g of item.groups) {
      const picks = g.options.filter((o) => chosen.has(o.id));
      if (g.type === "single") {
        if (picks.length > 1) return { ok: false, error: `Pick one "${g.label}" for the ${item.name}.` };
        // Not asked: the first choice, like the register.
        const pick = picks[0] ?? (g.mustChoose ? null : g.options[0]);
        if (!pick) return { ok: false, error: `Choose "${g.label}" for the ${item.name}.` };
        mods.push(pick.name);
        unit += pick.delta;
      } else {
        for (const p of picks) {
          mods.push(p.name);
          unit += p.delta;
        }
      }
      for (const p of picks) chosen.delete(p.id);
    }
    if (chosen.size) return { ok: false, error: `A choice on the ${item.name} isn't on the menu anymore. Reload the menu and try again.` };
    unit = cents(Math.max(0, unit));
    priced.push({ menu_item_id: item.id, name: item.name, unit_price: unit, quantity: l.qty, modifiers: mods, is_alcohol: item.isAlcohol });
    totalsLines.push({ unit, qty: l.qty, perkBase: item.dailyPerk ? item.price : null });
  }

  // The Insiders+ daily coffee, when today's is still there.
  let dailyPerkDate: string | null = null;
  if (member?.tier === "Insiders+" && totalsLines.some((l) => l.perkBase)) {
    const date = coffeeDay();
    if ((await dailyCoffeeUse(member.id, date)) === null) dailyPerkDate = date;
  }
  const t = registerTotals(totalsLines, member ? { tier: member.tier, points: member.points } : null, false, false, false, !!dailyPerkDate);
  if (!t.dailyPerkDiscount) dailyPerkDate = null;
  const beforeTax = cents(t.subtotal - t.discount);
  const tip = cents((beforeTax * tipPercent) / 100);
  const totals: SeatTotals = {
    subtotal: t.subtotal,
    dailyPerk: t.dailyPerkDiscount,
    memberDiscount: t.tierDiscount,
    tax: t.tax,
    tip,
    total: cents(t.total + tip),
    points: member ? pointsEarned({ subtotal: t.subtotal, tier_discount: t.tierDiscount, monthly_discount: 0, redemption_discount: 0, daily_perk_discount: t.dailyPerkDiscount }) : 0,
  };
  return { ok: true, lines: priced, totals, idCheck: priced.some((l) => l.is_alcohol), dailyPerkDate };
}

export async function seatMember(memberId: string | null): Promise<SeatMember> {
  if (!memberId) return null;
  const { data } = await db().from("members").select("id, tier, points, erased_at").eq("id", memberId).maybeSingle();
  if (!data || data.erased_at) return null;
  return { id: data.id as string, tier: data.tier as MemberTier, points: Number(data.points) };
}

// ---------- paying ----------

export type StartResult = { ok: true; checkoutId: string; clientSecret: string; totals: SeatTotals } | { ok: false; error: string; paused?: boolean };

const clean = (v: unknown, max: number) => {
  const s = String(v ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return s || null;
};

// A phone pressing Pay: the cart priced, kept as a checkout, and a Stripe
// payment for exactly that. Nothing reaches the staff until it's paid.
export async function startSeatCheckout(args: { code: string; lines: CartLineInput[]; tip: TipChoice; name?: string | null; note?: string | null; memberId: string | null }): Promise<StartResult> {
  const spot = await spotByCode(args.code);
  if (!spot) return { ok: false, error: "This QR code isn't working anymore. Order at the counter, and let us know." };
  if (!(await seatOrderingIsOpen())) return { ok: false, paused: true, error: "Ordering from your seat is paused. Please order at the counter." };
  const member = await seatMember(args.memberId);
  const priced = await priceCart(args.lines, member, args.tip);
  if (!priced.ok) return priced;
  const amount = Math.round(priced.totals.total * 100);
  if (amount < 50) return { ok: false, error: "Orders under $0.50 can't be paid by phone. Add something, or order at the counter." };

  const supabase = db();
  const { data: row, error } = await supabase
    .from("seat_checkouts")
    .insert({
      spot_id: spot.id,
      spot_name: spot.name,
      member_id: member?.id ?? null,
      guest_name: clean(args.name, 40),
      note: clean(args.note, 200),
      lines: priced.lines,
      totals: { ...priced.totals, idCheck: priced.idCheck, dailyPerkDate: priced.dailyPerkDate },
    })
    .select("id")
    .single();
  if (error || !row) return { ok: false, error: "Couldn't start the payment. Try again." };

  try {
    const pi = await getStripe().paymentIntents.create(
      {
        amount,
        currency: "usd",
        // Card only, so a phone order is paid before it's made. Apple Pay and
        // Google Pay are card wallets and still show; bank debits (ACH) take
        // days to clear, so they're left out.
        payment_method_types: ["card"],
        description: `RCL seat order · ${spot.name}`,
        metadata: { kind: "seat_order", seat_checkout_id: row.id, spot: spot.name },
      },
      { idempotencyKey: `seat-checkout-${row.id}` },
    );
    // The checkout must know its payment before the phone can pay it (the
    // sweep below finds a paid one by it). If that can't be saved, the
    // payment is called off and nothing is charged.
    const { error: linkErr } = await supabase.from("seat_checkouts").update({ stripe_payment_intent_id: pi.id }).eq("id", row.id);
    if (linkErr || !pi.client_secret) {
      await getStripe()
        .paymentIntents.cancel(pi.id)
        .catch(() => {});
      throw linkErr ?? new Error("no client secret");
    }
    return { ok: true, checkoutId: row.id as string, clientSecret: pi.client_secret, totals: priced.totals };
  } catch (e) {
    console.error("seat checkout: Stripe payment not made", row.id, e);
    await supabase.from("seat_checkouts").delete().eq("id", row.id);
    return { ok: false, error: "Couldn't reach the card processor. Try again in a moment." };
  }
}

// ---------- paid, but the phone never came back ----------

const OLD_CHECKOUT_MS = 3 * 86_400_000;

export interface SweepResult {
  finished: number; // paid checkouts turned into their orders
  removed: number; // old unpaid ones taken away (their payments called off)
}

// A guest who pays and then locks the phone (or closes the tab) never runs
// the phone's finish, and the webhook may not come. This finds checkouts
// still pending whose Stripe payment succeeded and finishes each through
// finishSeatCheckout (safe to run twice: one order per payment).
//   recentMs: pending checkouts made in this window (and over a minute ago,
//     so a phone that's paying right now finishes it itself) are asked of
//     Stripe.
//   cleanup: also tidies pending checkouts older than 3 days. One that was
//     paid is finished, never removed; one still processing is left; an
//     unpaid one has its payment called off first, then is removed.
// Never throws; each checkout is on its own.
export async function sweepSeatCheckouts(opts: { recentMs: number; cleanup?: boolean; max?: number }): Promise<SweepResult> {
  const supabase = db();
  const max = Math.max(1, Math.min(opts.max ?? 10, 50));
  const result: SweepResult = { finished: 0, removed: 0 };
  const now = Date.now();

  const { data: recent, error } = await supabase
    .from("seat_checkouts")
    .select("id, stripe_payment_intent_id")
    .eq("status", "pending")
    .not("stripe_payment_intent_id", "is", null)
    .gte("created_at", new Date(now - opts.recentMs).toISOString())
    .lt("created_at", new Date(now - 60_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(max);
  if (error) console.error("seat sweep: checkouts not read", error.message);
  for (const c of recent ?? []) {
    try {
      const pi = await getStripe().paymentIntents.retrieve(c.stripe_payment_intent_id as string);
      if (pi.status !== "succeeded") continue;
      const r = await finishSeatCheckout(c.id as string);
      if (r.ok) result.finished++;
      else console.error("seat sweep: paid checkout not finished", c.id, r.error);
    } catch (e) {
      console.error("seat sweep: checkout not checked", c.id, e);
    }
  }

  if (!opts.cleanup) return result;
  const { data: old, error: oldErr } = await supabase
    .from("seat_checkouts")
    .select("id, stripe_payment_intent_id")
    .eq("status", "pending")
    .lt("created_at", new Date(now - OLD_CHECKOUT_MS).toISOString())
    .order("created_at")
    .limit(max);
  if (oldErr) console.error("seat sweep: old checkouts not read", oldErr.message);
  for (const c of old ?? []) {
    try {
      const piId = c.stripe_payment_intent_id as string | null;
      if (piId) {
        const pi = await getStripe().paymentIntents.retrieve(piId);
        if (pi.status === "succeeded") {
          const r = await finishSeatCheckout(c.id as string);
          if (r.ok) result.finished++;
          else console.error("seat sweep: old paid checkout not finished", c.id, r.error);
          continue;
        }
        // Still going through, or anything we don't know: leave it be.
        if (pi.status === "processing") continue;
        if (pi.status !== "canceled") {
          const canceled = await getStripe().paymentIntents.cancel(piId);
          if (canceled.status !== "canceled") continue;
        }
      }
      // Unpaid (no payment, or it's called off): only then removed, and
      // only while it's still pending.
      const { error: delErr } = await supabase.from("seat_checkouts").delete().eq("id", c.id).eq("status", "pending");
      if (!delErr) result.removed++;
    } catch (e) {
      console.error("seat sweep: old checkout not tidied", c.id, e);
    }
  }
  return result;
}

type CheckoutRow = {
  id: string;
  spot_id: string;
  spot_name: string;
  stripe_payment_intent_id: string | null;
  member_id: string | null;
  guest_name: string | null;
  note: string | null;
  lines: PricedLine[];
  totals: SeatTotals & { idCheck?: boolean; dailyPerkDate?: string | null };
  status: "pending" | "paid";
  order_id: string | null;
};

export type FinishResult = { ok: true; orderNumber: number; orderId: string } | { ok: false; error: string; pending?: boolean };

const orderNumberOf = async (orderId: string) => {
  const { data } = await db().from("orders").select("order_number").eq("id", orderId).maybeSingle();
  return data ? Number(data.order_number) : 0;
};

// A paid checkout becomes its order: called by the phone once Stripe says
// paid, and by the Stripe webhook in case the phone never gets back. Safe to
// run twice at once: the database keeps one order per payment.
export async function finishSeatCheckout(checkoutId: string): Promise<FinishResult> {
  if (!isUuid(checkoutId)) return { ok: false, error: "That order wasn't found." };
  const supabase = db();
  const { data, error } = await supabase.from("seat_checkouts").select("*").eq("id", checkoutId).maybeSingle();
  if (error || !data) return { ok: false, error: "That order wasn't found." };
  const c = data as CheckoutRow;
  if (c.status === "paid" && c.order_id) return { ok: true, orderId: c.order_id, orderNumber: await orderNumberOf(c.order_id) };
  if (!c.stripe_payment_intent_id) return { ok: false, error: "That order was never paid." };

  const pi = await getStripe().paymentIntents.retrieve(c.stripe_payment_intent_id);
  const expected = Math.round(Number(c.totals.total) * 100);
  if (pi.metadata?.seat_checkout_id !== c.id || pi.amount !== expected || pi.currency !== "usd") {
    console.error("seat checkout: payment doesn't match", c.id, pi.id);
    return { ok: false, error: "The payment doesn't match this order. Show this screen at the counter." };
  }
  if (pi.status !== "succeeded") return { ok: false, pending: pi.status === "processing", error: pi.status === "processing" ? "Your payment is still going through." : "The payment didn't go through." };

  const link = async (orderId: string) => {
    await supabase.from("seat_checkouts").update({ status: "paid", order_id: orderId, paid_at: new Date().toISOString() }).eq("id", c.id);
    return { ok: true as const, orderId, orderNumber: await orderNumberOf(orderId) };
  };
  const existing = async () => {
    const { data: o } = await supabase.from("orders").select("id").eq("stripe_payment_intent_id", pi.id).neq("status", "voided").limit(1);
    return (o?.[0]?.id as string | undefined) ?? null;
  };
  const already = await existing();
  if (already) return link(already);

  const t = c.totals;
  const lines = c.lines;
  const memberId = c.member_id;
  // The daily coffee counts as today's only if it's still unused (another
  // order may have used it since the cart was priced). They've paid either way.
  let perkDate: string | null = null;
  if (memberId && Number(t.dailyPerk) > 0 && t.dailyPerkDate) {
    perkDate = (await dailyCoffeeUse(memberId, t.dailyPerkDate)) === null ? t.dailyPerkDate : null;
  }
  const { data: num, error: numErr } = await supabase.rpc("next_order_number");
  if (numErr) throw numErr;
  const orderNumber = Number(num);
  const fields = {
    order_number: orderNumber,
    source: "mobile",
    status: "completed",
    employee_id: null,
    member_id: memberId,
    order_name: c.guest_name,
    subtotal: t.subtotal,
    tier_discount: t.memberDiscount,
    monthly_discount: 0,
    redemption_discount: 0,
    tax_free: false,
    monthly_member: false,
    tax: t.tax,
    tip: t.tip,
    total: t.total,
    payment_method: "card",
    payment_cash_amount: 0,
    payment_voucher_amount: 0,
    payment_card_amount: t.total,
    stripe_payment_intent_id: pi.id,
    points_redeemed: false,
    age_verified: false,
    completed_at: new Date().toISOString(),
    spot_id: c.spot_id,
    spot_name: c.spot_name,
    seat_note: c.note,
    id_check: !!t.idCheck,
    seat_status: "new",
    ...(Number(t.dailyPerk) > 0 ? { daily_perk_discount: t.dailyPerk, daily_perk_date: perkDate } : {}),
  };
  const insert = (f: typeof fields) => supabase.from("orders").insert(f).select("id").single();
  let { data: order, error: orderErr } = await insert(fields);
  if (orderErr?.code === "23505" && (orderErr.message ?? "").includes("orders_daily_perk_once")) {
    ({ data: order, error: orderErr } = await insert({ ...fields, daily_perk_date: null }));
  }
  if (orderErr || !order) {
    // Lost a race with the other caller (one order per payment): use theirs.
    const theirs = orderErr?.code === "23505" ? await existing() : null;
    if (theirs) return link(theirs);
    console.error("seat checkout: order not saved", c.id, orderErr);
    throw orderErr ?? new Error("order not saved");
  }
  const orderId = order.id as string;

  const { error: itemsErr } = await supabase.from("order_items").insert(
    lines.map((l) => ({
      order_id: orderId,
      menu_item_id: l.menu_item_id,
      name: l.name,
      unit_price: l.unit_price,
      quantity: l.quantity,
      modifiers: l.modifiers,
      is_alcohol: l.is_alcohol,
      is_event: false,
    })),
  );
  if (itemsErr) console.error("seat checkout: items not saved", orderId, itemsErr);

  if (memberId) {
    const earned = pointsEarned({ subtotal: t.subtotal, tier_discount: t.memberDiscount, monthly_discount: 0, redemption_discount: 0, daily_perk_discount: t.dailyPerk });
    if (earned > 0) await applyPoints({ memberId, delta: earned, reason: "purchase", orderId, note: `Order #${orderNumber} (seat order)` });
  }
  const result = await link(orderId);

  // The kitchen printer's ticket, headed with the spot (plain ASCII: the
  // printer drops anything else).
  const head = [boardLabel(c.spot_name).replace(/·/g, "-"), c.guest_name, t.idCheck ? "ID CHECK" : null].filter(Boolean).join(" - ");
  await sendKitchenTicket({ orderId, orderNumber, name: head, tab: false, station: null, lines }, "now");
  return result;
}

// ---------- after it's paid ----------

export interface CheckoutStatus {
  paid: boolean;
  orderNumber: number | null;
  status: SeatStatus | null;
  spotName: string;
  total: number;
  refunded: boolean;
}

// The guest's status page.
export async function seatCheckoutStatus(checkoutId: string): Promise<CheckoutStatus | null> {
  if (!isUuid(checkoutId)) return null;
  const { data } = await db().from("seat_checkouts").select("status, order_id, spot_name, totals").eq("id", checkoutId).maybeSingle();
  if (!data) return null;
  const total = Number((data.totals as SeatTotals).total);
  if (!data.order_id) return { paid: false, orderNumber: null, status: null, spotName: data.spot_name as string, total, refunded: false };
  const { data: o } = await db().from("orders").select("order_number, seat_status, status").eq("id", data.order_id).maybeSingle();
  return {
    paid: true,
    orderNumber: o ? Number(o.order_number) : null,
    status: (o?.seat_status as SeatStatus | null) ?? "new",
    spotName: data.spot_name as string,
    total,
    refunded: o?.status === "refunded",
  };
}

// Making, then Delivered (or back a step if tapped by mistake).
export async function setSeatStatus(orderId: string, status: SeatStatus): Promise<boolean> {
  if (!isUuid(orderId)) return false;
  const now = new Date().toISOString();
  const patch =
    status === "making"
      ? { seat_status: status, seat_making_at: now, seat_delivered_at: null }
      : status === "delivered"
        ? { seat_status: status, seat_delivered_at: now }
        : { seat_status: status, seat_making_at: null, seat_delivered_at: null };
  const { data, error } = await db().from("orders").update(patch).eq("id", orderId).eq("source", "mobile").not("seat_status", "is", null).select("id");
  return !error && !!data?.length;
}

export interface OpenSeatOrder {
  orderId: string;
  orderNumber: number;
  spotName: string;
  guestName: string | null;
  note: string | null;
  idCheck: boolean;
  status: SeatStatus;
  createdAt: string;
  total: number;
  items: { name: string; quantity: number; modifiers: string[] }[];
}

// What the register's Order up shows (pos/SeatOrders.tsx, through
// api/pos/seat-orders): the switch, whether it's open now, and the list.
// Throws when the list can't be read, so the register can say so instead of
// "Nothing waiting".
export interface RegisterSeatOrders {
  enabled: boolean;
  open: boolean;
  label: string;
  orders: OpenSeatOrder[];
}

export async function registerSeatOrders(): Promise<RegisterSeatOrders> {
  const [settings, orders] = await Promise.all([getSeatSettings(), openSeatOrders()]);
  const state = seatOrderingOpen(settings);
  return { enabled: settings.enabled, open: state.open, label: openStateLabel(settings, state), orders };
}

// Seat orders not delivered yet, oldest first (the register's list), plus
// those delivered in the last 20 minutes. The waiting ones are read newest
// first with a big cap, so a pile of orders nobody tapped Delivered on can
// never push a new paid one off the list; then put oldest first.
export async function openSeatOrders(): Promise<OpenSeatOrder[]> {
  const since = new Date(Date.now() - 12 * 3_600_000).toISOString();
  const recent = new Date(Date.now() - 20 * 60_000).toISOString();
  const columns = "id, order_number, spot_name, order_name, seat_note, id_check, seat_status, created_at, total, seat_delivered_at, items:order_items(name, quantity, modifiers)";
  const base = () => db().from("orders").select(columns).eq("source", "mobile").eq("status", "completed").gte("created_at", since);
  const [waiting, delivered] = await Promise.all([
    base().in("seat_status", ["new", "making"]).order("created_at", { ascending: false }).limit(200),
    base().eq("seat_status", "delivered").gte("seat_delivered_at", recent).order("created_at", { ascending: false }).limit(30),
  ]);
  if (waiting.error) throw waiting.error;
  if (delivered.error) throw delivered.error;
  const data = [...(waiting.data ?? []), ...(delivered.data ?? [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return data.map((o) => ({
    orderId: o.id as string,
    orderNumber: Number(o.order_number),
    spotName: (o.spot_name as string | null) ?? "Seat",
    guestName: (o.order_name as string | null) ?? null,
    note: (o.seat_note as string | null) ?? null,
    idCheck: !!o.id_check,
    status: ((o.seat_status as SeatStatus | null) ?? "new") as SeatStatus,
    createdAt: o.created_at as string,
    total: Number(o.total),
    items: ((o.items ?? []) as { name: string; quantity: number; modifiers: string[] }[]).map((i) => ({ name: i.name, quantity: i.quantity, modifiers: i.modifiers ?? [] })),
  }));
}
