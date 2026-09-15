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

// Gates every /admin and /pos page. Two checks, both required:
// 1. A logged-in Supabase Auth session (set via /login).
// 2. That auth user is linked to an active `employees` row -- a Supabase
//    account alone isn't enough, since signups aren't self-service (see
//    src/app/login) but this is defense in depth against a stray/disabled
//    account.
// Reads employees via the service-role client because RLS on that table
// has no policies yet (see the initial migration's RLS comments) -- there
// is no "read your own employee row" policy for the regular client to use.
export async function requireStaff(): Promise<StaffSession> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const admin = createAdminClient();
  const { data: employee } = await admin
    .from("employees")
    .select("id, name, role, active")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!employee || !employee.active) {
    redirect("/login?error=not_staff");
  }

  return { employeeId: employee.id, name: employee.name, role: employee.role, email: user.email ?? "" };
}
