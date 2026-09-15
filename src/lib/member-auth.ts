import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Member } from "@/lib/types";

// Gates /account/*. A logged-in Supabase Auth session alone isn't a member
// -- it must be linked to a `members` row via auth_user_id, which happens
// automatically the first time someone completes the magic-link flow (see
// /account/callback): claims an existing member row by matching email, or
// creates a fresh free-Insiders row if this is a brand new customer.
export async function requireMember(): Promise<Member> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/account/login");
  }

  const admin = createAdminClient();
  const { data: member } = await admin.from("members").select("*").eq("auth_user_id", user.id).maybeSingle();

  if (!member) {
    // Session exists but the callback linking step hasn't run (e.g. an
    // old session from before this account system existed). Send back
    // through login to re-establish the link.
    redirect("/account/login");
  }

  return member;
}
