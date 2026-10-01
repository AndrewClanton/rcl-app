import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailIsProven } from "@/lib/member-link";
import { firstNameOf, last10 } from "@/lib/checkin";
import { allowAttempt } from "@/lib/rate-limit";
import { claimUrl } from "@/lib/claim-link";
import { CLAIM_LIFETIME_S, MAX_WRONG_DIGITS, digitsProofOk, emailClaimNonce, openClaimToken, sealClaimToken, sealDigitsProof, type ClaimKind } from "@/lib/member-claim-token";

// "Claim your account": lets someone who has a members row but no website
// login (imported from the old site, or a regular made at the check-in
// tablet with just a phone and first name) set one up and see their points,
// visits and purchases online.
//
// The register hands them a link: a QR code on the tablet after they check
// in (good for 30 minutes), or on their receipt (good for two weeks). The
// link names the account, but opening it isn't enough on its own -- they
// also type the last four digits of the phone on that account. Then they
// sign in (Google, or email and password) and that login is attached to the
// account. Each link works once.
//
// Unlike ordinary sign-in (lib/member-link.ts), this doesn't need the email
// to match: the link plus the phone digits are the proof. Their email is
// only saved on the account if it had none and the login proved it owns
// the address; otherwise the account keeps the email it has.

export type { ClaimKind } from "@/lib/member-claim-token";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A phone this short can't be checked by its last four.
function phoneLast4(phone: string | null | undefined): string | null {
  const d = last10(phone);
  return d.length >= 7 ? d.slice(-4) : null;
}

// Whether a claim link could work for this phone: the claim page asks for
// its last four digits.
export function hasCheckablePhone(phone: string | null | undefined): boolean {
  return !!phoneLast4(phone);
}

// A fresh link for this member, or null if there's nothing to claim: they
// already have a login, their info was removed, there's no phone on file to
// check against, or the link couldn't be recorded (for instance before the
// member_claims migration is applied -- the receipt then just prints
// without it, and the tablet shows its plain welcome). Never throws.
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
    const { data: m, error } = await admin.from("members").select("id, auth_user_id, erased_at, phone").eq("id", memberId).maybeSingle();
    if (error || !m || m.auth_user_id || m.erased_at || !phoneLast4(m.phone)) return null;
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
  | { state: "gone" } // the account was removed, or has no phone to check
  | { state: "expired"; kind: ClaimKind }
  | { state: "used" }
  | { state: "locked" } // too many wrong phone digits
  | { state: "has_login"; authUserId: string }
  | { state: "ready"; memberId: string; nonce: string; kind: ClaimKind; exp: number; firstName: string };

type Found = Exclude<ClaimState, { state: "ready" }> | (Extract<ClaimState, { state: "ready" }> & { last4: string; wrongTries: number });

