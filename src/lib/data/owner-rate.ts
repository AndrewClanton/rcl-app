import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Back office -> Owner rate (owners only): which owners get the owner rate
// (the register's "Owner rate" tick: lib/register-totals.ts), every change
// to that, and the latest orders rung at it, with whose account it was and
// who rang it up.

export interface OwnerRateCandidate {
  id: string;
  name: string;
  role: string;
  ticked: boolean;
  // Their own member account (the same login). Without one, the register
  // can't offer the owner rate: it shows only with the owner's account on
  // the order.
  hasAccount: boolean;
}

export interface OwnerRateChange {
  id: string;
  at: string;
  person: string;
  on: boolean;
  by: string | null;
}

export interface OwnerRateOrder {
  id: string;
  orderNumber: number;
  at: string;
  owner: string; // whose account was on the order
  cashier: string | null; // who rang it up (and ticked Owner rate)
  status: string;
  subtotal: number; // at the owner rate, before tax
  menuValue: number;
  total: number;
}

export interface OwnerRateSettings {
  ready: boolean; // false until 20261003060000_owner_tab.sql is applied
  candidates: OwnerRateCandidate[]; // active owners
  rateChanges: OwnerRateChange[]; // newest first
  recent: OwnerRateOrder[]; // newest first
}

type Viewer = { role?: string | null } | null | undefined;

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export async function getOwnerRateSettings(viewer: Viewer): Promise<OwnerRateSettings> {
  if (viewer?.role !== "owner") throw new Error("Not authorized");
  const db = createAdminClient();
  const empty: OwnerRateSettings = { ready: false, candidates: [], rateChanges: [], recent: [] };
  const { data: staffRows, error } = await db.from("employees").select("id, name, role, active, owner_rate, auth_user_id").order("name");
  if (error) return empty;
  const staff = (staffRows ?? []) as { id: string; name: string; role: string; active: boolean; owner_rate: boolean; auth_user_id: string | null }[];
  const names = new Map(staff.map((e) => [e.id, firstName(e.name)]));
  const authIds = staff.map((e) => e.auth_user_id).filter((x): x is string => !!x);
  const [changes, members, orders] = await Promise.all([
    db.from("owner_rate_changes").select("*").order("created_at", { ascending: false }).limit(50),
    authIds.length ? db.from("members").select("id, auth_user_id").in("auth_user_id", authIds).is("erased_at", null) : Promise.resolve({ data: [], error: null }),
    // An owner-rate sale is a paid order with the menu value it replaced
    // (owner_menu_value); 'owner_tab' was the monthly tab before 10/5.
    db
      .from("orders")
      .select("id, order_number, completed_at, status, subtotal, total, owner_menu_value, member_id, employee_id, payment_method")
      .not("owner_menu_value", "is", null)
      .neq("payment_method", "owner_tab")
      .order("completed_at", { ascending: false })
      .limit(25),
  ]);
  const authToEmployee = new Map(staff.filter((e) => e.auth_user_id).map((e) => [e.auth_user_id as string, e.id]));
  const memberToEmployee = new Map(((members.data ?? []) as { id: string; auth_user_id: string }[]).map((m) => [m.id, authToEmployee.get(m.auth_user_id) ?? ""]));
  const withAccount = new Set(memberToEmployee.values());
  return {
    ready: true,
    candidates: staff.filter((e) => e.active && e.role === "owner").map((e) => ({ id: e.id, name: e.name, role: e.role, ticked: !!e.owner_rate, hasAccount: withAccount.has(e.id) })),
    rateChanges: ((changes.data ?? []) as { id: string; employee_id: string; turned_on: boolean; changed_by: string | null; created_at: string }[]).map((c) => ({
      id: c.id,
      at: c.created_at,
      person: names.get(c.employee_id) ?? "Someone",
      on: !!c.turned_on,
      by: c.changed_by ? (names.get(c.changed_by) ?? null) : null,
    })),
    recent: (
      (orders.data ?? []) as { id: string; order_number: number; completed_at: string; status: string; subtotal: number; total: number; owner_menu_value: number; member_id: string | null; employee_id: string | null }[]
    ).map((o) => ({
      id: o.id,
      orderNumber: Number(o.order_number),
      at: o.completed_at,
      owner: names.get(memberToEmployee.get(o.member_id ?? "") ?? "") ?? "an owner",
      cashier: o.employee_id ? (names.get(o.employee_id) ?? null) : null,
      status: o.status,
      subtotal: Number(o.subtotal),
      menuValue: Number(o.owner_menu_value),
      total: Number(o.total),
    })),
  };
}
