import "server-only";
import type { User } from "@supabase/supabase-js";
import type { EmployeeRole } from "@/lib/types";
import { hasManagerAccess, type StaffSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createImplicitFlowClient } from "@/lib/supabase/client";
import { allowAttempt } from "@/lib/rate-limit";
import { siteOrigin } from "@/lib/site-origin";
import { maskEmail, seesFullContact } from "@/lib/contact-mask";
import { exactEmail, sameEmail } from "@/lib/email-match";
import { hasPhoneOnFile, issueClaimLink } from "@/lib/member-claim";
import { CLAIM_LIFETIME_S } from "@/lib/member-claim-token";
import { sendEmail } from "@/lib/email/send";
import { setupEmail } from "@/lib/email/setup-email";
import { hashEmail } from "@/lib/email/hash";
import { scrubAddresses } from "@/lib/email/format";
import { plainResetError } from "@/lib/auth-email-errors";

// "Sign-in help": one path for anyone who can't get into the website, that
// does the right thing for the person:
//
//   - They have a website login: email a password reset (the same email
//     "Forgot password" always sent, through Supabase, from Royale Cinema
//     Lounge). Implicit flow on purpose (lib/supabase/client.ts
//     createImplicitFlowClient), so the link works on any device. It lands
//     on /account/reset-password, which sends staff to /admin and members
//     to /account.
//   - A member account but no login, with a phone on file: email a setup
//     link (a claim link, lib/member-claim.ts) to the email on file,
//     "Finish setting up your Royale account". Opening it goes straight to
//     making a login for that account.
//   - A member account, no login, no usable phone: no email. Staff add the
//     phone first (claim links are only made for accounts with one); the
//     person is asked to come see us at the bar.
//   - Nothing under that email: the sign-in page says only "if that email
//     has an account, we've sent you a link" (staff can't reach this case).
//
// Used by the sign-in page (anyone), the Back office member page (managers
// and up; copying a reset link is owner only, since it signs them in) and
// the Staff page (owner). Every send is rate-limited and logged with ids
// only, never an address or a link.

export const SETUP_DAYS = Math.round(CLAIM_LIFETIME_S.email / 86_400);

const LIMIT = {
  sender: [30, 3600], // per staff member: everything they send or copy
  resetEmail: [3, 3600], // per login
  setupEmail: [3, 3600], // per member
  copyLink: [5, 3600], // per member or login
  publicConnection: [10, 600], // per visitor connection, on the sign-in page
  publicEmail: [5, 3600], // per address typed there
} as const;

const allow = (key: string, [max, windowSeconds]: readonly [number, number]) => allowAttempt(key, max, windowSeconds);
const now = () => new Date().toISOString();

const NO_PHONE = "Add their phone number first: setup links are only made for accounts with a phone on file.";
const SEND_FAILED = "Couldn't send the email just now. Try again in a minute.";

// ---------- who they are ----------

interface MemberForHelp {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  auth_user_id: string | null;
}

type LoginLookup = { ok: true; email: string; socialOnly: string | null } | { ok: false; error: string };

const PROVIDER_NAME: Record<string, string> = { google: "Google", facebook: "Facebook" };

// "Google" (or "Facebook") when that's the only way they sign in, so they
// have no password yet; null when they already have one.
function socialOnly(user: User): string | null {
  // Some admin lookups leave out identities; app_metadata.providers is kept
  // by Supabase and can't be edited by the person.
  const meta = user.app_metadata ?? {};
  const fromMeta: string[] = Array.isArray(meta.providers) ? meta.providers : typeof meta.provider === "string" ? [meta.provider] : [];
  const providers = new Set([...(user.identities ?? []).map((i) => i.provider), ...fromMeta]);
  if (providers.size === 0 || providers.has("email")) return null;
  const first = [...providers][0];
  return PROVIDER_NAME[first] ?? first.charAt(0).toUpperCase() + first.slice(1);
}

