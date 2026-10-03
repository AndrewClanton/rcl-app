import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay } from "@/lib/ops/time";
import { cents, type OwnerPricing } from "@/lib/register-totals";
import { fetchAll } from "./reports";

// Back office -> Owner tab: what each owner had at the owner rate (the
// register's "Owner rate": lib/register-totals.ts), month by month, and
// what they've paid against each month's statement. A month is a business
// month (4 a.m. Central on the 1st to 4 a.m. on the next 1st), like Reports.
//
// A month's statement is its owner-tab orders (ones taken off the tab left
// out), tax included. Payments against it add up, so it can be paid in parts.

export const OWNER_PAYMENT_METHODS = ["card", "cash", "check", "transfer"] as const;
export type OwnerPaymentMethod = (typeof OWNER_PAYMENT_METHODS)[number];

export interface OwnerTabLine {
  name: string;
  qty: number;
  mods: string[];
  menuUnit: number; // the menu price it replaced (a line saved without one: its own price)
  ownerUnit: number; // what the owner pays, each
  how: OwnerPricing;
}

export interface OwnerTabOrder {
  id: string;
  orderNumber: number;
  at: string;
  date: string; // business date
  refunded: boolean; // taken off the tab
  // Taken off the tab: by which other owner, and why.
  removedBy: string | null;
  removedReason: string | null;
  cashier: string | null;
  lines: OwnerTabLine[];
  subtotal: number; // at the owner rate, before tax
  menuValue: number;
  tax: number;
  total: number;
}

export interface OwnerTabPayment {
  id: string;
  month: string;
  amount: number;
  tax: number; // the sales tax inside it
  method: string;
  paidOn: string;
  note: string | null;
  recordedBy: string | null;
  at: string;
}

export type MonthStatus = "running" | "settled" | "part" | "unpaid" | "credit";

export interface OwnerMonth {
  month: string; // "2026-10"
  label: string; // "October 2026"
  orders: number;
  menuValue: number;
  sales: number; // at the owner rate, before tax
  tax: number;
  owed: number; // the statement total
  paid: number;
  balance: number; // owed less paid (negative: paid more than owed)
  status: MonthStatus;
}

export interface OwnerTabPerson {
  id: string;
  name: string;
  firstName: string;
  ticked: boolean; // gets the owner rate now
  active: boolean;
  months: OwnerMonth[]; // newest first; this month first even when there's nothing on it yet
  payments: OwnerTabPayment[]; // newest first
}

export interface OwnerTabOverview {
  ready: boolean; // false until 20261003060000_owner_tab.sql is applied
  thisMonth: string;
  people: OwnerTabPerson[];
  // This month's orders, each owner's, oldest first.
  current: Record<string, OwnerTabOrder[]>;
  // Everyone who can be ticked: active staff (not a TV login).
  candidates: { id: string; name: string; role: string; ticked: boolean }[];
  // Every change to who gets the owner rate, newest first.
  rateChanges: OwnerRateChange[];
}

