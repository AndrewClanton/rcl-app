"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/auth";
import type { EmployeeRole } from "@/lib/types";

// Roles assignable through this UI. 'owner' is deliberately excluded --
// there's exactly one (Andrew), and handing it out via a dropdown risks
// creating a second one or an accidental self-demotion. Changing who the
// owner is is a one-off, done directly against the database, not a routine
// admin action.
const ASSIGNABLE_ROLES: EmployeeRole[] = ["cashier", "manager", "admin"];

function revalidate() {
  revalidatePath("/admin/staff");
  revalidatePath("/admin");
}

export async function updateEmployeeRole(employeeId: string, role: EmployeeRole) {
  await requireOwner();
  if (!ASSIGNABLE_ROLES.includes(role)) throw new Error("Not an assignable role");

  const supabase = createAdminClient();
  const { data: target, error: fetchErr } = await supabase.from("employees").select("role").eq("id", employeeId).single();
  if (fetchErr) throw fetchErr;
  if (target.role === "owner") throw new Error("Can't change the owner's role here");

  const { error } = await supabase.from("employees").update({ role }).eq("id", employeeId);
  if (error) throw error;
  revalidate();
}

export async function setEmployeeActive(employeeId: string, active: boolean) {
  await requireOwner();

  const supabase = createAdminClient();
  const { data: target, error: fetchErr } = await supabase.from("employees").select("role").eq("id", employeeId).single();
  if (fetchErr) throw fetchErr;
  if (target.role === "owner") throw new Error("Can't deactivate the owner");

  const { error } = await supabase.from("employees").update({ active }).eq("id", employeeId);
  if (error) throw error;
  revalidate();
}
