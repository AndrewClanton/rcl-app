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
const ASSIGNABLE_ROLES: EmployeeRole[] = ["cashier", "manager", "admin", "display"];

// Display accounts are screens, not people -- they never enter a PIN, and a
// PIN hash that can't parse (see verifyPin) can never match.
const NO_PIN = "none";

function revalidate() {
  revalidatePath("/admin/staff");
  revalidatePath("/admin");
}

// Same default PIN every account provisioned via scripts/create-admin-user.mjs
// has always gotten ("9999") -- there's no PIN-management UI yet, staff-side
// or here, so this keeps new accounts consistent with existing ones rather
// than introducing a second convention.
const DEFAULT_PIN_HASH = "scrypt$726376705f736565645f73616c74$1e51f61dd18946a3fda261fc467d6c44b2af95f7abec1d2b237d14a27733d09f";

// Adds a new staff login -- the UI equivalent of scripts/create-admin-user.mjs.
// If the email already belongs to a Supabase Auth user (e.g. someone who's
// already a customer/member under that address), that account is reused
// rather than erroring, so the same person doesn't need two logins.
export async function createEmployee(input: { name: string; email: string; password: string; role: EmployeeRole }) {
  await requireOwner();
  if (!ASSIGNABLE_ROLES.includes(input.role)) throw new Error("Not an assignable role");

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !email) throw new Error("Name and email are required");
  if (input.password.length < 6) throw new Error("Password must be at least 6 characters");

  const supabase = createAdminClient();

  const { data: usersRes, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) throw listErr;
  let authUserId = usersRes.users.find((u) => u.email?.toLowerCase() === email)?.id;

  if (authUserId) {
    const { data: existing } = await supabase.from("employees").select("id").eq("auth_user_id", authUserId).maybeSingle();
    if (existing) throw new Error("That email already has a staff account");
  } else {
    const { data: userRes, error: userErr } = await supabase.auth.admin.createUser({ email, password: input.password, email_confirm: true });
    if (userErr) throw userErr;
    authUserId = userRes.user.id;
  }

  const { error: empErr } = await supabase
    .from("employees")
    .insert({ name, auth_user_id: authUserId, role: input.role, pin_hash: input.role === "display" ? NO_PIN : DEFAULT_PIN_HASH });
  if (empErr) throw empErr;
  revalidate();
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
