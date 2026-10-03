"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOwner } from "@/lib/auth";
import type { EmployeeRole } from "@/lib/types";
import type { User } from "@supabase/supabase-js";
import { emailIsProven } from "@/lib/member-link";
import { DEFAULT_PIN_HASH, hashPin } from "@/lib/pin";
import { pinProblem } from "@/lib/pin-rules";
import { emailPasswordReset, staffRecoveryLink, type HelpSent } from "@/lib/sign-in-help";

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

// New accounts start on 9999 (DEFAULT_PIN_HASH, src/lib/pin.ts) like every
// account before them, so they work on the register right away; the back
// office then asks them to set their own under My PIN.

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
export async function createEmployee(input: { name: string; email: string; password: string; role: EmployeeRole }): Promise<{ ok: true; reused: boolean } | { ok: false; error: string }> {
  await requireOwner();
  if (!ASSIGNABLE_ROLES.includes(input.role)) return { ok: false, error: "Pick a role." };

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !email) return { ok: false, error: "Name and email are required." };
  if (input.password.length < 6) return { ok: false, error: "Password must be at least 6 characters." };

  const supabase = createAdminClient();
  const found = await findAuthUserByEmail(email);
  let authUserId = found?.id;

  if (found) {
    const { data: existing } = await supabase.from("employees").select("id").eq("auth_user_id", found.id).maybeSingle();
    if (existing) return { ok: false, error: "That email already has a staff account." };
    if (!emailIsProven(found)) {
      return {
        ok: false,
        error: "That email already has a website login, made with a password and never confirmed, so it may not be theirs. Find them under “Give someone staff access” above to check, or use a different email.",
      };
    }
  } else {
    // app_metadata can only be set from here, never by the person, so it
    // records that the owner vouched for this address.
    const { data: userRes, error: userErr } = await supabase.auth.admin.createUser({ email, password: input.password, email_confirm: true, app_metadata: { email_vouched: true } });
    if (userErr) return { ok: false, error: "Couldn't create that login. Try again." };
    authUserId = userRes.user.id;
  }

  const { error: empErr } = await supabase
    .from("employees")
    .insert({ name, auth_user_id: authUserId, role: input.role, pin_hash: input.role === "display" ? NO_PIN : DEFAULT_PIN_HASH });
  if (empErr) return { ok: false, error: "Couldn't save that. Try again." };
  revalidate();
  return { ok: true, reused: !!found };
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
  // False for a password login whose email was never confirmed: it could
  // have been made by someone else using this person's address.
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
  const logins = await Promise.all(authIds.map((id) => supabase.auth.admin.getUserById(id).then((r) => r.data.user)));
  const verifiedByAuth = new Map(logins.filter((u) => !!u).map((u) => [u!.id, emailIsProven(u!)]));
  return (members ?? []).map((m) => {
    const s = staffByAuth.get(m.auth_user_id);
    return { memberId: m.id, name: m.name, email: m.email, staffRole: (s?.role as EmployeeRole) ?? null, staffActive: !!s?.active, verified: verifiedByAuth.get(m.auth_user_id) ?? false };
  });
}

