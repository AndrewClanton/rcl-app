"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkClaimDigits, claimMemberForUser, type ClaimFailure } from "@/lib/member-claim";
import { DIGITS_PROOF_COOKIE } from "@/lib/member-claim-token";
import { CLAIM_PATH } from "@/lib/claim-link";
import { allowAttempt } from "@/lib/rate-limit";

// The claim page's steps (lib/member-claim.ts has the rules). Public: the
// link and the phone digits are the proof, and both are checked again on
// every call.

// Who's asking, for the per-connection limit on digit guesses.
async function connection(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function proofCookie(value: string, maxAge: number) {
  // Only sent to the claim page, never readable by scripts.
  return { name: DIGITS_PROOF_COOKIE, value, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: CLAIM_PATH, maxAge };
}

export type DigitsAnswer = { ok: true } | { ok: false; error: string; reload?: boolean };

// Step one: the last four digits of the phone on the account. A match
// leaves a short-lived "digits matched" note in a cookie, so signing in
// with Google (a trip away and back) doesn't mean typing them again.
export async function submitClaimDigits(token: string, digits: string): Promise<DigitsAnswer> {
  const r = await checkClaimDigits(String(token ?? ""), String(digits ?? ""), await connection());
  if (!r.ok) return r;
  (await cookies()).set(proofCookie(r.proof, r.maxAge));
  return { ok: true };
}

export type FinishAnswer = { ok: true } | { ok: false; reason: ClaimFailure | "signed_out"; error: string };

// The last step: attach the signed-in login to the account.
export async function finishClaim(token: string): Promise<FinishAnswer> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "signed_out", error: "You're not signed in anymore. Sign in again to finish." };
  if (!(await allowAttempt(`claim-finish:${user.id}`, 10, 600))) {
    return { ok: false, reason: "failed", error: "Too many tries just now. Wait a few minutes and try again." };
  }
  const store = await cookies();
  const r = await claimMemberForUser(user, String(token ?? ""), store.get(DIGITS_PROOF_COOKIE)?.value);
  if (!r.ok) return r;
  store.set(proofCookie("", 0));
  revalidatePath("/", "layout");
  return { ok: true };
}

// "Use a different login": signs this browser out, so the page offers the
// sign-in choices again.
export async function signOutForClaim(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
