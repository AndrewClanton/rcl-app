"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/auth";
import type { EmployeeRole } from "@/lib/types";
import type { User } from "@supabase/supabase-js";
import { emailIsProven } from "@/lib/member-link";
import { newTempPin } from "@/lib/manager-pin";
import { siteOrigin } from "@/lib/site-origin";

// Roles assignable through this UI. 'owner' is deliberately excluded --
// the co-owners (Andrew, Caleb, Nathan) are set directly against the
// database, since handing it out via a dropdown risks creating one by
// accident or an accidental self-demotion. Adding or removing an owner is a
// one-off, not a routine admin action.
const ASSIGNABLE_ROLES: EmployeeRole[] = ["cashier", "manager", "admin", "display"];

// Display accounts are screens, not people -- they never enter a PIN, and a
// PIN hash that can't parse (see verifyPin) can never match.
const NO_PIN = "none";

function revalidate() {
  revalidatePath("/admin/staff");
  revalidatePath("/admin");
}

// New accounts start on a random temporary PIN (newTempPin,
// src/lib/manager-pin.ts), shown once to the owner to pass on. It works on
// the register right away; the back office then asks them to set their own
// under My PIN.

// Every login with this email, looking past the first page (listUsers
// returns 50 at a time by default).
async function findAuthUserByEmail(email: string): Promise<User | null> {
  const supabase = createAdminClient();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 1000) return null;
  }
  return null;
}

// Adds a new staff login -- the UI equivalent of scripts/create-admin-user.mjs.
// If the email already belongs to a login whose owner proved the address
// (Google, or a confirmed email), that login is reused so the same person
// doesn't need two. An unconfirmed one isn't: anyone could have signed up
// with a future hire's email ahead of time.
export async function createEmployee(input: {
  name: string;
  email: string;
  password: string;
  role: EmployeeRole;
}): Promise<{ ok: true; reused: boolean; pin: string | null } | { ok: false; error: string }> {
  await requireOwner();
  if (!ASSIGNABLE_ROLES.includes(input.role)) return { ok: false, error: "Pick a role." };

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !email) return { ok: false, error: "Name and email are required." };
  if (input.password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };

  // Made first, so a hiccup here doesn't leave a login with no staff row.
  const temp = input.role === "display" ? null : await newTempPin(null);
  if (input.role !== "display" && !temp) return { ok: false, error: "Couldn't make them a PIN. Try again." };

  const supabase = createAdminClient();
  const found = await findAuthUserByEmail(email);
  let authUserId = found?.id;

  if (found) {
    const { data: existing } = await supabase.from("employees").select("id").eq("auth_user_id", found.id).maybeSingle();
    if (existing) return { ok: false, error: "That email already has a staff account." };
    // listUsers can leave out a login's identities, which emailIsProven
    // needs to see that Google or Facebook gave this very address.
    const { data: full, error: fullErr } = await supabase.auth.admin.getUserById(found.id);
    if (fullErr || !full.user) return { ok: false, error: "Couldn't check the login that email already has. Try again." };
    if (!emailIsProven(full.user)) {
      return {
        ok: false,
        error: "That email already has a website login that never proved the address is theirs (a password login that was never confirmed, or a Google login whose email was changed). It may not be theirs. Find them under “Give someone staff access” above to check with them, or use a different email.",
      };
    }
  } else {
    // app_metadata can only be set from here, never by the person, so it
    // records that the owner vouched for this address.
    const { data: userRes, error: userErr } = await supabase.auth.admin.createUser({ email, password: input.password, email_confirm: true, app_metadata: { email_vouched: true } });
    if (userErr) return { ok: false, error: "Couldn't create that login. Try again." };
    authUserId = userRes.user.id;
  }

  const { error: empErr } = await supabase.from("employees").insert({ name, auth_user_id: authUserId, role: input.role, ...(temp ? temp.columns : { pin_hash: NO_PIN }) });
  if (empErr) return { ok: false, error: "Couldn't save that. Try again." };
  revalidate();
  return { ok: true, reused: !!found, pin: temp?.pin ?? null };
}

// ---------- giving an existing account staff access ----------
// Most staff already have a website login (Google or email) from being a
// member. Rather than a second account with a made-up password, the owner
// finds that account here and gives it a role; they sign in to the back
// office and register with the login they already use.

export interface AccountMatch {
  memberId: string;
  name: string;
  email: string | null;
  staffRole: EmployeeRole | null;
  staffActive: boolean;
  // False when the login never proved it owns its email: a password login
  // that was never confirmed, or a Google or Facebook login whose email
  // was changed afterwards. Someone else could have made it.
  verified: boolean;
}

