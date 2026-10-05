import "server-only";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { awardClaimBonus } from "@/lib/claim-bonus";
import { emailIsProven } from "@/lib/member-link";
import { firstNameOf } from "@/lib/checkin";
import { claimUrl } from "@/lib/claim-link";
import { CLAIM_LIFETIME_S, emailClaimNonce, openClaimToken, sealClaimToken, type ClaimKind } from "@/lib/member-claim-token";

// "Claim your account": lets someone who has a members row but no website
// login (imported from the old site, or a regular made at the check-in
// tablet) set one up and see their points, visits and purchases online.
//
// The register hands them a link: a QR code on the tablet after they check
// in (good for 30 minutes), on their receipt (good for two weeks), or in a
// setup email (30 days). Opening the link goes straight to signing in
// (Google, or email and password), and that login is attached to the
// account the link was made for. Each link works once.
//
// Unlike ordinary sign-in (lib/member-link.ts), this doesn't need the email
// to match: the link itself is the proof (the owners chose that over asking
// for the phone's last four digits; points have little cash value). Their
// email is only saved on the account if it had none and the login proved it
// owns the address; otherwise the account keeps the email it has.
//
// Any account with no login can have one: links used to need a phone on
// file (left from the phone-digits check, long gone), which left out most
// of the members with only an email. Since the tablet's "Phone or email"
// check-in (Andrew, 10/1) they don't.