// The login's own address (from auth, not members.email, which can differ).
async function lookUpLogin(authUserId: string): Promise<LoginLookup> {
  const { data, error } = await createAdminClient().auth.admin.getUserById(authUserId);
  if (error || !data?.user) return { ok: false, error: "Couldn't find their website login. Reload and try again." };
  // Facebook logins made with a phone number can arrive with no address.
  if (!data.user.email) return { ok: false, error: "Their website login has no email address, so there's nowhere to send a reset." };
  return { ok: true, email: data.user.email, socialOnly: socialOnly(data.user) };
}

type Case =
  | { kind: "reset"; authUserId: string; email: string; socialOnly: string | null }
  | { kind: "setup"; email: string | null }
  | { kind: "no_phone" }
  | { kind: "unavailable"; error: string };

async function caseFor(m: MemberForHelp): Promise<Case> {
  if (m.auth_user_id) {
    const login = await lookUpLogin(m.auth_user_id);
    return login.ok ? { kind: "reset", authUserId: m.auth_user_id, email: login.email, socialOnly: login.socialOnly } : { kind: "unavailable", error: login.error };
  }
  if (!hasPhoneOnFile(m.phone)) return { kind: "no_phone" };
  return { kind: "setup", email: m.email?.trim() || null };
}

async function loadMember(memberId: string): Promise<MemberForHelp | null> {
  const { data } = await createAdminClient().from("members").select("id, name, email, phone, auth_user_id").eq("id", memberId).is("erased_at", null).maybeSingle();
  return data ?? null;
}

// ---------- sending ----------

async function sendReset(authUserId: string, email: string, about: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await allow(`sih-reset:${authUserId}`, LIMIT.resetEmail))) {
    return { ok: false, error: "They've had 3 password emails in the last hour. Ask them to check their spam folder, or try again later." };
  }
  const { error } = await createImplicitFlowClient().auth.resetPasswordForEmail(email, {
    redirectTo: `${await siteOrigin()}/account/reset-password`,
  });
  if (error) {
    console.error(`sign-in help: password reset not sent for ${about} (login ${authUserId}): ${error.code ?? "no code"} ${error.status ?? ""}`.trim());
    return { ok: false, error: plainResetError(error) };
  }
  console.info(`sign-in help: password reset emailed for ${about} (login ${authUserId}) at ${now()}`);
  return { ok: true };
}

async function sendSetup(m: MemberForHelp, to: string, about: string): Promise<{ ok: true } | { ok: false; error: string; limited?: boolean }> {
  if (!(await allow(`sih-setup:${m.id}`, LIMIT.setupEmail))) {
    return { ok: false, limited: true, error: "They've had 3 setup emails in the last hour. Ask them to check their spam folder, or try again later." };
  }
  const url = await issueClaimLink(m.id, "email");
  if (!url) return { ok: false, error: "Couldn't make a setup link just now. Try again in a minute." };
  const mail = setupEmail({ name: m.name, url, days: SETUP_DAYS });
  const sent = await sendEmail(to, mail.subject, mail.html, { text: mail.text });
  if (!sent.ok) {
    console.error(`sign-in help: setup email not sent for member ${m.id} ${about}: ${scrubAddresses(sent.error)}`);
    return { ok: false, error: scrubAddresses(sent.error) || SEND_FAILED };
  }
  console.info(`sign-in help: setup link emailed for member ${m.id} ${about} at ${now()}`);
  return { ok: true };
}

// ---------- Back office ----------

// What the member page's sign-in help card shows. A cashier's page never
// looks anything up. Addresses follow lib/contact-mask.ts.
export type SignInHelpCard =
  | { state: "managers-only" }
  | { state: "reset"; email: string; socialOnly: string | null; canCopy: boolean }
  | { state: "setup"; email: string | null; days: number }
  | { state: "no-phone" }
  | { state: "unavailable"; reason: string };

export async function signInHelpCard(member: MemberForHelp, role: EmployeeRole | null): Promise<SignInHelpCard> {
  if (!role || !hasManagerAccess(role)) return { state: "managers-only" };
  const c = await caseFor(member).catch((): Case => ({ kind: "unavailable", error: "Couldn't look up their website login just now. Reload to try again." }));
  const shown = (e: string) => (seesFullContact(role) ? e : (maskEmail(e) ?? ""));
  switch (c.kind) {
    case "reset":
      return { state: "reset", email: shown(c.email), socialOnly: c.socialOnly, canCopy: role === "owner" };
    case "setup":
      return { state: "setup", email: c.email ? shown(c.email) : null, days: SETUP_DAYS };
    case "no_phone":
      return { state: "no-phone" };
    case "unavailable":
      return { state: "unavailable", reason: c.error };
  }
}

