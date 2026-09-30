import "server-only";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay, businessDayWindow } from "@/lib/ops/time";

// Reports -> Register checks (managers and up): what the server flagged
// about register sales (register_sale_flags, written by
// lib/register-sale-checks.ts), and card payments the register took that
// have no sale behind them -- a card charged, then the sale never saved.
// Read only: nothing here changes an order or a payment.

// ---------- flags ----------

export interface RegisterFlag {
  id: string;
  at: string;
  day: string; // its business date, for the Day report link
  kind: string;
  label: string;
  orderNumber: number | null;
  cashier: string | null;
  amount: number | null;
  summary: string;
  paymentIntentId: string | null;
}

export type FlagsResult = { ok: true; flags: RegisterFlag[] } | { ok: false; missing: boolean; error: string };

const KIND_LABELS: Record<string, string> = {
  totals_mismatch: "Totals didn't add up",
  totals_refused: "Refused: totals",
  card_refused: "Card payment refused",
  card_unchecked: "Card not checked",
  points_short: "Points short",
  tab_closed_elsewhere: "Tab closed elsewhere",
  sale_abandoned: "Stopped trying",
  items_not_saved: "Items not saved",
};

export function flagLabel(kind: string) {
  return KIND_LABELS[kind] ?? kind.replace(/_/g, " ");
}

const CARD_REASONS: Record<string, string> = {
  card_without_payment: "A card sale came in with no card payment behind it. Nothing was charged.",
  not_a_payment_id: "The card payment id wasn't a Stripe payment.",
  payment_not_found: "Stripe had no record of the card payment.",
  not_a_register_payment: "The card payment wasn't taken on the register (an online or booth payment).",
  amount_mismatch: "The card was charged a different amount than the sale said. Check Stripe before charging again.",
  stripe_unreachable: "Stripe didn't answer, so the sale was saved without checking the card.",
};

type Details = Record<string, unknown>;

const asNumber = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const asText = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const asObject = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Details) : null);

function flagAmount(d: Details): number | null {
  const direct = asNumber(d.amount);
  if (direct !== null) return direct;
  const pay = asObject(d.payment);
  if (pay) return Math.round(((asNumber(pay.cash) ?? 0) + (asNumber(pay.card) ?? 0) + (asNumber(pay.voucher) ?? 0)) * 100) / 100;
  const sent = asObject(d.sent);
  return sent ? asNumber(sent.total) : null;
}

// One plain line about what happened, from whatever the flag carries.
function flagSummary(kind: string, d: Details): string {
  const own = asText(d.summary);
  if (own) return own;
  const problems = Array.isArray(d.problems) ? d.problems.filter((p): p is string => typeof p === "string") : [];
  if (problems.length) return problems.length > 1 ? `${problems[0]} (and ${problems.length - 1} more)` : problems[0];
  const reason = asText(d.reason);
  if (kind === "card_unchecked" && reason === "tab_card_other_tab") return `A tab's card on file paid a different order: ${asText(d.detail) ?? "check which tab"}.`;
  if (reason) return CARD_REASONS[reason] ?? (reason.startsWith("payment_") ? `Stripe says the card payment is ${reason.slice(8).replace(/_/g, " ")}, not paid.` : reason.replace(/_/g, " "));
  if (kind === "points_short") return `A points reward was used, but the member had ${Math.floor(asNumber(d.points) ?? 0)} points, so none were taken off.`;
  const text = JSON.stringify(d);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function isMissingTable(e: { code?: string; message?: string } | null) {
  return !!e && (e.code === "42P01" || e.code === "PGRST205" || /register_sale_flags/.test(e.message ?? ""));
}

async function employeeNames(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data } = await createAdminClient().from("employees").select("id, name").in("id", ids);
  return new Map((data ?? []).map((e) => [e.id as string, e.name as string]));
}

// The newest flags first.
export async function getRegisterFlags(limit = 100): Promise<FlagsResult> {
  const { data, error } = await createAdminClient()
    .from("register_sale_flags")
    .select("id, created_at, kind, order_number, employee_id, stripe_payment_intent_id, details")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { ok: false, missing: isMissingTable(error), error: error.message };
  type Row = { id: string; created_at: string; kind: string; order_number: number | null; employee_id: string | null; stripe_payment_intent_id: string | null; details: unknown };
  const rows = (data ?? []) as Row[];
  const names = await employeeNames([...new Set(rows.map((r) => r.employee_id).filter((id): id is string => !!id))]);
  return {
    ok: true,
    flags: rows.map((r) => {
      const d = asObject(r.details) ?? {};
      return {
        id: r.id,
        at: r.created_at,
        day: businessDay(new Date(r.created_at)).date,
        kind: r.kind,
        label: flagLabel(r.kind),
        orderNumber: r.order_number === null ? null : Number(r.order_number),
        cashier: r.employee_id ? (names.get(r.employee_id) ?? null) : null,
        amount: flagAmount(d),
        summary: flagSummary(r.kind, d),
        paymentIntentId: r.stripe_payment_intent_id,
      };
    }),
  };
}

