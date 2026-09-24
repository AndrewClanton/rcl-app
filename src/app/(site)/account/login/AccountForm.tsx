"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, createImplicitFlowClient } from "@/lib/supabase/client";
import { linkMemberAccount } from "../actions";

type Mode = "signin" | "signup";

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

export default function AccountForm({
  providers = { google: false, facebook: false },
  initialError = null,
}: {
  providers?: { google: boolean; facebook: boolean };
  initialError?: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [oauthBusy, setOauthBusy] = useState<Provider | null>(null);

  async function handleOAuth(provider: Provider) {
    setOauthBusy(provider);
    setError(null);
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
  const [resetSent, setResetSent] = useState(false);

  const canSubmit = email.includes("@") && password.length >= 6 && (mode === "signin" || name.trim().length > 0);

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
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
        setSubmitting(false);
        return;
      }
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

    router.push("/account");
    router.refresh();
  }

  async function handleForgotPassword() {
    if (!email.includes("@")) {
      setError("Enter your email above first, then click \"Forgot password\".");
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createImplicitFlowClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/account/reset-password`,
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setResetSent(true);
  }

  if (resetSent) {
    return (
      <div className="notice notice-success">
        <h2 className="text-lg font-semibold">Check your email</h2>
        <p className="mt-2 text-sm opacity-90">We sent a password reset link to {email}.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      {(providers.google || providers.facebook) && (
        <>
          <div className="space-y-2.5">
            {providers.google && (
              <button
                type="button"
                onClick={() => handleOAuth("google")}
                disabled={!!oauthBusy}
                className="flex w-full items-center justify-center gap-3 rounded-lg border border-[#747775] bg-white px-4 py-2.5 text-sm font-medium text-[#1f1f1f] transition-colors hover:bg-[#f7f8f8] disabled:opacity-60"
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
                className="flex w-full items-center justify-center gap-3 rounded-lg bg-[#1877F2] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#166fe5] disabled:opacity-60"
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
          className={`chip ${mode === "signin" ? "chip-selected" : ""}`}
          onClick={() => {
            setMode("signin");
            setError(null);
          }}
        >
          Sign in
        </button>
        <button
          type="button"
          className={`chip ${mode === "signup" ? "chip-selected" : ""}`}
          onClick={() => {
            setMode("signup");
            setError(null);
          }}
        >
          Create account
        </button>
      </div>

      {mode === "signup" && (
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
        {submitting ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account — it's free"}
      </button>

      {mode === "signin" && (
        <button type="button" className="mt-3 text-xs text-[var(--muted)] hover:text-[var(--accent)]" onClick={handleForgotPassword}>
          Forgot password?
        </button>
      )}
    </form>
  );
}
