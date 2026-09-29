import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { getSignInProviders } from "@/lib/auth-providers";
import { safePath } from "@/lib/safe-path";
import { pendingClaimFor } from "@/lib/member-claim-token";
import { isClaimPath } from "@/lib/claim-link";
import { PageMasthead } from "@/components/print";
import AccountForm from "./AccountForm";

const ERRORS: Record<string, string> = {
  oauth_cancelled: "Sign-in was cancelled. Try again, or use your email.",
  oauth_failed: "That sign-in didn't finish. Try again, or use your email.",
  no_email: "Facebook didn't share an email address with us, and your account needs one. Try Google, or sign up with your email.",
  link_failed: "We couldn't connect that sign-in to your membership. Sign in with your email and password, or ask us at the box office.",
};

export default async function AccountLoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next: nextParam } = await searchParams;
  // Where to go once signed in, e.g. straight on to Insiders+ payment.
  const next = safePath(nextParam);
  const providers = await getSignInProviders();
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
    if (member) redirect(next ?? "/account");
    // A login made from a "claim your account" link that hasn't finished
    // yet goes back to that link, which attaches it to their account.
    const claim = await pendingClaimFor(user);
    if (claim) redirect(claim);
  }

  // On the way back to a "claim your account" link: the login gets attached
  // to that account there, not matched by email or made a new one here.
  const claimToken = next && isClaimPath(next) ? new URLSearchParams(next.split("?")[1] ?? "").get("t") : null;

  return (
    <div className="mx-auto max-w-md">
      <PageMasthead eyebrow="My account" title="Sign in" className="!mb-6" />
      <p className="text-[15px] text-[var(--muted)]">
        {claimToken
          ? "Last step: sign in, or make a new login, and we'll attach it to your Royale account."
          : "Sign in to check your points, purchase history, and membership. New here? Creating an account is free and joins you as a Royale Insider."}
      </p>
      <div className="mt-8">
        <AccountForm providers={providers} initialError={error ? (ERRORS[error] ?? null) : null} next={next} claimToken={claimToken} />
      </div>
    </div>
  );
}