export async function findAccounts(query: string): Promise<AccountMatch[]> {
  await requireOwner();
  // Keep the text safe to drop into the search filter below.
  const q = query.replace(/[%,()*"\\]/g, " ").trim();
  if (q.length < 2) return [];
  const supabase = createAdminClient();
  const { data: members, error } = await supabase
    .from("members")
    .select("id, name, email, auth_user_id")
    .not("auth_user_id", "is", null)
    .is("erased_at", null)
    .or(`name.ilike."%${q}%",email.ilike."%${q}%"`)
    .order("name")
    .limit(12);
  if (error) throw error;
  const authIds = (members ?? []).map((m) => m.auth_user_id as string);
  const { data: staff } = authIds.length ? await supabase.from("employees").select("auth_user_id, role, active").in("auth_user_id", authIds) : { data: [] };
  const staffByAuth = new Map((staff ?? []).map((s) => [s.auth_user_id, s]));
  // getUserById, not listUsers: it includes the identities emailIsProven checks.
  const logins = await Promise.all(authIds.map((id) => supabase.auth.admin.getUserById(id).then((r) => r.data.user)));
  const verifiedByAuth = new Map(logins.filter((u) => !!u).map((u) => [u!.id, emailIsProven(u!)]));
  return (members ?? []).map((m) => {
    const s = staffByAuth.get(m.auth_user_id);
    return { memberId: m.id, name: m.name, email: m.email, staffRole: (s?.role as EmployeeRole) ?? null, staffActive: !!s?.active, verified: verifiedByAuth.get(m.auth_user_id) ?? false };
  });
}

// checkedInPerson: for a login that never proved its email, the owner
// ticked that they checked with the person face to face that it's theirs.
// The screen asks before sending it; this refuses without it, so calling
// the action directly can't skip the question. pin is the new temporary
// PIN to pass on, or null when restoring someone who keeps their old one.
export async function makeStaff(
  memberId: string,
  role: EmployeeRole,
  checkedInPerson?: boolean,
): Promise<{ ok: true; pin: string | null } | { ok: false; error: string; needsCheck?: true }> {
  const me = await requireOwner();
  // Display accounts are for TVs, not people -- those still get their own login below.
  if (!ASSIGNABLE_ROLES.includes(role) || role === "display") return { ok: false, error: "Pick cashier, manager or admin." };
  const supabase = createAdminClient();
  const { data: member } = await supabase.from("members").select("name, auth_user_id, erased_at").eq("id", memberId).maybeSingle();
  if (!member || member.erased_at) return { ok: false, error: "That account wasn't found." };
  if (!member.auth_user_id) return { ok: false, error: "They haven't signed in to the website yet. Ask them to sign in once, then find them here." };

  const { data: existing } = await supabase.from("employees").select("id, role, active").eq("auth_user_id", member.auth_user_id).maybeSingle();
  if (existing?.role === "owner") return { ok: false, error: "That's an owner's account." };
  if (existing?.active) return { ok: false, error: "They're already on staff. Change their role in the list below." };

  const { data: login, error: loginErr } = await supabase.auth.admin.getUserById(member.auth_user_id);
  if (loginErr || !login.user) return { ok: false, error: "Couldn't check their login. Try again." };
  if (!emailIsProven(login.user)) {
    if (checkedInPerson !== true) {
      return { ok: false, needsCheck: true, error: "Their login never proved the email is theirs. Check with them in person that it is, then try again." };
    }
    console.info(`staff: unconfirmed login ${member.auth_user_id} given ${role} by ${me.employeeId} after an in-person check, at ${new Date().toISOString()}`);
  }

  if (existing) {
    const { error } = await supabase.from("employees").update({ role, active: true }).eq("id", existing.id);
    if (error) return { ok: false, error: "Couldn't save that. Try again." };
    revalidate();
    return { ok: true, pin: null };
  }
  const temp = await newTempPin(null);
  if (!temp) return { ok: false, error: "Couldn't make them a PIN. Try again." };
  const { error } = await supabase.from("employees").insert({ name: member.name, auth_user_id: member.auth_user_id, role, ...temp.columns });
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  revalidate();
  return { ok: true, pin: temp.pin };
}

type Result = { ok: true } | { ok: false; error: string };

// The screen asks before sending this (with a stronger warning for admin).
// Here: never the owner's row, and never your own. The owner row is already
// out of reach (owner isn't assignable, and an owner target is refused), but
// the self check says it outright, so a future second owner or admin-level
// editor can't demote themselves by accident either.
export async function updateEmployeeRole(employeeId: string, role: EmployeeRole): Promise<Result> {
  const me = await requireOwner();
  if (!ASSIGNABLE_ROLES.includes(role)) return { ok: false, error: "Pick cashier, manager, admin or display screen." };
  if (employeeId === me.employeeId) return { ok: false, error: "You can't change your own role." };

  const supabase = createAdminClient();
  const { data: target, error: fetchErr } = await supabase.from("employees").select("role").eq("id", employeeId).maybeSingle();
  if (fetchErr || !target) return { ok: false, error: "That person wasn't found. Reload the page." };
  if (target.role === "owner") return { ok: false, error: "An owner's role can't be changed here." };

  const { error } = await supabase.from("employees").update({ role }).eq("id", employeeId);
  if (error) return { ok: false, error: "Couldn't change their role. Try again." };
  revalidate();
  return { ok: true };
}

export async function setEmployeeActive(employeeId: string, active: boolean): Promise<Result> {
  const me = await requireOwner();
  if (employeeId === me.employeeId) return { ok: false, error: "You can't deactivate your own account." };

  const supabase = createAdminClient();
  const { data: target, error: fetchErr } = await supabase.from("employees").select("role").eq("id", employeeId).maybeSingle();
  if (fetchErr || !target) return { ok: false, error: "That person wasn't found. Reload the page." };
  if (target.role === "owner") return { ok: false, error: "Owners can't be deactivated here." };

  const { error } = await supabase.from("employees").update({ active }).eq("id", employeeId);
  if (error) return { ok: false, error: `Couldn't ${active ? "reactivate" : "deactivate"} them. Try again.` };
  revalidate();
  return { ok: true };
}

// ---------- password reset for a staff login ----------
// Email isn't set up yet, so "forgot password" can't reach anyone. Instead
// the owner makes a one-time recovery link here and hands it over (text it
// to them, or open it on their phone). It opens the site's Reset password
// page (/account/reset-password), already signed in as them, to pick a new
// password. Supabase sends nothing itself: generateLink only returns the
// link. The link works once and expires on Supabase's schedule (an hour by
// default); making a new one replaces the old.
//
// Anyone holding the link can take over that login, so it's owner-only,
// shown once, never stored, and each one is logged (who, for whom, when).

export type RecoveryLinkResult =
  | { ok: true; link: string; email: string; passwordLogin: boolean }
  | { ok: false; error: string };

export async function createRecoveryLink(employeeId: string): Promise<RecoveryLinkResult> {
  const me = await requireOwner();
  const supabase = createAdminClient();
  const { data: employee } = await supabase.from("employees").select("name, auth_user_id").eq("id", employeeId).maybeSingle();
  if (!employee) return { ok: false, error: "That person wasn't found. Reload the page." };
  if (!employee.auth_user_id) return { ok: false, error: "They don't have a login to reset. Add one with “Create a new login” above." };

  const { data: userRes, error: userErr } = await supabase.auth.admin.getUserById(employee.auth_user_id);
  const email = userRes?.user?.email;
  if (userErr || !email) return { ok: false, error: "Couldn't find their login's email. Try again." };

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${await siteOrigin()}/account/reset-password` },
  });
  const link = data?.properties?.action_link;
  if (error || !link) {
    console.error("staff: recovery link not made", error?.message);
    return { ok: false, error: "Couldn't make a reset link. Try again in a minute." };
  }
  console.info(`staff: recovery link made for employee ${employeeId} by ${me.employeeId} at ${new Date().toISOString()}`);

  // A Google-only login has no password yet; setting one adds email and
  // password sign-in alongside Google, which they may not need.
  const providers = (userRes.user.app_metadata?.providers as string[] | undefined) ?? [userRes.user.app_metadata?.provider as string];
  return { ok: true, link, email, passwordLogin: providers.includes("email") };
}

// For someone who forgot their PIN: a new random temporary one, shown once
// to the owner to tell them. Their old PIN stops working straight away, and
// pin_must_change makes the back office ask them to pick their own.
export async function resetEmployeePin(employeeId: string): Promise<{ ok: true; pin: string } | { ok: false; error: string }> {
  await requireOwner();
  const supabase = createAdminClient();
  const { data: target } = await supabase.from("employees").select("role").eq("id", employeeId).maybeSingle();
  if (!target) return { ok: false, error: "That person wasn't found." };
  if (target.role === "display") return { ok: false, error: "Display screens don't use a PIN." };

  const temp = await newTempPin(employeeId);
  if (!temp) return { ok: false, error: "Couldn't make a PIN. Try again." };
  const { error } = await supabase.from("employees").update(temp.columns).eq("id", employeeId);
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  revalidate();
  return { ok: true, pin: temp.pin };
}
