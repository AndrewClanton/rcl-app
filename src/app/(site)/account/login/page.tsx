import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import MagicLinkForm from "./MagicLinkForm";

export default async function AccountLoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Only redirect once the member row is actually linked (normally done by
  // /account/callback right after sign-in) -- redirecting on a bare session
  // would ping-pong against requireMember()'s own redirect back here for a
  // session that's authenticated but not yet (or no longer) linked.
  if (user) {
    const { data: member } = await createAdminClient().from("members").select("id").eq("auth_user_id", user.id).maybeSingle();
    if (member) redirect("/account");
  }

  return (
    <div className="mx-auto max-w-sm">
      <div className="eyebrow mb-2">My account</div>
      <h1 className="font-display text-3xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Enter your email and we&apos;ll send you a link to sign in — no password needed. New here? This creates your free Insiders
        account too.
      </p>
      <div className="mt-6">
        <MagicLinkForm />
      </div>
    </div>
  );
}
