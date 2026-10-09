"use server";

import { allowAttempt } from "@/lib/rate-limit";
import { resubscribe } from "@/lib/email/consent";
import { openEmailToken } from "@/lib/email/tokens";
import { unsubscribeByToken } from "@/lib/email/unsubscribe";
import { currentMemberId } from "@/lib/member-forward";

// The unsubscribe page's two buttons, from an email link's signed token
// (no sign-in). Errors come back as values (production hides a thrown
// action's message).

export type UnsubAnswer = { ok: true } | { ok: false; error: string };

const BAD_LINK = "This link doesn't work anymore. Reply to any of our emails and we'll take you off by hand.";

export async function unsubscribeWithToken(token: string): Promise<UnsubAnswer> {
  const t = openEmailToken(token);
  if (!t) return { ok: false, error: BAD_LINK };
  if (!(await allowAttempt(`email-prefs:${t.memberId}`, 40, 60))) return { ok: false, error: "Too many tries at once. Try again in a minute." };
  try {
    return (await unsubscribeByToken(token, { via: "email_link" })) ? { ok: true } : { ok: false, error: BAD_LINK };
  } catch {
    return { ok: false, error: "Something went wrong on our end. Please try again." };
  }
}

export async function resubscribeWithToken(token: string): Promise<UnsubAnswer> {
  const t = openEmailToken(token);
  if (!t) return { ok: false, error: BAD_LINK };
  // A link from before the account was merged into another: the account it became.
  const memberId = (await currentMemberId(t.memberId)) ?? t.memberId;
  if (!(await allowAttempt(`email-prefs:${memberId}`, 40, 60))) return { ok: false, error: "Too many tries at once. Try again in a minute." };
  const r = await resubscribe(memberId, "prefs_page");
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