export interface OwnerRateChange {
  id: string;
  at: string;
  person: string;
  on: boolean;
  by: string | null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
export const businessMonth = (iso: string) => businessDay(new Date(iso)).date.slice(0, 7);
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

type EmployeeRow = { id: string; name: string; role: string; active: boolean; owner_rate?: boolean | null };
type OrderRow = {
  id: string;
  order_number: number;
  status: string;
  completed_at: string;
  subtotal: number;
  tax: number;
  total: number;
  owner_menu_value: number | null;
  owner_tab_employee_id: string;
  owner_tab_removed_by: string | null;
  owner_tab_removed_reason: string | null;
  employee: { name: string } | null;
};
type ItemRow = {
  order_id: string;
  name: string;
  quantity: number;
  unit_price: number;
  modifiers: string[] | null;
  menu_unit_price: number | null;
  owner_pricing: OwnerPricing | null;
};
type PaymentRow = {
  id: string;
  owner_id: string;
  month: string;
  amount: number;
  tax_amount?: number | null;
  method: string;
  paid_on: string;
  note: string | null;
  recorded_by: string | null;
  created_at: string;
};

// The status of a month's statement. This month is still running.
export function monthStatus(month: string, thisMonth: string, owed: number, paid: number): MonthStatus {
  if (month >= thisMonth) return "running";
  const balance = cents(owed - paid);
  if (balance < -0.005) return "credit";
  if (balance <= 0.005) return "settled";
  return paid > 0.005 ? "part" : "unpaid";
}

// Every owner-tab order (refunded ones too, shown struck out), oldest first.
async function ownerOrders(ownerId?: string): Promise<OrderRow[]> {
  const db = createAdminClient();
  return fetchAll<OrderRow>((from, to) => {
    let q = db
      .from("orders")
      .select(
        "id, order_number, status, completed_at, subtotal, tax, total, owner_menu_value, owner_tab_employee_id, owner_tab_removed_by, owner_tab_removed_reason, employee:employees!orders_employee_id_fkey(name)",
      )
      .eq("payment_method", "owner_tab")
      .in("status", ["completed", "refunded"]);
    if (ownerId) q = q.eq("owner_tab_employee_id", ownerId);
    return q.order("completed_at").order("id").range(from, to);
  });
}

async function linesFor(orderIds: string[]): Promise<Map<string, OwnerTabLine[]>> {
  const db = createAdminClient();
  const out = new Map<string, OwnerTabLine[]>();
  for (let i = 0; i < orderIds.length; i += 100) {
    const chunk = orderIds.slice(i, i + 100);
    const { data, error } = await db.from("order_items").select("order_id, name, quantity, unit_price, modifiers, menu_unit_price, owner_pricing").in("order_id", chunk).order("created_at");
    if (error) throw error;
    for (const r of (data ?? []) as ItemRow[]) {
      const list = out.get(r.order_id) ?? [];
      list.push({
        name: r.name,
        qty: r.quantity,
        mods: r.modifiers ?? [],
        menuUnit: Number(r.menu_unit_price ?? r.unit_price),
        ownerUnit: Number(r.unit_price),
        how: r.owner_pricing ?? "menu",
      });
      out.set(r.order_id, list);
    }
  }
  return out;
}

function toOrder(o: OrderRow, lines: OwnerTabLine[], names: Map<string, string>): OwnerTabOrder {
  return {
    id: o.id,
    orderNumber: Number(o.order_number),
    at: o.completed_at,
    date: businessDay(new Date(o.completed_at)).date,
    refunded: o.status !== "completed",
    removedBy: o.owner_tab_removed_by ? (names.get(o.owner_tab_removed_by) ?? null) : null,
    removedReason: o.owner_tab_removed_reason ?? null,
    cashier: o.employee?.name ?? null,
    lines,
    subtotal: Number(o.subtotal),
    menuValue: Number(o.owner_menu_value ?? o.subtotal),
    tax: Number(o.tax),
    total: Number(o.total),
  };
}

function toPayment(p: PaymentRow, names: Map<string, string>): OwnerTabPayment {
  return {
    id: p.id,
    month: p.month,
    amount: Number(p.amount),
    tax: Number(p.tax_amount ?? 0),
    method: p.method,
    paidOn: p.paid_on,
    note: p.note,
    recordedBy: p.recorded_by ? (names.get(p.recorded_by) ?? null) : null,
    at: p.created_at,
  };
}

// A person's months from their orders and payments, newest first.
function monthsFor(orders: OrderRow[], payments: PaymentRow[], thisMonth: string): OwnerMonth[] {
  const by = new Map<string, { orders: number; menuValue: number; sales: number; tax: number; owed: number; paid: number }>();
  const get = (m: string) => {
    let v = by.get(m);
    if (!v) by.set(m, (v = { orders: 0, menuValue: 0, sales: 0, tax: 0, owed: 0, paid: 0 }));
    return v;
  };
  get(thisMonth);
  for (const o of orders) {
    if (o.status !== "completed") continue;
    const v = get(businessMonth(o.completed_at));
    v.orders++;
    v.menuValue += Number(o.owner_menu_value ?? o.subtotal);
    v.sales += Number(o.subtotal);
    v.tax += Number(o.tax);
    v.owed += Number(o.total);
  }
  for (const p of payments) get(p.month).paid += Number(p.amount);
  return [...by.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, v]) => {
      const owed = cents(v.owed);
      const paid = cents(v.paid);
      return {
        month,
        label: monthLabel(month),
        orders: v.orders,
        menuValue: cents(v.menuValue),
        sales: cents(v.sales),
        tax: cents(v.tax),
        owed,
        paid,
        balance: cents(owed - paid),
        status: monthStatus(month, thisMonth, owed, paid),
      };
    });
}

