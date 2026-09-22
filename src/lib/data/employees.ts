import { createAdminClient } from "@/lib/supabase/admin";
import type { Employee } from "@/lib/types";

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
