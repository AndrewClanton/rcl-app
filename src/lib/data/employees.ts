import { createAdminClient } from "@/lib/supabase/admin";
import type { Employee, EmployeeRole, Member } from "@/lib/types";

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
  const { data, error } = await supabase.from("employees").select("id, name, role, active").eq("active", true).order("name");
  if (error) throw error;
  return data ?? [];
}

export interface EmployeeWithEmail extends Employee {
  email: string | null;
}

// employees.auth_user_id points at auth.users, which PostgREST doesn't
// expose for a join -- cross-referenced here via the service-role admin
// API instead (auth.admin.listUsers()), same technique already used by
// scripts/create-admin-user.mjs.
export async function getEmployees(): Promise<EmployeeWithEmail[]> {
  const supabase = createAdminClient();
  const [{ data: employees, error }, { data: usersRes, error: usersErr }] = await Promise.all([
    supabase.from("employees").select("id, name, role, active, auth_user_id").order("created_at"),
    supabase.auth.admin.listUsers(),
  ]);
  if (error) throw error;
  if (usersErr) throw usersErr;

  const emailById = new Map(usersRes.users.map((u) => [u.id, u.email ?? null]));
  return (employees ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    role: e.role,
    active: e.active,
    email: e.auth_user_id ? (emailById.get(e.auth_user_id) ?? null) : null,
  }));
}
