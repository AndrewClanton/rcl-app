"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPin } from "@/lib/pin";
import { assertStaff } from "@/lib/auth";

export interface CheckoutLine {
  menu_item_id: string | null;
  name: string;
  unit_price: number;
  quantity: number;
  modifiers: string[];
  is_alcohol: boolean;
}

export interface CheckoutTotals {
  subtotal: number;
  tier_discount: number;
  monthly_discount: number;
  redemption_discount: number;
  tax: number;
  total: number;
}

export interface CheckoutPayment {
  method: "cash" | "card" | "split";
  cash: number;
  card: number;
  stripePaymentIntentId?: string | null;
}

export interface DraftFields {
  employeeId: string;
  memberId: string | null;
  orderName: string;
  taxFree: boolean;
  monthlyMember: boolean;
  pointsRedeemed: boolean;
  lines: CheckoutLine[];
}

export interface DraftOrderSummary {
  id: string;
  order_name: string | null;
  item_count: number;
  total: number;
}

export interface DraftOrderFull {
  id: string;
  order_name: string | null;
  member_id: string | null;
  tax_free: boolean;
  monthly_member: boolean;
  points_redeemed: boolean;
  lines: (CheckoutLine & { unit: number })[];
}

function revalidate() {
  revalidatePath("/pos");
}

async function replaceOrderItems(supabase: ReturnType<typeof createAdminClient>, orderId: string, lines: CheckoutLine[]) {
  await supabase.from("order_items").delete().eq("order_id", orderId);
  if (lines.length === 0) return;
  await supabase.from("order_items").insert(
    lines.map((l) => ({
      order_id: orderId,
      menu_item_id: l.menu_item_id,
      name: l.name,
      unit_price: l.unit_price,
      quantity: l.quantity,
      modifiers: l.modifiers,
      is_alcohol: l.is_alcohol,
    }))
  );
}

export async function completeOrder(params: DraftFields & {
  totals: CheckoutTotals;
  payment: CheckoutPayment;
  ageVerified: boolean;
  tip?: number;
  draftOrderId?: string | null;
}): Promise<{ orderNumber: number }> {
  await assertStaff();
  if (params.lines.length === 0) throw new Error("Cart is empty");

  const supabase = createAdminClient();
  const tip = params.tip ?? 0;

  const orderFields = {
    source: "pos" as const,
    status: "completed" as const,
    employee_id: params.employeeId,
    member_id: params.memberId,
    order_name: params.orderName || null,
    subtotal: params.totals.subtotal,
    tier_discount: params.totals.tier_discount,
    monthly_discount: params.totals.monthly_discount,
    redemption_discount: params.totals.redemption_discount,
    tax_free: params.taxFree,
    monthly_member: params.monthlyMember,
    tax: params.totals.tax,
    tip,
    total: params.totals.total + tip,
    payment_method: params.payment.method,
    payment_cash_amount: params.payment.cash,
    payment_card_amount: params.payment.card,
    stripe_payment_intent_id: params.payment.stripePaymentIntentId ?? null,
    points_redeemed: params.pointsRedeemed,
    age_verified: params.ageVerified,
    completed_at: new Date().toISOString(),
  };

  let orderId: string;
  let orderNumber: number;

  if (params.draftOrderId) {
    const { data: existing, error: fetchErr } = await supabase.from("orders").select("order_number").eq("id", params.draftOrderId).single();
    if (fetchErr || !existing) throw new Error("Tab no longer exists");
    orderId = params.draftOrderId;
    orderNumber = Number(existing.order_number);
    const { error: updateErr } = await supabase.from("orders").update(orderFields).eq("id", orderId);
    if (updateErr) throw updateErr;
    await replaceOrderItems(supabase, orderId, params.lines);
  } else {
    const { data: newNumber, error: numberErr } = await supabase.rpc("next_order_number");
    if (numberErr) throw numberErr;
    orderNumber = Number(newNumber);
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({ order_number: orderNumber, ...orderFields })
      .select("id")
      .single();
    if (orderErr) throw orderErr;
    orderId = order.id;
    await replaceOrderItems(supabase, orderId, params.lines);
  }

  if (params.memberId) {
    const { data: member } = await supabase.from("members").select("points").eq("id", params.memberId).single();
    if (member) {
      let points = Number(member.points);
      if (params.pointsRedeemed && params.totals.redemption_discount > 0) points -= 100;
      points += params.totals.subtotal;
      await supabase.from("members").update({ points }).eq("id", params.memberId);
    }
  }

  revalidate();
  return { orderNumber };
}