export type { ClaimKind } from "@/lib/member-claim-token";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A fresh link for this member, or null if there's nothing to claim: they
// already have a login, their info was removed, or the link couldn't be
// recorded (for instance before the member_claims migration is applied --
// the receipt then just prints without it, and the tablet shows its plain
// welcome). Never throws.
//
// kiosk links last 30 minutes, receipt links two weeks, and email links
// (sign-in help, lib/sign-in-help.ts) 30 days (CLAIM_LIFETIME_S).
// `skipIfIssuedWithinMs`: no new link if one of this kind was made for
// them that recently (the tablet makes one when it creates an account, and
// the register's confirm a moment later shouldn't make a second).
export async function issueClaimLink(memberId: string, kind: ClaimKind, opts: { skipIfIssuedWithinMs?: number } = {}): Promise<string | null> {
  if (!UUID.test(memberId) || !(kind === "kiosk" || kind === "receipt" || kind === "email")) return null;
  try {
    const admin = createAdminClient();
    const { data: m, error } = await admin.from("members").select("id, auth_user_id, erased_at").eq("id", memberId).maybeSingle();
    if (error || !m || m.auth_user_id || m.erased_at) return null;
    if (opts.skipIfIssuedWithinMs) {
      const since = new Date(Date.now() - opts.skipIfIssuedWithinMs).toISOString();
      const { data: recent, error: recentErr } = await admin.from("member_claims").select("id").eq("member_id", memberId).eq("kind", kind).gt("issued_at", since).limit(1);
      // An error here is most likely the table not existing yet: no link.
      if (recentErr || recent?.length) return null;
    }
    const sealed = sealClaimToken(memberId, kind);
    if (!sealed) return null;
    const { error: saveErr } = await admin
      .from("member_claims")
      .insert({ nonce: sealed.nonce, member_id: memberId, kind, expires_at: new Date(sealed.exp).toISOString() });
    if (saveErr) {
      console.error("claim link not recorded:", saveErr.message);
      return null;
    }
    return claimUrl(sealed.token);
  } catch (e) {
    console.error("claim link failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

// What a claim link is good for right now, for the claim page. Only the
// first name ever leaves this file.
export type ClaimState =
  | { state: "invalid" } // not one of ours, or cut off
  | { state: "unavailable" } // couldn't ask the database
  | { state: "gone" } // the account was removed
  | { state: "expired"; kind: ClaimKind }
  | { state: "used" }
  | { state: "has_login"; authUserId: string }
  | { state: "ready"; memberId: string; nonce: string; kind: ClaimKind; exp: number; firstName: string };

// (member_claims.failed_tries is left from the phone-digits step and no
// longer read or written.)
export async function readClaim(token: string | null | undefined): Promise<ClaimState> {
  const t = openClaimToken(token);
  if (!t) return { state: "invalid" };
  const admin = createAdminClient();
  const [claimRes, memberRes] = await Promise.all([
    admin.from("member_claims").select("member_id, used_at").eq("nonce", t.nonce).maybeSingle(),
    admin.from("members").select("id, name, auth_user_id, erased_at").eq("id", t.memberId).maybeSingle(),
  ]);
  if (claimRes.error || memberRes.error) return { state: "unavailable" };
  const claim = claimRes.data;
  const m = memberRes.data;
  if (!claim || claim.member_id !== t.memberId) return { state: "invalid" };
  if (!m || m.erased_at) return { state: "gone" };
  // Checked before "used", so whoever used it sees "you're all set".
  if (m.auth_user_id) return { state: "has_login", authUserId: m.auth_user_id };
  if (claim.used_at) return { state: "used" };
  if (t.expired) return { state: "expired", kind: t.kind };
  return { state: "ready", memberId: m.id, nonce: t.nonce, kind: t.kind, exp: t.exp, firstName: firstNameOf(m.name) };
}

// Short versions of the claim page's explanations, for when a link stops
// working partway through (the page shows the full ones on a reload).
const STATE_ERROR: Record<Exclude<ClaimState["state"], "ready">, string> = {
  invalid: "This link doesn't look right. Try scanning the code again, or ask us at the box office.",
  unavailable: "We couldn't check this link just now. Try again in a minute.",
  gone: "This link doesn't work anymore. Ask us at the box office and we'll help you set up your login.",
  expired: "This link has run out. Ask us at the box office for a fresh one.",
  used: "This link was already used. If that was you, just sign in.",
  has_login: "This account already has a login. Sign in with it instead.",
};

// Who the claim page is talking to, when someone is signed in: whether
// that login already belongs to another account (claiming would be
// refused), and whether it's a staff or screen login rather than theirs.
export async function describeLogin(user: User): Promise<{ email: string | null; linkedElsewhere: boolean; staff: boolean; screen: boolean }> {
  const admin = createAdminClient();
  const [{ data: member }, { data: employee }] = await Promise.all([
    admin.from("members").select("id").eq("auth_user_id", user.id).maybeSingle(),
    admin.from("employees").select("role, active").eq("auth_user_id", user.id).maybeSingle(),
  ]);
  return {
    email: user.email ?? null,
    linkedElsewhere: !!member,
    staff: !!employee?.active && employee.role !== "display",
    screen: employee?.role === "display",
  };
}

// The invite email's "Set my password" links, one per send, for a batch of
// recipients (lib/email/campaign-send.ts). Deterministic: the nonce comes
// from the send id and the expiry from when the send was queued, so a
// retried batch renders the same email (Resend's idempotency needs that),
// and the member_claims row is written once. A member who already has a
// login or was removed gets no link (the email then points them at their
// account or sign-in instead). Never throws.
export async function issueEmailClaimLinks(items: { memberId: string; sendId: string; queuedAt: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const ids = items.map((i) => i.memberId).filter((id) => UUID.test(id));
    if (!ids.length) return out;
    const admin = createAdminClient();
    const { data: members, error } = await admin.from("members").select("id, auth_user_id, erased_at").in("id", ids);
    if (error) return out;
    const ok = new Set((members ?? []).filter((m) => !m.auth_user_id && !m.erased_at).map((m) => m.id as string));
    const rows: { nonce: string; member_id: string; kind: ClaimKind; expires_at: string; issued_at: string }[] = [];
    const urls = new Map<string, string>();
    for (const it of items) {
      if (!ok.has(it.memberId)) continue;
      const nonce = emailClaimNonce(it.sendId);
      const issued = Math.floor(Date.parse(it.queuedAt) / 1000);
      if (!nonce || !Number.isFinite(issued)) continue;
      const sealed = sealClaimToken(it.memberId, "email", Date.now(), { nonce, expS: issued + CLAIM_LIFETIME_S.email });
      if (!sealed) continue;
      rows.push({ nonce: sealed.nonce, member_id: it.memberId, kind: "email", expires_at: new Date(sealed.exp).toISOString(), issued_at: new Date(issued * 1000).toISOString() });
      urls.set(it.memberId, claimUrl(sealed.token));
    }
    if (!rows.length) return out;
    const { error: saveErr } = await admin.from("member_claims").upsert(rows, { onConflict: "nonce", ignoreDuplicates: true });
    if (saveErr) {
      console.error("invite claim links not recorded:", saveErr.message);
      return out;
    }
    return urls;
  } catch (e) {
    console.error("invite claim links failed:", e instanceof Error ? e.message : e);
    return out;
  }
}

export type ClaimFailure = "invalid" | "expired" | "no_email" | "used" | "has_login" | "user_linked" | "screen" | "gone" | "failed";
export type ClaimResult = { ok: true; emailSaved: boolean; memberId: string } | { ok: false; reason: ClaimFailure; error: string };

// The last step: attach this signed-in login to the account the link was
// made for. The checks and the change happen together in one database call
// (claim_member_account), so a double tap or two phones at once can't
// attach two logins.
export async function claimMemberForUser(user: User, token: string): Promise<ClaimResult> {
  const t = openClaimToken(token);
  if (!t) return { ok: false, reason: "invalid", error: STATE_ERROR.invalid };
  if (t.expired) return { ok: false, reason: "expired", error: STATE_ERROR.expired };
  // Every later sign-in needs an address (see linkMemberForUser).
  if (!user.email) {
    return { ok: false, reason: "no_email", error: "Your sign-in didn't include an email address. Use Continue with Google, or make a login with your email." };
  }

  const { data, error } = await createAdminClient().rpc("claim_member_account", {
    p_nonce: t.nonce,
    p_member: t.memberId,
    p_user: user.id,
    // Only an address the login has proved it owns goes on the account.
    p_email: emailIsProven(user) ? user.email : null,
  });
  if (error) return { ok: false, reason: "failed", error: "Something went wrong on our end, so nothing was changed. Try again in a minute." };
  // Just attached (not a repeat): an imported member's one-time bonus.
  if (data === "linked" || data === "linked_email") await awardClaimBonus(t.memberId);

  switch (data as string) {
    case "linked":
      return { ok: true, emailSaved: false, memberId: t.memberId };
    case "linked_email":
      return { ok: true, emailSaved: true, memberId: t.memberId };
    case "mine": // already done: a double tap or a reload
      return { ok: true, emailSaved: false, memberId: t.memberId };
    case "used":
      return { ok: false, reason: "used", error: STATE_ERROR.used };
    case "has_login":
      return { ok: false, reason: "has_login", error: STATE_ERROR.has_login };
    case "expired":
      return { ok: false, reason: "expired", error: STATE_ERROR.expired };
    case "gone":
      return { ok: false, reason: "gone", error: STATE_ERROR.gone };
    case "no_claim":
      return { ok: false, reason: "invalid", error: STATE_ERROR.invalid };
    case "screen":
      return { ok: false, reason: "screen", error: "This device is signed in with one of Royale Cinema's screen logins. Open the link on your own phone instead." };
    case "user_linked":
      return {
        ok: false,
        reason: "user_linked",
        error: `The login you're using${user.email ? ` (${user.email})` : ""} already has its own Royale Cinema account. Use a different login for this one, or ask us at the box office to put the two together.`,
      };
    default:
      return { ok: false, reason: "failed", error: "Something went wrong on our end, so nothing was changed. Try again in a minute." };
  }
}
