import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { safePath } from "@/lib/safe-path";
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
//
// A 'display' account (an unattended signage login, like the TV showing the
// Now Playing screen) is deliberately NOT staff here, so every existing staff
// check -- pages, the register, every Server Action, route handlers -- locks
// it out without each one having to remember to. Its screens use
// requireDisplayScreen().
export async function getStaffSession(): Promise<StaffSession | null> {
  const session = await getEmployeeSession();
  return session && session.role !== "display" ? session : null;
}

// Staff *or* a display account, with no redirect. Exported for the page-view
// count (src/app/api/usage), which keeps only the role; gate with the
// functions above and below instead.
export async function getEmployeeSession(): Promise<StaffSession | null> {
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

// Where a display account lands if it's pointed anywhere else.
export const DISPLAY_HOME = "/display/now-playing";

// For signage pages: any active staff login *or* a display account. Sends
// someone signed out to the login page and back here afterwards, so a TV
// pointed straight at its screen only has to be signed in once.
export async function requireDisplayScreen(returnTo: string): Promise<StaffSession> {
  const session = await getEmployeeSession();
  if (!session) redirect(`/login?redirect=${encodeURIComponent(returnTo)}`);
  return session;
}

// requireDisplayScreen() for the Server Actions a display screen itself
// calls (the customer screen's check-in). Only for actions safe to hand an
// unattended screen: nothing that returns member details or touches sales,
// staff or money -- those stay behind assertStaff().
export async function assertDisplayScreen(): Promise<StaffSession> {
  const session = await getEmployeeSession();
  if (!session) throw new Error("Not authorized");
  return session;
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
//
// returnTo: the page to come back to after signing in (the register passes
// "/pos", so a register iPad that has to sign in again lands back on the
// register, not the back office). Checked by safePath like any redirect.
export async function requireStaff(returnTo?: string): Promise<StaffSession> {
  const back = safePath(returnTo);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(back ? `/login?redirect=${encodeURIComponent(back)}` : "/login");

  const session = await getStaffSession();
  if (!session) {
    // A display account that wandered off its screen goes back to it.
    if ((await getEmployeeSession())?.role === "display") redirect(DISPLAY_HOME);
    redirect(back ? `/login?error=not_staff&redirect=${encodeURIComponent(back)}` : "/login?error=not_staff");
  }
  return session;
}

// 'owner' is a superset of 'admin' (the co-owners -- Andrew, Caleb and
// Nathan -- who can also grant/revoke admin access for everyone else -- see
// requireOwner() below), so anything gated to "admin-level" access should
// treat the two the same.
export function hasAdminAccess(role: EmployeeRole): boolean {
  return role === "admin" || role === "owner";
}

// Managers and up: the team tools (staff schedule, assigned to-dos,
// timesheets) are for whoever runs the floor and the office.
export function hasManagerAccess(role: EmployeeRole): boolean {
  return role === "manager" || role === "admin" || role === "owner";
}

export async function requireManager(): Promise<StaffSession> {
  const session = await requireStaff();
  if (!hasManagerAccess(session.role)) redirect("/admin");
  return session;
}

export async function assertManager(): Promise<StaffSession> {
  const session = await assertStaff();
  if (!hasManagerAccess(session.role)) throw new Error("Not authorized");
  return session;
}

// Stricter than requireStaff() -- 'admin' or 'owner' only, not manager/
// cashier. Used for the Dev Notes feedback tool (a small, deliberately-
// restricted group per Andrew's own request) and its review queue.
export async function requireAdmin(): Promise<StaffSession> {
  const session = await requireStaff();
  if (!hasAdminAccess(session.role)) redirect("/admin");
  return session;
}

// Stricter still -- only 'owner' (the co-owners). Gates the staff/role-management
// page, since deciding who else gets admin access is an owners' call.
export async function requireOwner(): Promise<StaffSession> {
  const session = await requireStaff();
  if (session.role !== "owner") redirect("/admin");
  return session;
}

export function isOwner(role: EmployeeRole): boolean {
  return role === "owner";
}

// requireOwner() for actions (e.g. the Email page's Sending on/off switch).
export async function assertOwner(): Promise<StaffSession> {
  const session = await assertStaff();
  if (!isOwner(session.role)) throw new Error("Not authorized");
  return session;
}
