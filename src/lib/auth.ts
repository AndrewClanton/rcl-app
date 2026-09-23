import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EmployeeRole } from "@/lib/types";

export interface StaffSession {
  employeeId: string;
  name: string;
  role: EmployeeRole;
  email: string;
}

// Two checks, both required:
// 1. A logged-in Supabase Auth session (set via /login).
// 2. That auth user is linked to an active `employees` row -- a Supabase
//    account alone isn't enough, since signups aren't self-service (see
//    src/app/login) but this is defense in depth against a stray/disabled
//    account.
// Reads employees via the service-role client because RLS on that table
// has no policies yet (see the initial migration's RLS comments) -- there
// is no "read your own employee row" policy for the regular client to use.
//
// Returns null instead of redirecting -- for Route Handlers (e.g. the
// schedule-graphic image endpoint), where an <img> tag or a download
// request needs a plain 401/403 response, not a redirect() built for page
// rendering. Page-level gating should use requireStaff() below instead.
export async function getStaffSession(): Promise<StaffSession | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  const { data: employee } = await admin
    .from("employees")
    .select("id, name, role, active")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!employee || !employee.active) return null;

  return { employeeId: employee.id, name: employee.name, role: employee.role, email: user.email ?? "" };
}

// For the top of every Server Action. A page/layout check (requireStaff()
// below) only gates *rendering* -- an action defined under it is still a
// public POST endpoint anyone holding its action ID can call (see Next's
// data-security guide, "Always re-verify inside the action"). Throws rather
// than redirects, since an action's caller is client code, not navigation.
// The message is redacted in production builds, which is fine here.
export async function assertStaff(): Promise<StaffSession> {
  const session = await getStaffSession();
  if (!session) throw new Error("Not authorized");
  return session;
}

// assertStaff() plus admin-level role -- for actions behind admin-only
// pages (e.g. the Dev Notes review queue).
export async function assertAdmin(): Promise<StaffSession> {
  const session = await assertStaff();
  if (!hasAdminAccess(session.role)) throw new Error("Not authorized");
  return session;
}

// Gates every /admin and /pos page. Distinguishes "not logged in" from
// "logged in but not staff" so the login page can show the right message
// (see src/app/login/LoginForm.tsx's `error=not_staff` handling).
export async function requireStaff(): Promise<StaffSession> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const session = await getStaffSession();
  if (!session) redirect("/login?error=not_staff");
  return session;
}

// 'owner' is a superset of 'admin' (the single primary admin, who can also
// grant/revoke admin access for everyone else -- see requireOwner() below),
// so anything gated to "admin-level" access should treat the two the same.
export function hasAdminAccess(role: EmployeeRole): boolean {
  return role === "admin" || role === "owner";
}

// Stricter than requireStaff() -- 'admin' or 'owner' only, not manager/
// cashier. Used for the Dev Notes feedback tool (a small, deliberately-
// restricted group per Andrew's own request) and its review queue.
export async function requireAdmin(): Promise<StaffSession> {
  const session = await requireStaff();
  if (!hasAdminAccess(session.role)) redirect("/admin");
  return session;
}

// Stricter still -- only 'owner' (Andrew). Gates the staff/role-management
// page, since deciding who else gets admin access is a one-person call.
export async function requireOwner(): Promise<StaffSession> {
  const session = await requireStaff();
  if (session.role !== "owner") redirect("/admin");
  return session;
}
