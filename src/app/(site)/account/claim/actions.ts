"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { claimMemberForUser, type ClaimFailure } from "@/lib/member-claim";
import { allowAttempt } from "@/lib/rate-limit";
import { recordConsentSource } from "@/lib/email/consent";
import { memberJoined } from "@/lib/email/automations";

// The claim page's steps (lib/member-claim.ts has the rules). Public: the
// link is the proof, and it's checked again on every call.

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
  const r = await claimMemberForUser(user, String(token ?? ""));
  if (!r.ok) return r;
  // Claiming is a yes to hearing from us in their own words: recorded as
  // the consent source (their email setting itself isn't changed), and the
  // welcome email follows if email is on.
  await recordConsentSource(r.memberId, "claim").catch(() => null);
  memberJoined(r.memberId);
  revalidatePath("/", "layout");
  return { ok: true };
}

// "Use a different login": signs this browser out, so the page offers the
// sign-in choices again.
export async function signOutForClaim(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
