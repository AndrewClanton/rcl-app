import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDayWindow } from "@/lib/ops/time";

// Tabs cancelled with a manager PIN (the register's Cancel tab), for the
// Day report. A cancelled tab was never paid: it's kept on file with its
// items (status 'cancelled', migration 20261001110000_register_tabs.sql)
// so there's a record of what was rung and who called it off, but it's in
// no sales figure. Also the day's voucher sales, with the number typed on
// each voucher.

export interface CancelledTab {
  id: string;
  orderNumber: number;
  name: string | null;
  openedAt: string;
  openedBy: string | null;
  cancelledAt: string;
  cancelledBy: string | null; // the cashier on the register
  approvedBy: string | null; // whose manager PIN (null: a shared PIN)
  total: number; // what the tab came to, never charged
  items: string; // "2× IPA, Burger"
}

export interface VoucherSale {
  id: string;
  orderNumber: number;
  at: string;
  status: string; // completed | refunded
  voucher: number; // the voucher part of the payment
  code: string | null; // the number on the voucher(s), when the cashier typed it
}

type NameRow = { name: string } | null;

const itemsText = (items: { name: string; quantity: number }[]) => items.map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.name}` : i.name)).join(", ");

// Tabs cancelled during this business day (4 a.m. to 4 a.m.), oldest
// first. Null when they couldn't be read.
export async function getCancelledTabs(date: string): Promise<CancelledTab[] | null> {
  const { start, end } = businessDayWindow(date);
  const { data, error } = await createAdminClient()
    .from("orders")
    .select(
      "id, order_number, order_name, tab_name, total, created_at, cancelled_at, opener:employees!orders_employee_id_fkey(name), canceller:employees!orders_cancelled_by_fkey(name), approver:employees!orders_cancel_approved_by_fkey(name), items:order_items(name, quantity, created_at)",
    )
    .eq("status", "cancelled")
    .gte("cancelled_at", start)
    .lt("cancelled_at", end)
    .order("cancelled_at")
    .order("created_at", { referencedTable: "order_items" });
  if (error) {
    console.warn("cancelled tabs not read (migration 20261001110000_register_tabs.sql applied?):", error.message);
    return null;
  }
  type Row = {
    id: string;
    order_number: number;
    order_name: string | null;
    tab_name: string | null;
    total: number;
    created_at: string;
    cancelled_at: string;
    opener: NameRow;
    canceller: NameRow;
    approver: NameRow;
    items: { name: string; quantity: number }[];
  };
  return ((data ?? []) as unknown as Row[]).map((o) => ({
    id: o.id,
    orderNumber: Number(o.order_number),
    name: o.tab_name || o.order_name || null,
    openedAt: o.created_at,
    openedBy: o.opener?.name ?? null,
    cancelledAt: o.cancelled_at,
    cancelledBy: o.canceller?.name ?? null,
    approvedBy: o.approver?.name ?? null,
    total: Number(o.total),
    items: itemsText(o.items ?? []),
  }));
}

// Register sales paid at least partly with paper vouchers during this
// business day, oldest first. Null when they couldn't be read.
export async function getVoucherSales(date: string): Promise<VoucherSale[] | null> {
  const { start, end } = businessDayWindow(date);
  const { data, error } = await createAdminClient()
    .from("orders")
    .select("id, order_number, status, completed_at, payment_voucher_amount, payment_voucher_code")
    .in("status", ["completed", "refunded"])
    .gt("payment_voucher_amount", 0)
    .gte("completed_at", start)
    .lt("completed_at", end)
    .order("completed_at");
  if (error) {
    console.warn("voucher sales not read (migration 20261001110000_register_tabs.sql applied?):", error.message);
    return null;
  }
  return (data ?? []).map((o) => ({
    id: o.id as string,
    orderNumber: Number(o.order_number),
    at: o.completed_at as string,
    status: o.status as string,
    voucher: Number(o.payment_voucher_amount),
    code: (o.payment_voucher_code as string | null) ?? null,
  }));
}