// ---------- held orders & tabs (persisted drafts, status 'held' | 'tab') ----------
//
// Draft rows must carry a real, current total (not a 0 placeholder) --
// getDraftOrders reads it straight from the row rather than recomputing a
// bare item subtotal, so the held/tabs lists always show the same
// tax-and-discount-inclusive number the cashier sees in the cart. Callers
// pass the totals they already computed for the on-screen cart.

const ZERO_TOTALS: CheckoutTotals = { subtotal: 0, tier_discount: 0, monthly_discount: 0, redemption_discount: 0, tax: 0, total: 0 };

export async function saveDraftOrder(status: "held" | "tab", fields: DraftFields, totals: CheckoutTotals = ZERO_TOTALS): Promise<string> {
  await assertStaff();
  const supabase = createAdminClient();
  const { data: orderNumber, error: numberErr } = await supabase.rpc("next_order_number");
  if (numberErr) throw numberErr;

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      order_number: orderNumber,
      source: "pos",
      status,
      employee_id: fields.employeeId,
      member_id: fields.memberId,
      order_name: fields.orderName || null,
      tab_name: status === "tab" ? fields.orderName || null : null,
      tax_free: fields.taxFree,
      monthly_member: fields.monthlyMember,
      points_redeemed: fields.pointsRedeemed,
      subtotal: totals.subtotal,
      tier_discount: totals.tier_discount,
      monthly_discount: totals.monthly_discount,
      redemption_discount: totals.redemption_discount,
      tax: totals.tax,
      total: totals.total,
    })
    .select("id")
    .single();
  if (error) throw error;

  await replaceOrderItems(supabase, order.id, fields.lines);
  revalidate();
  return order.id;
}

export async function updateDraftOrder(id: string, fields: DraftFields, totals: CheckoutTotals): Promise<void> {
  await assertStaff();
  const supabase = createAdminClient();
  await supabase
    .from("orders")
    .update({
      employee_id: fields.employeeId,
      member_id: fields.memberId,
      order_name: fields.orderName || null,
      tab_name: fields.orderName || null,
      tax_free: fields.taxFree,
      monthly_member: fields.monthlyMember,
      points_redeemed: fields.pointsRedeemed,
      subtotal: totals.subtotal,
      tier_discount: totals.tier_discount,
      monthly_discount: totals.monthly_discount,
      redemption_discount: totals.redemption_discount,
      tax: totals.tax,
      total: totals.total,
    })
    .eq("id", id);
  await replaceOrderItems(supabase, id, fields.lines);
  revalidate();
}

export async function getDraftOrders(status: "held" | "tab"): Promise<DraftOrderSummary[]> {
  await assertStaff();
  const supabase = createAdminClient();
  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, order_name, total, items:order_items(quantity)")
    .eq("status", status)
    .order("created_at");
  if (error) throw error;
  return (orders ?? []).map((o) => ({
    id: o.id,
    order_name: o.order_name,
    item_count: (o.items as { quantity: number }[]).reduce((s, i) => s + i.quantity, 0),
    total: Number(o.total),
  }));
}

export async function loadDraftOrder(id: string): Promise<DraftOrderFull> {
  await assertStaff();
  const supabase = createAdminClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, order_name, member_id, tax_free, monthly_member, points_redeemed, items:order_items(menu_item_id, name, unit_price, quantity, modifiers, is_alcohol)")
    .eq("id", id)
    .single();
  if (error || !order) throw new Error("Order not found");
  const items = order.items as { menu_item_id: string | null; name: string; unit_price: number; quantity: number; modifiers: string[]; is_alcohol: boolean }[];
  return {
    id: order.id,
    order_name: order.order_name,
    member_id: order.member_id,
    tax_free: order.tax_free,
    monthly_member: order.monthly_member,
    points_redeemed: order.points_redeemed,
    lines: items.map((i) => ({
      menu_item_id: i.menu_item_id,
      name: i.name,
      unit_price: i.unit_price,
      unit: i.unit_price,
      quantity: i.quantity,
      modifiers: i.modifiers,
      is_alcohol: i.is_alcohol,
    })),
  };
}

export async function discardDraftOrder(id: string): Promise<void> {
  await assertStaff();
  const supabase = createAdminClient();
  await supabase.from("orders").delete().eq("id", id);
  revalidate();
}

export async function cancelTab(id: string, pin: string): Promise<void> {
  await assertStaff();
  const supabase = createAdminClient();
  const { data: managers } = await supabase.from("employees").select("pin_hash").in("role", ["manager", "admin"]).eq("active", true);
  const ok = (managers ?? []).some((m) => verifyPin(pin, m.pin_hash));
  if (!ok) throw new Error("Incorrect manager PIN.");
  await supabase.from("orders").delete().eq("id", id);
  revalidate();
}