export async function makeStaff(memberId: string, role: EmployeeRole): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireOwner();
  // Display accounts are for TVs, not people -- those still get their own login below.
  if (!ASSIGNABLE_ROLES.includes(role) || role === "display") return { ok: false, error: "Pick cashier, manager or admin." };
  const supabase = createAdminClient();
  const { data: member } = await supabase.from("members").select("name, auth_user_id, erased_at").eq("id", memberId).maybeSingle();
  if (!member || member.erased_at) return { ok: false, error: "That account wasn't found." };
  if (!member.auth_user_id) return { ok: false, error: "They haven't signed in to the website yet. Ask them to sign in once, then find them here." };

  const { data: existing } = await supabase.from("employees").select("id, role, active").eq("auth_user_id", member.auth_user_id).maybeSingle();
  if (existing?.role === "owner") return { ok: false, error: "That's an owner's account." };
  if (existing?.active) return { ok: false, error: "They're already on staff. Change their role in the list below." };
  const { error } = existing
    ? await supabase.from("employees").update({ role, active: true }).eq("id", existing.id)
    : await supabase.from("employees").insert({ name: member.name, auth_user_id: member.auth_user_id, role, pin_hash: DEFAULT_PIN_HASH });
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  revalidate();
  return { ok: true };
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
// Both go through lib/sign-in-help.ts, like the member page's sign-in help.
// Usually: email them the reset (emailStaffPasswordReset), the same email
// "Forgot password" sends, from Royale Cinema Lounge to their login's own
// address, so nobody else ever holds the link. For when email can't reach
// them: the owner makes a one-time recovery link here and hands it over
// (text it to them, or open it on their phone). Either way it opens the
// site's Reset password page (/account/reset-password), already signed in
// as them, to pick a new password, and a staff login then lands in the
// back office (account/actions.ts afterPasswordReset). The link works once
// and expires on Supabase's schedule (an hour by default).
//
// Anyone holding a made link can take over that login, so it's owner-only,
// shown once, never stored, and each one is logged (who, for whom, when;
// ids only).

export type RecoveryLinkResult =
  | { ok: true; link: string; email: string; passwordLogin: boolean }
  | { ok: false; error: string };

async function staffLogin(employeeId: string): Promise<{ ok: true; authUserId: string } | { ok: false; error: string }> {
  const { data: employee } = await createAdminClient().from("employees").select("auth_user_id").eq("id", employeeId).maybeSingle();
  if (!employee) return { ok: false, error: "That person wasn't found. Reload the page." };
  if (!employee.auth_user_id) return { ok: false, error: "They don't have a login to reset. Add one with “Create a new login” above." };
  return { ok: true, authUserId: employee.auth_user_id };
}

export async function createRecoveryLink(employeeId: string): Promise<RecoveryLinkResult> {
  const me = await requireOwner();
  const login = await staffLogin(employeeId);
  if (!login.ok) return login;
  const r = await staffRecoveryLink(login.authUserId, me, `employee ${employeeId}`);
  if (!r.ok) return r;
  // A Google-only login has no password yet; setting one adds email and
  // password sign-in alongside Google, which they may not need.
  return { ok: true, link: r.link, email: r.email ?? "", passwordLogin: r.passwordLogin };
}

export async function emailStaffPasswordReset(employeeId: string): Promise<HelpSent> {
  const me = await requireOwner();
  const login = await staffLogin(employeeId);
  if (!login.ok) return login;
  return emailPasswordReset(login.authUserId, me, `employee ${employeeId}`);
}

// For someone who forgot their PIN: the owner sets a temporary one and
// tells them. pin_must_change makes the back office ask them to pick
// their own (it arrives with migration 20260929100000_manager_pins.sql;
// until then the PIN still saves, there's just no reminder).
export async function resetEmployeePin(employeeId: string, tempPin: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireOwner();
  const problem = pinProblem(tempPin);
  if (problem) return { ok: false, error: problem };

  const supabase = createAdminClient();
  const { data: target } = await supabase.from("employees").select("role").eq("id", employeeId).maybeSingle();
  if (!target) return { ok: false, error: "That person wasn't found." };
  if (target.role === "display") return { ok: false, error: "Display screens don't use a PIN." };

  const pin_hash = hashPin(tempPin);
  const { error } = await supabase.from("employees").update({ pin_hash, pin_must_change: true }).eq("id", employeeId);
  if (error) {
    const { error: retryErr } = await supabase.from("employees").update({ pin_hash }).eq("id", employeeId);
    if (retryErr) return { ok: false, error: "Couldn't save that. Try again." };
  }
  revalidate();
  return { ok: true };
}