export async function getOwnerTabOverview(now = new Date()): Promise<OwnerTabOverview> {
  const db = createAdminClient();
  const thisMonth = businessDay(now).date.slice(0, 7);
  const emptyOverview: OwnerTabOverview = { ready: false, thisMonth, people: [], current: {}, candidates: [], rateChanges: [] };
  const { data: staffRows, error: staffErr } = await db.from("employees").select("id, name, role, active, owner_rate").order("name");
  if (staffErr) return emptyOverview;
  const staff = (staffRows ?? []) as EmployeeRow[];
  let orders: OrderRow[];
  let payments: PaymentRow[];
  try {
    const [o, p] = await Promise.all([
      ownerOrders(),
      fetchAll<PaymentRow>((from, to) => db.from("owner_tab_payments").select("*").order("created_at", { ascending: false }).order("id").range(from, to)),
    ]);
    orders = o;
    payments = p;
  } catch {
    return { ...emptyOverview, candidates: [] };
  }
  const names = new Map(staff.map((e) => [e.id, firstName(e.name)]));
  const ids = new Set<string>([...staff.filter((e) => e.owner_rate && e.active).map((e) => e.id), ...orders.map((o) => o.owner_tab_employee_id), ...payments.map((p) => p.owner_id)]);
  const people: OwnerTabPerson[] = staff
    .filter((e) => ids.has(e.id))
    .map((e) => ({
      id: e.id,
      name: e.name,
      firstName: firstName(e.name),
      ticked: !!e.owner_rate && e.active,
      active: e.active,
      months: monthsFor(
        orders.filter((o) => o.owner_tab_employee_id === e.id),
        payments.filter((p) => p.owner_id === e.id),
        thisMonth,
      ),
      payments: payments.filter((p) => p.owner_id === e.id).map((p) => toPayment(p, names)),
    }));

  const currentOrders = orders.filter((o) => businessMonth(o.completed_at) === thisMonth);
  const lines = await linesFor(currentOrders.map((o) => o.id)).catch(() => new Map<string, OwnerTabLine[]>());
  const current: Record<string, OwnerTabOrder[]> = {};
  for (const o of currentOrders) (current[o.owner_tab_employee_id] ??= []).push(toOrder(o, lines.get(o.id) ?? [], names));

  const { data: changeRows } = await db.from("owner_rate_changes").select("*").order("created_at", { ascending: false }).limit(50);
  const rateChanges = ((changeRows ?? []) as { id: string; employee_id: string; turned_on: boolean; changed_by: string | null; created_at: string }[]).map((c) => ({
    id: c.id,
    at: c.created_at,
    person: names.get(c.employee_id) ?? "Someone",
    on: !!c.turned_on,
    by: c.changed_by ? (names.get(c.changed_by) ?? null) : null,
  }));

  return {
    ready: true,
    thisMonth,
    people,
    current,
    candidates: staff.filter((e) => e.active && e.role !== "display").map((e) => ({ id: e.id, name: e.name, role: e.role, ticked: !!e.owner_rate })),
    rateChanges,
  };
}

export interface OwnerStatement {
  person: { id: string; name: string; firstName: string };
  month: OwnerMonth;
  orders: OwnerTabOrder[];
  payments: OwnerTabPayment[];
}

// One owner's statement for one month: every order (refunded ones shown,
// not counted) with its lines, and the payments against it. Null: no such
// person, or the owner tab isn't set up yet.
export async function getOwnerStatement(ownerId: string, month: string, now = new Date()): Promise<OwnerStatement | null> {
  const db = createAdminClient();
  const thisMonth = businessDay(now).date.slice(0, 7);
  const { data: person, error } = await db.from("employees").select("id, name").eq("id", ownerId).maybeSingle();
  if (error || !person) return null;
  let orders: OrderRow[];
  let payments: PaymentRow[];
  try {
    const [o, p] = await Promise.all([
      ownerOrders(ownerId),
      fetchAll<PaymentRow>((from, to) => db.from("owner_tab_payments").select("*").eq("owner_id", ownerId).eq("month", month).order("created_at").order("id").range(from, to)),
    ]);
    orders = o.filter((x) => businessMonth(x.completed_at) === month);
    payments = p;
  } catch {
    return null;
  }
  const lines = await linesFor(orders.map((o) => o.id));
  const recorders = [...new Set([...payments.map((p) => p.recorded_by), ...orders.map((o) => o.owner_tab_removed_by)].filter((x): x is string => !!x))];
  const { data: people } = recorders.length ? await db.from("employees").select("id, name").in("id", recorders) : { data: [] };
  const names = new Map((people ?? []).map((e) => [e.id as string, firstName(e.name as string)]));
  const month1 = monthsFor(orders, payments, thisMonth).find((m) => m.month === month) ?? {
    month,
    label: monthLabel(month),
    orders: 0,
    menuValue: 0,
    sales: 0,
    tax: 0,
    owed: 0,
    paid: 0,
    balance: 0,
    status: monthStatus(month, thisMonth, 0, 0),
  };
  return {
    person: { id: person.id as string, name: person.name as string, firstName: firstName(person.name as string) },
    month: month1,
    orders: orders.map((o) => toOrder(o, lines.get(o.id) ?? [], names)),
    payments: payments.map((p) => toPayment(p, names)),
  };
}

// The Today page's line for owners: this month so far, all owners together.
export async function ownerTabThisMonth(now = new Date()): Promise<{ owed: number; menuValue: number; orders: number } | null> {
  const db = createAdminClient();
  const thisMonth = businessDay(now).date.slice(0, 7);
  try {
    // From a few days before the 1st (the business month starts at 4 a.m.
    // on the 1st, Central), then cut to the month exactly.
    const since = new Date(`${thisMonth}-01T00:00:00Z`);
    since.setUTCDate(since.getUTCDate() - 2);
    const rows = await fetchAll<{ completed_at: string; total: number; subtotal: number; owner_menu_value: number | null }>((from, to) =>
      db
        .from("orders")
        .select("completed_at, total, subtotal, owner_menu_value")
        .eq("payment_method", "owner_tab")
        .eq("status", "completed")
        .gte("completed_at", since.toISOString())
        .order("id")
        .range(from, to),
    );
    const mine = rows.filter((o) => businessMonth(o.completed_at) === thisMonth);
    return {
      owed: cents(mine.reduce((s, o) => s + Number(o.total), 0)),
      menuValue: cents(mine.reduce((s, o) => s + Number(o.owner_menu_value ?? o.subtotal), 0)),
      orders: mine.length,
    };
  } catch {
    return null;
  }
}
