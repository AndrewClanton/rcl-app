import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSignInProviders } from "@/lib/auth-providers";
import { describeLogin, readClaim, type ClaimState } from "@/lib/member-claim";
import { DIGITS_PROOF_COOKIE, digitsProofOk } from "@/lib/member-claim-token";
import { CLAIM_PATH } from "@/lib/claim-link";
import { PageMasthead } from "@/components/print";
import AccountForm from "../login/AccountForm";
import { DigitsForm, FinishClaim, UseAnotherLogin } from "./ClaimSteps";

// "Claim your account": where the QR code on the check-in tablet or a
// receipt lands (lib/member-claim.ts). Someone with a Royale account but no
// website login (made at the tablet, or from the old site) proves it's
// theirs with the last four digits of its phone, signs in or makes a login,
// and that login is attached to the account.
//
// Private: the link is personal, and says whose account it is.
export const metadata: Metadata = { title: "Claim your account", robots: { index: false, follow: false } };

// Why a Google or Facebook trip didn't finish (/account/callback sends
// people back here when they started from a claim link).
const SIGN_IN_ERRORS: Record<string, string> = {
  oauth_cancelled: "Sign-in was cancelled. Try again, or use your email and a password.",
  oauth_failed: "That sign-in didn't finish. Try again, or use your email and a password.",
};

// A login that signed in a moment ago signed in for this: attach it
// without asking again.
const JUST_SIGNED_IN_MS = 10 * 60_000;

function justSignedIn(at: string | null | undefined): boolean {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) && Date.now() - t < JUST_SIGNED_IN_MS;
}

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function ClaimPage({ searchParams }: { searchParams: Promise<{ t?: string | string[]; error?: string | string[] }> }) {
  const params = await searchParams;
  const token = one(params.t);
  const signInError = SIGN_IN_ERRORS[one(params.error)] ?? null;

  const supabase = await createClient();
  const [claim, { data: auth }] = await Promise.all([readClaim(token), supabase.auth.getUser()]);
  const user = auth.user;

  if (claim.state !== "ready") {
    // Whoever just claimed it (a reload, or the back button): they're done.
    if (claim.state === "has_login" && user?.id === claim.authUserId) redirect("/account");
    return <Stopped claim={claim} signedIn={!!user} />;
  }

  const proofOk = digitsProofOk((await cookies()).get(DIGITS_PROOF_COOKIE)?.value, claim.nonce);

  // Step one: the phone digits.
  if (!proofOk) {
    return (
      <Shell eyebrow="Claim your account" title={`Hi, ${claim.firstName}!`}>
        <p className="text-[15px] text-[var(--muted)]">
          Put your Royale account on your phone: your points, visits and purchases, any time. First, a quick check that it&apos;s
          you.
        </p>
        {signInError && <p className="notice notice-warn mt-4 text-sm">{signInError}</p>}
        <div className="mt-6">
          <DigitsForm token={token} />
        </div>
      </Shell>
    );
  }

  // Step two: sign in, or make a login.
  if (!user) {
    const providers = await getSignInProviders();
    return (
      <Shell eyebrow="Claim your account" title={`Thanks, ${claim.firstName}.`}>
        <p className="text-[15px] text-[var(--muted)]">
          Now choose how you&apos;ll sign in from now on: Google, or your email and a password.
        </p>
        <div className="mt-6">
          <AccountForm providers={providers} initialError={signInError} next={`${CLAIM_PATH}?t=${token}`} claimToken={token} />
        </div>
      </Shell>
    );
  }

  // Step three: attach this login.
  const login = await describeLogin(user);
  if (login.screen) {
    return (
      <Shell eyebrow="Claim your account" title="Use your own phone">
        <p className="notice notice-warn text-sm">
          This device is signed in with one of the Royale&apos;s screen logins. Scan the code with your own phone instead.
        </p>
      </Shell>
    );
  }
  if (login.linkedElsewhere) {
    return (
      <Shell eyebrow="Claim your account" title="Use a different login">
        <p className="notice notice-warn text-sm">
          You&apos;re signed in as <strong className="break-all">{login.email ?? "a login"}</strong>, and that login already has its
          own Royale account. Use a different login for {claim.firstName}&apos;s account, or ask us at the box office to put the two
          accounts together.
        </p>
        <div className="mt-6">
          <UseAnotherLogin className="btn-primary w-full" />
        </div>
      </Shell>
    );
  }
  const fresh = justSignedIn(user.last_sign_in_at);
  return (
    <Shell eyebrow="Claim your account" title="One last step">
      <p className="text-[15px] text-[var(--muted)]">
        We&apos;ll attach this login to {claim.firstName}&apos;s Royale account, and it&apos;s how you&apos;ll sign in from now on.
      </p>
      {login.staff && (
        <p className="notice notice-warn mt-4 text-sm">
          This is a staff login. Only link it if this Royale account is your own; otherwise use a different login.
        </p>
      )}
      <div className="mt-6">
        <FinishClaim token={token} email={login.email} auto={fresh && !login.staff} />
      </div>
    </Shell>
  );
}

