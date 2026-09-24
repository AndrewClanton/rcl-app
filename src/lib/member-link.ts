import "server-only";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

// Links a signed-in auth user to a `members` row: the row already linked to
// them, else an existing row with the same email (someone who joined at the
// register, bought a ticket, or came over from the old site), else a fresh
// free-Insiders row. `nameHint` is only used when creating a row -- a
// returning member keeps the name on file.
export type LinkResult = { ok: true; created: boolean } | { ok: false; error: string; reason: "no_email" | "conflict" | "failed" };

export async function linkMemberForUser(user: User, nameHint?: string | null): Promise<LinkResult> {
  // Facebook accounts made with a phone number (or where the person unticks
  // email) arrive with no address, and a member account needs one.
  if (!user.email) return { ok: false, reason: "no_email", error: "Your sign-in didn't include an email address." };
  const admin = createAdminClient();
  const { data: byAuth } = await admin.from("members").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (byAuth) return { ok: true, created: false };

  // Case-insensitive, matching the lower(email) unique index.
  const { data: byEmail } = await admin.from("members").select("id, auth_user_id").ilike("email", user.email).maybeSingle();
  if (byEmail) {
    if (byEmail.auth_user_id && byEmail.auth_user_id !== user.id) {
      return { ok: false, reason: "conflict", error: "That email is already linked to a different sign-in. Try the other sign-in method, or ask us at the box office." };
    }
    const { error } = await admin.from("members").update({ auth_user_id: user.id }).eq("id", byEmail.id);
    return error ? { ok: false, reason: "failed", error: "Couldn't link your account. Try again." } : { ok: true, created: false };
  }

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