// ---------- card payments with no sale ----------

export interface OrphanPayment {
  id: string; // the Stripe PaymentIntent
  at: string;
  amount: number; // charged, tip included
  tip: number; // picked on the reader
  source: "Reader" | "Card on file";
  card: string | null; // "Visa ••4242"
  refunded: number; // already given back
  voidedOrder: number | null; // the order it was on, since voided
  flags: string[]; // what the flags say about it ("Stopped trying")
  stripeUrl: string; // the payment in Stripe's dashboard (test or live)
}

export type OrphansResult = { ok: true; payments: OrphanPayment[]; checked: number; more: boolean } | { ok: false; error: string };

// A day's worth, at most (the bar runs well under this).
const MAX_PAYMENTS = 500;

function cardLabel(charge: Stripe.Charge | null): string | null {
  const d = charge?.payment_method_details;
  const c = d?.card_present ?? d?.card ?? null;
  if (!c) return null;
  const brand = c.brand ? c.brand.charAt(0).toUpperCase() + c.brand.slice(1) : "Card";
  return c.last4 ? `${brand} ••${c.last4}` : brand;
}

// Succeeded register card payments (the reader's metadata.source "pos", a
// tab's card on file "pos-tab") made during one business day, 4 a.m. to 4
// a.m. Central, that no order points to. Stripe's search runs a minute or so
// behind, so a payment from the last minute may not show yet.
export async function getCardPaymentsWithNoSale(date: string): Promise<OrphansResult> {
  const { start, end } = businessDayWindow(date);
  const from = Math.floor(new Date(start).getTime() / 1000);
  const to = Math.floor(new Date(end).getTime() / 1000);

  let intents: Stripe.PaymentIntent[];
  let more = false;
  try {
    const stripe = getStripe();
    // Stripe's search can't mix AND with OR, so one search per source.
    const search = (source: string) =>
      stripe.paymentIntents
        .search({ query: `status:'succeeded' AND metadata['source']:'${source}' AND created>=${from} AND created<${to}`, limit: 100, expand: ["data.latest_charge"] })
        .autoPagingToArray({ limit: MAX_PAYMENTS });
    const [reader, onFile] = await Promise.all([search("pos"), search("pos-tab")]);
    intents = [...reader, ...onFile];
    more = reader.length >= MAX_PAYMENTS || onFile.length >= MAX_PAYMENTS;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't reach Stripe." };
  }

  const ids = intents.map((pi) => pi.id);
  const supabase = createAdminClient();
  const orders = new Map<string, { number: number; status: string }[]>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from("orders").select("order_number, status, stripe_payment_intent_id").in("stripe_payment_intent_id", ids.slice(i, i + 100));
    if (error) return { ok: false, error: error.message };
    for (const o of data ?? []) {
      const key = o.stripe_payment_intent_id as string;
      orders.set(key, [...(orders.get(key) ?? []), { number: Number(o.order_number), status: o.status as string }]);
    }
  }

  // A voided order doesn't count: the register can put the payment on a
  // new sale after a void, so it's as good as no sale.
  const unmatched = intents.filter((pi) => !(orders.get(pi.id) ?? []).some((o) => o.status !== "voided"));

  const flagsByPayment = new Map<string, string[]>();
  if (unmatched.length) {
    // Best effort: the flags table may not be there yet.
    const { data } = await supabase.from("register_sale_flags").select("kind, stripe_payment_intent_id").in("stripe_payment_intent_id", unmatched.map((pi) => pi.id));
    for (const f of (data ?? []) as { kind: string; stripe_payment_intent_id: string }[]) {
      const list = flagsByPayment.get(f.stripe_payment_intent_id) ?? [];
      if (!list.includes(flagLabel(f.kind))) list.push(flagLabel(f.kind));
      flagsByPayment.set(f.stripe_payment_intent_id, list);
    }
  }

  const payments: OrphanPayment[] = unmatched
    .map((pi) => {
      const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
      const voided = (orders.get(pi.id) ?? []).find((o) => o.status === "voided");
      return {
        id: pi.id,
        at: new Date(pi.created * 1000).toISOString(),
        amount: (pi.amount_received || pi.amount) / 100,
        tip: (pi.amount_details?.tip?.amount ?? 0) / 100,
        source: pi.metadata?.source === "pos-tab" ? ("Card on file" as const) : ("Reader" as const),
        card: cardLabel(charge),
        refunded: (charge?.amount_refunded ?? 0) / 100,
        voidedOrder: voided ? voided.number : null,
        flags: flagsByPayment.get(pi.id) ?? [],
        stripeUrl: `https://dashboard.stripe.com/${pi.livemode ? "" : "test/"}payments/${pi.id}`,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));

  return { ok: true, payments, checked: intents.length, more };
}