export type HelpSent = { ok: true; sent: "reset" | "setup"; socialOnly: string | null; days: number } | { ok: false; error: string };
export type HelpLink = { ok: true; kind: "reset" | "setup"; link: string; email: string | null; passwordLogin: boolean; days: number } | { ok: false; error: string };

// Callers check the session (assertManager / requireOwner); this checks
// the role again, so the rules live here in one place.
async function senderBlocked(sender: StaffSession): Promise<string | null> {
  if (!hasManagerAccess(sender.role)) return "Only a manager or owner can do this.";
  if (!(await allow(`sih-by:${sender.employeeId}`, LIMIT.sender))) return "You've sent a lot of sign-in help this hour. Try again later.";
  return null;
}

// The member page's "Send sign-in help": decides on the server, from the
// account as it is now, so it can't be talked into the wrong one.
export async function emailSignInHelp(memberId: string, sender: StaffSession): Promise<HelpSent> {
  const blocked = await senderBlocked(sender);
  if (blocked) return { ok: false, error: blocked };
  const m = await loadMember(memberId);
  if (!m) return { ok: false, error: "Member not found." };
  const c = await caseFor(m);
  const about = `member ${memberId} by employee ${sender.employeeId}`;
  switch (c.kind) {
    case "reset": {
      const r = await sendReset(c.authUserId, c.email, about);
      return r.ok ? { ok: true, sent: "reset", socialOnly: c.socialOnly, days: 0 } : r;
    }
    case "setup": {
      if (!c.email) return { ok: false, error: "There's no email on file. Copy the link and text it to them instead." };
      const r = await sendSetup(m, c.email, `by employee ${sender.employeeId}`);
      return r.ok ? { ok: true, sent: "setup", socialOnly: null, days: SETUP_DAYS } : { ok: false, error: r.error };
    }
    case "no_phone":
      return { ok: false, error: NO_PHONE };
    case "unavailable":
      return { ok: false, error: c.error };
  }
}

// A one-time password reset link to hand over, for when email can't reach
// them. Anyone holding it can sign in as them, so it's owner only, shown
// once and never stored or logged. Works once; expires on Supabase's
// schedule (an hour by default).
async function recoveryLink(authUserId: string, sender: StaffSession, about: string): Promise<HelpLink> {
  if (sender.role !== "owner") return { ok: false, error: "Only an owner can copy a password reset link, since anyone holding it can sign in as them. Send the email instead." };
  if (!(await allow(`sih-link:${authUserId}`, LIMIT.copyLink))) return { ok: false, error: "That's a lot of reset links for them this hour. Try again later." };
  const login = await lookUpLogin(authUserId);
  if (!login.ok) return login;
  const { data, error } = await createAdminClient().auth.admin.generateLink({
    type: "recovery",
    email: login.email,
    options: { redirectTo: `${await siteOrigin()}/account/reset-password` },
  });
  const link = data?.properties?.action_link;
  if (error || !link) {
    console.error(`sign-in help: reset link not made for ${about}: ${error?.code ?? "no code"}`);
    return { ok: false, error: "Couldn't make a reset link. Try again in a minute." };
  }
  console.info(`sign-in help: reset link made for ${about} (login ${authUserId}) at ${now()}`);
  return { ok: true, kind: "reset", link, email: login.email, passwordLogin: login.socialOnly === null, days: 0 };
}

