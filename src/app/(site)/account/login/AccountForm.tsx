"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createClient, createImplicitFlowClient } from "@/lib/supabase/client";
import { plainResetError } from "@/lib/auth-email-errors";
import { inAppBrowserName, openInChromeHref } from "@/lib/in-app-browser";
import { linkMemberAccount } from "../actions";
import { askSignInHelp } from "./actions";

type Mode = "signin" | "signup";

// One link for anyone who can't get in: a forgotten password, or a member
// (from the old site, or the check-in tablet) who never made a login.
const HELP_LABEL = "Forgot password or first time here?";

type HelpOutcome = "reset" | "setup" | "ask_at_bar" | "generic";

// Google's own "G" mark, as their sign-in button guidelines ask for.
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

// Facebook's "f" mark, as Meta's login button guidelines ask for.
function FacebookMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#fff"
        d="M24 12.07C24 5.41 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.5h-2.8V24C19.62 23.1 24 18.1 24 12.07"
      />
    </svg>
  );
}

type Provider = "google" | "facebook";

const AFTER_SIGN_IN_COOKIE = "rcl_after_sign_in";

const noSubscribe = () => () => {};

// Stands in for "Continue with Google" inside Facebook's (or another app's)
// built-in browser, where Google won't sign anyone in.
function GoogleInAppNote({ app }: { app: string }) {
  const [copied, setCopied] = useState(false);
  const chromeHref = useSyncExternalStore(
    noSubscribe,
    () => openInChromeHref(window.location.href, navigator.userAgent),
    () => null,
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-4 text-sm" role="note">
      <p className="font-semibold">
        <GoogleMark /> <span className="align-[3px]">Signing in with Google?</span>
      </p>
      <p className="mt-1.5 text-[var(--muted)]">
        Google doesn&apos;t allow it inside {app === "this app" ? "an app's" : `${app}'s`} built-in browser. Tap the ••• menu and choose
        &ldquo;Open in browser&rdquo;, then sign in from there. Signing in with your email works right here.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {chromeHref && (
          <a href={chromeHref} className="btn-secondary min-h-11">
            Open in Chrome
          </a>
        )}
        <button type="button" onClick={copy} className="btn-secondary min-h-11">
          {copied ? "Link copied" : "Copy this page's link"}
        </button>
      </div>
    </div>
  );
}

