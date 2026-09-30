import "server-only";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { exactEmail } from "@/lib/email-match";
import { pendingClaimFor } from "@/lib/member-claim-token";

// Links a signed-in auth user to a `members` row: the row already linked to
// them, else an existing row with the same email (someone who joined at the
// register, bought a ticket, or came over from the old site), else a fresh
// free-Insiders row. `nameHint` is only used when creating a row -- a
// returning member keeps the name on file.
export type LinkResult = { ok: true; created: boolean } | { ok: false; error: string; reason: "no_email" | "conflict" | "unproven" | "failed" };

// Whether this sign-in proves the person owns the email address: Google or
// Facebook vouched for it, or they clicked a confirmation link we emailed.
// A plain email + password sign-up proves nothing while Supabase's "Confirm
// email" setting is off -- anyone can type someone else's address.
//
// Google or Facebook only counts for the address they gave us. With
// "Confirm email" off, someone who signed in with Google can change the
// login's email to anyone's, and it still says "google" in
// app_metadata.providers -- so that list proves nothing, and a user
// without identities (some admin lookups leave them out; fetch it with
// auth.admin.getUserById) isn't proven by Google either.
export function emailIsProven(user: User): boolean {
  const email = user.email?.toLowerCase();
  if (!email) return false;
  const vouched = (user.identities ?? []).some(
    (i) =>
      (i.provider === "google" || i.provider === "facebook") &&
      String(i.identity_data?.email ?? "").toLowerCase() === email &&
      i.identity_data?.email_verified !== false,
  );
  // confirmation_sent_at is only set when a real confirmation email went
  // out; with auto-confirm on, email_confirmed_at is stamped at sign-up.
  // email_vouched: the owner made this login for a staff member in person.
  return vouched || user.app_metadata?.email_vouched === true || !!(user.email_confirmed_at && user.confirmation_sent_at);
}

export async function linkMemberForUser(user: User, nameHint?: string | null): Promise<LinkResult> {
  // Facebook accounts made with a phone number (or where the person unticks
  // email) arrive with no address, and a member account needs one.
  if (!user.email) return { ok: false, reason: "no_email", error: "Your sign-in didn't include an email address." };
  const admin = createAdminClient();
  const { data: byAuth } = await admin.from("members").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (byAuth) return { ok: true, created: false };

  // Case-insensitive, matching the lower(email) unique index.
  const { data: byEmail } = await admin.from("members").select("id, auth_user_id").ilike("email", exactEmail(user.email)).maybeSingle();
  if (byEmail) {
    if (byEmail.auth_user_id && byEmail.auth_user_id !== user.id) {
      return { ok: false, reason: "conflict", error: "That email is already linked to a different sign-in. Try the other sign-in method, or ask us at the box office." };
    }
    // An existing member (old site, joined at the register, bought a ticket)
    // is only handed to a login that proved it owns the address -- otherwise
    // signing up with someone's email would open their account.
    if (!emailIsProven(user)) {
      return {
        ok: false,
        reason: "unproven",
        error: "There's already a Royale account under this email. To prove it's yours, use Continue with Google (for Gmail addresses), or ask us at the box office.",
      };
    }
    const { error } = await admin.from("members").update({ auth_user_id: user.id }).eq("id", byEmail.id);
    return error ? { ok: false, reason: "failed", error: "Couldn't link your account. Try again." } : { ok: true, created: false };
  }

  // Signed up from a "claim your account" link (lib/member-claim-token.ts):
  // the claim page attaches this login to the account the link was made
  // for, so don't make them a second, empty one here first.
  if (await pendingClaimFor(user)) return { ok: true, created: false };

  const meta = user.user_metadata ?? {};
  const name = (nameHint?.trim() || meta.full_name || meta.name || user.email.split("@")[0]) as string;
  const { error } = await admin.from("members").insert({ auth_user_id: user.id, name, email: user.email, tier: "Insiders", points: 0 });
  return error ? { ok: false, reason: "failed", error: "Couldn't create your account. Try again." } : { ok: true, created: true };
}

// The photo on the user's Google account, sized up, if they signed in with
// Google and it's a Google-hosted image.
export function googlePhotoUrl(user: User): string | null {
  const raw = (user.user_metadata?.avatar_url || user.user_metadata?.picture) as string | undefined;
  if (!raw || !user.identities?.some((i) => i.provider === "google")) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || !u.hostname.endsWith(".googleusercontent.com")) return null;
    return raw.replace(/=s\d+(-c)?$/, "=s512-c");
  } catch {
    return null;
  }
}
