import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { isGoogleSignInEnabled } from "@/lib/auth-providers";
import AccountForm from "./AccountForm";

const ERRORS: Record<string, string> = {
  google_cancelled: "Google sign-in was cancelled. Try again, or use your email.",
  google_failed: "Google sign-in didn't finish. Try again, or use your email.",
  link_failed: "We couldn't connect that Google account to your membership. Sign in with your email and password, or ask us at the box office.",
};

export default async function AccountLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const googleEnabled = await isGoogleSignInEnabled();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Only redirect once the member row is actually linked -- redirecting on
  // a bare session would ping-pong against requireMember()'s own redirect
  // back here for a session that's authenticated but not yet (or no
  // longer) linked.
  if (user) {
    const { data: member } = await createAdminClient().from("members").select("id").eq("auth_user_id", user.id).maybeSingle();
    if (member) redirect("/account");
  }

  return (
    <div className="mx-auto max-w-sm">
      <div className="eyebrow mb-2">My account</div>
      <h1 className="font-display text-3xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Sign in to check your points, purchase history, and membership. New here? Creating an account is free and joins you as a
        Royale Insider.
      </p>
      <div className="mt-6">
        <AccountForm googleEnabled={googleEnabled} initialError={error ? (ERRORS[error] ?? null) : null} />
      </div>
    </div>
  );
}