function Shell({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md">
      <PageMasthead eyebrow={eyebrow} title={title} className="!mb-6" />
      {children}
    </div>
  );
}

// Every way a link can stop working, in plain words, and what to do next.
function Stopped({ claim, signedIn }: { claim: Exclude<ClaimState, { state: "ready" }>; signedIn: boolean }) {
  const signIn = (
    <Link href="/account/login" className="btn-primary mt-6 block w-full text-center">
      Sign in
    </Link>
  );
  switch (claim.state) {
    case "invalid":
      return (
        <Shell eyebrow="Claim your account" title="This link doesn't work">
          <p className="text-[15px]">
            It may have been cut off, or mistyped. Try scanning the code again. If it still won&apos;t open, ask us at the box office
            and we&apos;ll help you set up your login.
          </p>
        </Shell>
      );
    case "unavailable":
      return (
        <Shell eyebrow="Claim your account" title="One moment">
          <p className="text-[15px]">We couldn&apos;t check this link just now. Give it a minute, then try again.</p>
        </Shell>
      );
    case "gone":
      return (
        <Shell eyebrow="Claim your account" title="This link doesn't work anymore">
          <p className="text-[15px]">
            The account it was made for can&apos;t be set up online. Ask us at the box office and we&apos;ll help you set up your
            login.
          </p>
        </Shell>
      );
    case "expired":
      return (
        <Shell eyebrow="Claim your account" title="This link has run out">
          <p className="text-[15px]">
            {claim.kind === "kiosk"
              ? "Codes on the check-in screen are good for 30 minutes. You'll get a fresh one on your next receipt, or ask us at the box office."
              : "Codes on receipts are good for two weeks. Your next receipt will have a fresh one, or ask us at the box office."}
          </p>
        </Shell>
      );
    case "used":
      return (
        <Shell eyebrow="Claim your account" title="This link was already used">
          <p className="text-[15px]">If that was you, you&apos;re all set: just sign in to see your points.</p>
          {signIn}
        </Shell>
      );
    case "locked":
      return (
        <Shell eyebrow="Claim your account" title="This link is locked">
          <p className="text-[15px]">
            There were too many wrong tries at the phone number, so this link has stopped working to keep the account safe. Ask us at
            the box office and we&apos;ll help you set up your login.
          </p>
        </Shell>
      );
    case "has_login":
      return (
        <Shell eyebrow="Claim your account" title="This account already has a login">
          <p className="text-[15px]">
            {signedIn
              ? "It isn't the login you're using now. Sign in with the one on the account to see your points."
              : "Sign in with it to see your points, visits and purchases."}
          </p>
          {signedIn ? (
            <div className="mt-6">
              <UseAnotherLogin className="btn-primary w-full" />
            </div>
          ) : (
            signIn
          )}
        </Shell>
      );
  }
}
