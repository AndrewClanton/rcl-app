"use server";

import { revalidatePath } from "next/cache";
import { getSignedInMember } from "@/lib/member-auth";
import { allowAttempt } from "@/lib/rate-limit";
import { emailStateFor, justTheLineup, pauseEmail, resubscribe, resumeEmail, setMarketingOptIn, updatePrefs, type ConsentResult, type ConsentWriteSource, type EmailState } from "@/lib/email/consent";
import { openEmailToken } from "@/lib/email/tokens";
import { PREF_CATEGORIES, type PrefCategory } from "@/lib/email/types";

export type { EmailState };

// The email preference page's buttons. Public: the signed token from an
// email link (no sign-in needed) or, on /account/email, the signed-in
// member. Every action checks that itself, logs to the consent log, and
// counts as engagement. Errors come back as values (production hides a
// thrown action's message).

export type PrefsAnswer = { ok: true; state: EmailState } | { ok: false; error: string };

async function who(token: string | null): Promise<{ memberId: string; source: ConsentWriteSource } | null> {
  if (token) {
    const t = openEmailToken(token);
    return t ? { memberId: t.memberId, source: "prefs_page" } : null;
  }
  const m = await getSignedInMember();
  return m ? { memberId: m.id, source: "account" } : null;
}

async function run(token: string | null, change: (memberId: string, source: ConsentWriteSource) => Promise<ConsentResult>): Promise<PrefsAnswer> {
  const w = await who(typeof token === "string" && token ? token : null);
  if (!w) return { ok: false, error: "This link doesn't work anymore. Sign in to your account to change your emails." };
  if (!(await allowAttempt(`email-prefs:${w.memberId}`, 40, 60))) return { ok: false, error: "Too many changes at once. Try again in a minute." };
  const r = await change(w.memberId, w.source);
  if (!r.ok) return { ok: false, error: r.error };
  if (w.source === "account") revalidatePath("/account", "layout");
  return { ok: true, state: await emailStateFor(w.memberId) };
}

export async function saveEmailCategory(token: string | null, category: string, on: boolean): Promise<PrefsAnswer> {
  if (!(PREF_CATEGORIES as readonly string[]).includes(category)) return { ok: false, error: "That isn't one of the choices." };
  return run(token, (id, source) => updatePrefs(id, { [category as PrefCategory]: on === true }, source));
}

export async function chooseLineupOnly(token: string | null): Promise<PrefsAnswer> {
  return run(token, (id, source) => justTheLineup(id, source));
}

export async function pauseForMonth(token: string | null): Promise<PrefsAnswer> {
  return run(token, (id, source) => pauseEmail(id, 30, source));
}

export async function endPause(token: string | null): Promise<PrefsAnswer> {
  return run(token, (id, source) => resumeEmail(id, source));
}

export async function turnEmailsBackOn(token: string | null): Promise<PrefsAnswer> {
  return run(token, (id, source) => resubscribe(id, source));
}

export async function unsubscribeFromAll(token: string | null): Promise<PrefsAnswer> {
  return run(token, (id, source) => setMarketingOptIn(id, false, source));
}
