import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Member } from "@/lib/types";

// The signed-in member, or null. A Supabase Auth session alone isn't a
// member -- it has to be linked to a `members` row via auth_user_id (see
// linkMemberForUser, run after every sign-in). Cached per request, so the
// account layout and page share one lookup.
export const getSignedInMember = cache(async (): Promise<Member | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: member } = await createAdminClient().from("members").select("*").eq("auth_user_id", user.id).maybeSingle();
  return (member as Member) ?? null;
});

// Gates /account/*. No session, or a session that isn't linked to a member
// yet, goes back through sign-in (which re-establishes the link).
export async function requireMember(): Promise<Member> {
  const member = await getSignedInMember();
  if (!member) redirect("/account/login");
  return member;
}