// The member page's "Copy link", to text them: the setup link for someone
// with no login (managers and up), or a reset link for a login (owner).
export async function signInHelpLink(memberId: string, sender: StaffSession): Promise<HelpLink> {
  const blocked = await senderBlocked(sender);
  if (blocked) return { ok: false, error: blocked };
  const m = await loadMember(memberId);
  if (!m) return { ok: false, error: "Member not found." };
  const c = await caseFor(m);
  switch (c.kind) {
    case "reset":
      return recoveryLink(c.authUserId, sender, `member ${memberId} by employee ${sender.employeeId}`);
    case "setup": {
      if (!(await allow(`sih-link:${m.id}`, LIMIT.copyLink))) return { ok: false, error: "That's a lot of setup links for them this hour. Use one you already made, or try again later." };
      const link = await issueClaimLink(m.id, "email");
      if (!link) return { ok: false, error: "Couldn't make a setup link just now. Try again in a minute." };
      console.info(`sign-in help: setup link copied for member ${m.id} by employee ${sender.employeeId} at ${now()}`);
      return { ok: true, kind: "setup", link, email: null, passwordLogin: false, days: SETUP_DAYS };
    }
    case "no_phone":
      return { ok: false, error: NO_PHONE };
    case "unavailable":
      return { ok: false, error: c.error };
  }
}

// The Staff page (owner only): a staff login always gets the reset.
export async function emailPasswordReset(authUserId: string, sender: StaffSession, about: string): Promise<HelpSent> {
  const blocked = await senderBlocked(sender);
  if (blocked) return { ok: false, error: blocked };
  const login = await lookUpLogin(authUserId);
  if (!login.ok) return login;
  const r = await sendReset(authUserId, login.email, `${about} by employee ${sender.employeeId}`);
  return r.ok ? { ok: true, sent: "reset", socialOnly: login.socialOnly, days: 0 } : r;
}

export function staffRecoveryLink(authUserId: string, sender: StaffSession, about: string): Promise<HelpLink> {
  return recoveryLink(authUserId, sender, `${about} by employee ${sender.employeeId}`);
}

// ---------- the sign-in page ----------

// What the sign-in page tells someone who asked for help. "reset" and
// "generic" mean the page sends the password reset itself, from the
// browser, exactly as "Forgot password" always has (Supabase sends it only
// if a login has that address). "setup" means the setup link was emailed
// here; "ask_at_bar" means nothing was sent.
export type PublicHelp = { ok: true; outcome: "reset" | "setup" | "ask_at_bar" | "generic" } | { ok: false; error: string };

// `connection`: the visitor's hashed IP (lib/public-form-guard.ts). Safe to
// email the setup link from a public form: it only goes to the address on
// file, so only someone who can read that inbox gets it.
export async function signInHelpForEmail(rawEmail: string, connection: string): Promise<PublicHelp> {
  const email = String(rawEmail ?? "").trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter your email address above first." };
  if (!(await allow(`sih-public-ip:${connection}`, LIMIT.publicConnection))) return { ok: false, error: "Too many tries from this connection. Wait a few minutes and try again." };
  // Hashed like the never-mail list: no address is kept.
  if (!(await allow(`sih-public-email:${hashEmail(email)}`, LIMIT.publicEmail))) {
    return { ok: false, error: "Too many tries for that email just now. Check your inbox (and spam), or try again in a little while." };
  }

  // Case-insensitive, matching the lower(email) unique index (as
  // lib/member-link.ts does).
  const { data: m, error } = await createAdminClient()
    .from("members")
    .select("id, name, email, phone, auth_user_id")
    .ilike("email", exactEmail(email))
    .is("erased_at", null)
    .maybeSingle();
  if (error || !m) return { ok: true, outcome: "generic" };

  const c = await caseFor(m).catch((): Case => ({ kind: "unavailable", error: "" }));
  switch (c.kind) {
    case "reset":
      // A login under a different address than the one typed: nothing more
      // is said about it than for any other address.
      if (!sameEmail(c.email, email)) return { ok: true, outcome: "generic" };
      console.info(`sign-in help: password reset asked for member ${m.id} from the sign-in page at ${now()}`);
      return { ok: true, outcome: "reset" };
    case "setup": {
      const r = await sendSetup(m, c.email ?? email, "from the sign-in page");
      if (r.ok) return { ok: true, outcome: "setup" };
      return { ok: false, error: r.limited ? "We just emailed you a setup link. Check your inbox (and spam), or try again later." : SEND_FAILED };
    }
    case "no_phone":
      return { ok: true, outcome: "ask_at_bar" };
    case "unavailable":
      return { ok: true, outcome: "generic" };
  }
}