async function lookUp(token: string | null | undefined): Promise<Found> {
  const t = openClaimToken(token);
  if (!t) return { state: "invalid" };
  const admin = createAdminClient();
  const [claimRes, memberRes] = await Promise.all([
    admin.from("member_claims").select("member_id, used_at, failed_tries").eq("nonce", t.nonce).maybeSingle(),
    admin.from("members").select("id, name, phone, auth_user_id, erased_at").eq("id", t.memberId).maybeSingle(),
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
  if (claim.failed_tries >= MAX_WRONG_DIGITS) return { state: "locked" };
  const last4 = phoneLast4(m.phone);
  if (!last4) return { state: "gone" };
  return { state: "ready", memberId: m.id, nonce: t.nonce, kind: t.kind, exp: t.exp, firstName: firstNameOf(m.name), last4, wrongTries: claim.failed_tries };
}

export async function readClaim(token: string | null | undefined): Promise<ClaimState> {
  const found = await lookUp(token);
  if (found.state !== "ready") return found;
  const { memberId, nonce, kind, exp, firstName } = found;
  return { state: "ready", memberId, nonce, kind, exp, firstName };
}

// Short versions of the claim page's explanations, for when a link stops
// working partway through (the page shows the full ones on a reload).
const STATE_ERROR: Record<Exclude<ClaimState["state"], "ready">, string> = {
  invalid: "This link doesn't look right. Try scanning the code again, or ask us at the box office.",
  unavailable: "We couldn't check this link just now. Try again in a minute.",
  gone: "This link doesn't work anymore. Ask us at the box office and we'll help you set up your login.",
  expired: "This link has run out. Ask us at the box office for a fresh one.",
  used: "This link was already used. If that was you, just sign in.",
  locked: "This link is locked after too many tries. Ask us at the box office and we'll help you set up your login.",
  has_login: "This account already has a login. Sign in with it instead.",
};

const TOO_MANY = "Too many tries just now. Wait a few minutes and try again, or ask us at the box office.";

export type DigitsResult = { ok: true; proof: string; maxAge: number } | { ok: false; error: string; reload?: boolean };

// Step one on the claim page: the last four digits of the phone on the
// account. Limited per link and per connection (`connection` is the
// visitor's IP address), and a link locks for good after MAX_WRONG_DIGITS
// wrong answers. A match returns the signed "digits matched" note.
export async function checkClaimDigits(token: string, digits: string, connection: string): Promise<DigitsResult> {
  const d = String(digits ?? "").replace(/\D/g, "");
  if (d.length !== 4) return { ok: false, error: "Enter the last 4 digits of your phone number." };
  if (!(await allowAttempt(`claim-digits-ip:${connection}`, 20, 3600))) return { ok: false, error: TOO_MANY };
  const found = await lookUp(token);
  if (found.state !== "ready") return { ok: false, error: STATE_ERROR[found.state], reload: found.state !== "unavailable" };
  if (!(await allowAttempt(`claim-digits:${found.nonce}`, 5, 900))) return { ok: false, error: TOO_MANY };

  if (!timingSafeEqual(Buffer.from(d), Buffer.from(found.last4))) {
    const wrong = await countWrongTry(found.nonce, found.wrongTries);
    if (wrong >= MAX_WRONG_DIGITS) return { ok: false, error: STATE_ERROR.locked, reload: true };
    return { ok: false, error: "Those digits don't match the phone number on this account. Check them and try again." };
  }
  const proof = sealDigitsProof(found.nonce, found.exp);
  if (!proof) return { ok: false, error: STATE_ERROR.expired, reload: true };
  return { ok: true, proof: proof.value, maxAge: proof.maxAge };
}

// One more wrong guess on this link; returns the new count. A conditional
// update, so two guesses at once both count.
async function countWrongTry(nonce: string, seen: number): Promise<number> {
  const admin = createAdminClient();
  let n = seen;
  for (let i = 0; i < 4; i++) {
    const { data } = await admin.from("member_claims").update({ failed_tries: n + 1 }).eq("nonce", nonce).eq("failed_tries", n).select("failed_tries");
    if (data?.length) return n + 1;
    const { data: row } = await admin.from("member_claims").select("failed_tries").eq("nonce", nonce).maybeSingle();
    if (!row) return n + 1;
    n = row.failed_tries;
  }
  return n + 1;
}

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
// login, was removed, or has no phone to check gets no link (the email
// then points them at sign-in instead). Never throws.
export async function issueEmailClaimLinks(items: { memberId: string; sendId: string; queuedAt: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const ids = items.map((i) => i.memberId).filter((id) => UUID.test(id));
    if (!ids.length) return out;
    const admin = createAdminClient();
    const { data: members, error } = await admin.from("members").select("id, auth_user_id, erased_at, phone").in("id", ids);
    if (error) return out;
    const ok = new Set((members ?? []).filter((m) => !m.auth_user_id && !m.erased_at && phoneLast4(m.phone)).map((m) => m.id as string));
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

export type ClaimFailure = "invalid" | "expired" | "digits" | "no_email" | "used" | "has_login" | "user_linked" | "screen" | "gone" | "failed";
export type ClaimResult = { ok: true; emailSaved: boolean; memberId: string } | { ok: false; reason: ClaimFailure; error: string };

// The last step: attach this signed-in login to the account the link was
// made for. `digitsProof` is the note from checkClaimDigits. The checks and
// the change happen together in one database call (claim_member_account),
// so a double tap or two phones at once can't attach two logins.
export async function claimMemberForUser(user: User, token: string, digitsProof: string | null | undefined): Promise<ClaimResult> {
  const t = openClaimToken(token);
  if (!t) return { ok: false, reason: "invalid", error: STATE_ERROR.invalid };
  if (t.expired) return { ok: false, reason: "expired", error: STATE_ERROR.expired };
  if (!digitsProofOk(digitsProof, t.nonce)) {
    return { ok: false, reason: "digits", error: "First, enter the last 4 digits of the phone number on your account." };
  }
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
      return { ok: false, reason: "screen", error: "This device is signed in with one of the Royale's screen logins. Open the link on your own phone instead." };
    case "user_linked":
      return {
        ok: false,
        reason: "user_linked",
        error: `The login you're using${user.email ? ` (${user.email})` : ""} already has its own Royale account. Use a different login for this one, or ask us at the box office to put the two together.`,
      };
    default:
      return { ok: false, reason: "failed", error: "Something went wrong on our end, so nothing was changed. Try again in a minute." };
  }
}
