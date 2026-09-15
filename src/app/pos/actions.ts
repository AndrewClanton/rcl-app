"use server";

import { createAdminClient } from "@/lib/supabase/admin";

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
}

export async function completeOrder(params: {
  employeeId: string;
  memberId: string | null;
  orderName: string;
  taxFree: boolean;
  monthlyMember: boolean;
  pointsRedeemed: boolean;
  lines: CheckoutLine[];
  totals: CheckoutTotals;
  payment: CheckoutPayment;
  ageVerified: boolean;
}): Promise<{ orderNumber: number }> {
  if (params.lines.length === 0) throw new Error("Cart is empty");

  const supabase = createAdminClient();

  const { data: orderNumber, error: numberErr } = await supabase.rpc("next_order_number");
  if (numberErr) throw numberErr;

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({
      order_number: orderNumber,
      source: "pos",
      status: "completed",
      employee_id: params.employeeId,
      member_id: params.memberId,
      order_name: params.orderName || null,
      subtotal: params.totals.subtotal,
      tier_discount: params.totals.tier_discount,
      monthly_discount: params.totals.monthly_discount,
      redemption_discount: params.totals.redemption_discount,
      tax_free: params.taxFree,
      tax: params.totals.tax,
      tip: 0,
      total: params.totals.total,
      payment_method: params.payment.method,
      payment_cash_amount: params.payment.cash,
      payment_card_amount: params.payment.card,
      points_redeemed: params.pointsRedeemed,
      age_verified: params.ageVerified,
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (orderErr) throw orderErr;

  const itemRows = params.lines.map((l) => ({
    order_id: order.id,
    menu_item_id: l.menu_item_id,
    name: l.name,
    unit_price: l.unit_price,
    quantity: l.quantity,
    modifiers: l.modifiers,
    is_alcohol: l.is_alcohol,
  }));
  const { error: itemsErr } = await supabase.from("order_items").insert(itemRows);
  if (itemsErr) throw itemsErr;

  if (params.memberId) {
    const { data: member } = await supabase.from("members").select("points").eq("id", params.memberId).single();
    if (member) {
      let points = Number(member.points);
      if (params.pointsRedeemed && params.totals.redemption_discount > 0) points -= 100;
      points += params.totals.subtotal;
      await supabase.from("members").update({ points }).eq("id", params.memberId);
    }
  }

  return { orderNumber: Number(orderNumber) };
}
