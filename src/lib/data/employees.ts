import { createAdminClient } from "@/lib/supabase/admin";
import type { Employee, EmployeeRole, Member } from "@/lib/types";
import { isDefaultPin } from "@/lib/pin";

export interface MemberStaffInfo {
  role: EmployeeRole;
  isViewer: boolean;
}

// A staff login doubles as a member account (same auth user), so the admin
// members screens can say whose account is whose -- e.g. that a given
// "Insiders" row is actually the owner. Keyed by member id; members with no
// active staff login are simply absent.
export async function getStaffInfoForMembers(members: Pick<Member, "id" | "auth_user_id">[], viewerEmployeeId: string | null): Promise<Record<string, MemberStaffInfo>> {
  const authIds = members.map((m) => m.auth_user_id).filter((id): id is string => !!id);
  if (authIds.length === 0) return {};
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("employees").select("id, role, auth_user_id").eq("active", true).in("auth_user_id", authIds);
  if (error) throw error;
  const byAuthId = new Map((data ?? []).map((e) => [e.auth_user_id as string, e]));
  const out: Record<string, MemberStaffInfo> = {};
  for (const m of members) {
    const e = m.auth_user_id ? byAuthId.get(m.auth_user_id) : undefined;
    if (e) out[m.id] = { role: e.role as EmployeeRole, isViewer: e.id === viewerEmployeeId };
  }
  return out;
}

// No public-read RLS policy on employees -- always read via service role.
export async function getActiveEmployees(): Promise<Employee[]> {
  const supabase = createAdminClient();
  // Display accounts are screens, not people -- never offered on the register.
  const { data, error } = await supabase.from("employees").select("id, name, role, active").eq("active", true).neq("role", "display").order("name");
  if (error) throw error;
  return data ?? [];
}

export interface EmployeeWithEmail extends Employee {
  email: string | null;
  pin: PinStatus;
}

// employees.auth_user_id points at auth.users, which PostgREST doesn't
// expose for a join -- cross-referenced here via the service-role admin
// API instead (auth.admin.listUsers()), same technique already used by
// scripts/create-admin-user.mjs.
export async function getEmployees(): Promise<EmployeeWithEmail[]> {
  const supabase = createAdminClient();
  const [employees, { data: usersRes, error: usersErr }] = await Promise.all([selectWithPinFlag(), supabase.auth.admin.listUsers()]);
  if (usersErr) throw usersErr;

  const emailById = new Map(usersRes.users.map((u) => [u.id, u.email ?? null]));
  return employees.map((e) => ({
    id: e.id,
    name: e.name,
    role: e.role,
    active: e.active,
    email: e.auth_user_id ? (emailById.get(e.auth_user_id) ?? null) : null,
    pin: pinStatus(e),
  }));
}

// ---------- PINs ----------
// "default": still 9999. "temporary": the owner reset it (Staff page) and
// they haven't picked their own yet. "own": they picked it. "none": a
// display screen, which never uses a PIN.
export type PinStatus = "default" | "temporary" | "own" | "none";

function pinStatus(row: { pin_hash: string; pin_must_change?: boolean | null }): PinStatus {
  if (!row.pin_hash?.startsWith("scrypt$")) return "none";
  if (isDefaultPin(row.pin_hash)) return "default";
  return row.pin_must_change ? "temporary" : "own";
}

interface EmployeePinRow {
  id: string;
  name: string;
  role: EmployeeRole;
  active: boolean;
  auth_user_id: string | null;
  pin_hash: string;
  pin_must_change?: boolean;
}

// Everyone (or one person), with their PIN hash. employees.pin_must_change
// comes with migration 20260929100000_manager_pins.sql; until it's applied
// this reads without it, and a reset PIN just looks like their own.
async function selectWithPinFlag(employeeId?: string): Promise<EmployeePinRow[]> {
  const supabase = createAdminClient();
  const run = (columns: string) => {
    const q = supabase.from("employees").select(columns);
    return employeeId ? q.eq("id", employeeId) : q.order("created_at");
  };
  const base = "id, name, role, active, auth_user_id, pin_hash";
  const withFlag = await run(`${base}, pin_must_change`);
  if (!withFlag.error) return (withFlag.data ?? []) as unknown as EmployeePinRow[];
  const { data, error } = await run(base);
  if (error) throw error;
  return (data ?? []) as unknown as EmployeePinRow[];
}

// For the "your PIN is still 9999" banner and the My PIN page. Null when
// it can't be read, so a hiccup never takes the back office down with it.
export async function getPinStatus(employeeId: string): Promise<PinStatus | null> {
  try {
    const [row] = await selectWithPinFlag(employeeId);
    return row ? pinStatus(row) : null;
  } catch {
    return null;
  }
}