// claimToken: signing in from a "claim your account" link (/account/claim,
// lib/member-claim.ts). `next` is then that link. The login isn't matched
// to an account by email here: the claim page attaches it to the account
// the link was made for. The account already has a name, so none is asked.
export default function AccountForm({
  providers = { google: false, facebook: false },
  initialError = null,
  next = null,
  claimToken = null,
}: {
  providers?: { google: boolean; facebook: boolean };
  initialError?: string | null;
  next?: string | null;
  claimToken?: string | null;
}) {
  const router = useRouter();
  const claiming = !!claimToken && !!next;
  // Most people claiming an account have no login yet.
  const [mode, setMode] = useState<Mode>(claiming ? "signup" : "signin");
  const [confirmSent, setConfirmSent] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [oauthBusy, setOauthBusy] = useState<Provider | null>(null);
  // Only known in the browser; the server render shows the Google button.
  const inApp = useSyncExternalStore(noSubscribe, () => inAppBrowserName(navigator.userAgent), () => null);

  async function handleOAuth(provider: Provider) {
    setOauthBusy(provider);
    setError(null);
    // Where to land afterwards rides in a short-lived cookie, so the
    // return address Google/Facebook are allowed to use never changes.
    document.cookie = `${AFTER_SIGN_IN_COOKIE}=${next ? encodeURIComponent(next) : ""}; path=/; max-age=${next ? 900 : 0}; samesite=lax`;
    const { error } = await createClient().auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/account/callback?next=/account`,
        ...(provider === "google" ? { queryParams: { prompt: "select_account" } } : { scopes: "email" }),
      },
    });
    if (error) {
      setError(`${provider === "google" ? "Google" : "Facebook"} sign-in isn't available right now. Use your email and password instead.`);
      setOauthBusy(null);
    }
  }
  const [help, setHelp] = useState<{ outcome: HelpOutcome; gmail: boolean } | null>(null);

  const canSubmit = email.includes("@") && password.length >= 6 && (mode === "signin" || claiming || name.trim().length > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const supabase = createClient();

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setSubmitting(false);
        return;
      }
    } else {
      // A new login from a claim link carries the link, so if Supabase
      // asks them to confirm their email first, that confirmation doesn't
      // make them a second, empty account (see pendingClaimFor).
      const { data, error } = await supabase.auth.signUp({ email, password, ...(claiming ? { options: { data: { rcl_claim: claimToken } } } : {}) });
      if (error) {
        setError(error.message);
        setSubmitting(false);
        return;
      }
      if (claiming && !data.session) {
        setConfirmSent(true);
        setSubmitting(false);
        return;
      }
    }

    // The claim page attaches this login to their account.
    if (claiming && next) {
      window.location.assign(next);
      return;
    }

    // Not just the signup path -- an auth user can exist without a linked
    // members row (e.g. they reset a password before ever completing
    // "Create account", or an earlier bug left them unlinked), so ensure
    // the link exists after every successful sign-in too. Idempotent: a
    // no-op if already linked.
    const result = await linkMemberAccount(name);
    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    // A full page load for `next`: it can be the Insiders+ link, which
    // hands off to Stripe and can't be opened by client-side navigation.
    if (next) {
      window.location.assign(next);
      return;
    }
    router.push("/account");
    router.refresh();
  }

  // Asks the server what fits this email (lib/sign-in-help.ts): a setup
  // link it emails itself, a word to see us at the bar, or a password
  // reset, which is sent from here exactly as it always was (Supabase only
  // sends it if a login has that address).
  async function handleSignInHelp() {
    if (!email.includes("@")) {
      setError(`Enter your email above first, then tap “${HELP_LABEL}”`);
      return;
    }
    setSubmitting(true);
    setError(null);
    setHelp(null);
    const r = await askSignInHelp(email).catch(() => null);
    if (!r || !r.ok) {
      setSubmitting(false);
      setError(r ? r.error : "Couldn't reach us just now. Try again in a minute.");
      return;
    }
    if (r.outcome === "reset" || r.outcome === "generic") {
      const { error } = await createImplicitFlowClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/account/reset-password`,
      });
      if (error) {
        setSubmitting(false);
        setError(plainResetError(error));
        return;
      }
    }
    setSubmitting(false);
    // Continue with Google finds a Gmail address's account on its own.
    setHelp({ outcome: r.outcome, gmail: providers.google && /@(gmail|googlemail)\.com$/i.test(email.trim()) });
  }

  const gmailHint = help?.gmail ? " Or just use Continue with Google." : "";

  if (confirmSent) {
    return (
      <div className="notice notice-success">
        <h2 className="text-lg font-semibold">Check your email</h2>
        <p className="mt-2 text-sm opacity-90">
          We sent a link to {email}. Open it to confirm your address, then come back to this page to finish.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="sheet crop p-5 sm:p-6">
      {help && (
        <div className="notice notice-success mb-5" role="status">
          <h2 className="text-lg font-semibold">{help.outcome === "ask_at_bar" ? "You're almost in" : "Check your email"}</h2>
          <p className="mt-2 text-sm opacity-90">
            {help.outcome === "reset"
              ? "We emailed you a link to reset your password."
              : help.outcome === "setup"
                ? `We emailed you a link to finish setting up your account. Your points are waiting.${gmailHint}`
                : help.outcome === "ask_at_bar"
                  ? `You don't have a website login yet, but your account and points are waiting. Ask us at the bar and we'll get you set up.${gmailHint}`
                  : "If that email has an account, we've sent you a link."}
          </p>
        </div>
      )}
      {(providers.google || providers.facebook) && (
        <>
          <div className="space-y-2.5">
            {providers.google && inApp && <GoogleInAppNote app={inApp} />}
            {providers.google && !inApp && (
              <button
                type="button"
                onClick={() => handleOAuth("google")}
                disabled={!!oauthBusy}
                className="flex min-h-11 w-full items-center justify-center gap-3 rounded-lg border border-[#747775] bg-white px-4 py-2.5 text-sm font-medium text-[#1f1f1f] transition-colors hover:bg-[#f7f8f8] disabled:opacity-60"
              >
                <GoogleMark />
                {oauthBusy === "google" ? "Opening Google…" : "Continue with Google"}
              </button>
            )}
            {providers.facebook && (
              <button
                type="button"
                onClick={() => handleOAuth("facebook")}
                disabled={!!oauthBusy}
                className="flex min-h-11 w-full items-center justify-center gap-3 rounded-lg bg-[#1877F2] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#166fe5] disabled:opacity-60"
              >
                <FacebookMark />
                {oauthBusy === "facebook" ? "Opening Facebook…" : "Continue with Facebook"}
              </button>
            )}
          </div>
          <div className="my-5 flex items-center gap-3 text-xs text-[var(--muted)]">
            <span className="h-px flex-1 bg-[var(--border)]" />
            or use your email
            <span className="h-px flex-1 bg-[var(--border)]" />
          </div>
        </>
      )}
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          className={`chip min-h-11 ${mode === "signin" ? "chip-selected" : ""}`}
          onClick={() => {
            setMode("signin");
            setError(null);
          }}
        >
          Sign in
        </button>
        <button
          type="button"
          className={`chip min-h-11 ${mode === "signup" ? "chip-selected" : ""}`}
          onClick={() => {
            setMode("signup");
            setError(null);
          }}
        >
          {claiming ? "New login" : "Create account"}
        </button>
      </div>

      {mode === "signup" && !claiming && (
        <label className="mb-3 block">
          <div className="label-xs">Name</div>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      )}
      <label className="mb-3 block">
        <div className="label-xs">Email</div>
        <input type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="block">
        <div className="label-xs">Password</div>
        <input
          type="password"
          required
          minLength={6}
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
        />
      </label>

      {error && <div className="mt-3 text-sm text-[var(--danger-text)]">{error}</div>}

      <button className="btn-primary mt-4 w-full" disabled={!canSubmit || submitting}>
        {submitting ? "Please wait..." : mode === "signin" ? "Sign in" : claiming ? "Create my login" : "Create account — it's free"}
      </button>

      {mode === "signin" && (
        <button type="button" className="mt-1 min-h-11 text-xs text-[var(--muted)] hover:text-[var(--accent)] disabled:opacity-60" disabled={submitting} onClick={handleSignInHelp}>
          {HELP_LABEL}
        </button>
      )}
    </form>
  );
}
