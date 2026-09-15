"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, createImplicitFlowClient } from "@/lib/supabase/client";
import { linkMemberAccount } from "../actions";

type Mode = "signin" | "signup";

export default function AccountForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
