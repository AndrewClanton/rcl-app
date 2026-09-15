"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { linkMemberAccount } from "../actions";

// Landing point for the "reset your password" email link. Supabase's
// recovery link may arrive as a PKCE ?code= or an implicit #access_token=
// hash fragment depending on project config -- handle both the same way
// the old magic-link callback did, since hashes never reach the server.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const hashError = hashParams.get("error_description");

      if (hashError) {
        setError(hashError.replace(/\+/g, " "));
        return;
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (error) {
          setError(error.message);
          return;
        }
      } else if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error) {
          setError(error.message);
          return;
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setError("This password reset link is invalid or has expired. Please request a new one.");
        return;
      }
      setReady(true);
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setSubmitting(false);
      return;
    }

    // The auth user resetting a password here might never have completed
    // "Create account" (e.g. an old magic-link signup that never got
    // linked) -- ensure a members row is linked before sending them to a
    // page that requires one. Idempotent: a no-op if already linked.
    const result = await linkMemberAccount();
    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    router.push("/account");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-sm">
      <div className="eyebrow mb-2">My account</div>
      <h1 className="font-display text-3xl font-semibold">Reset password</h1>

      {!ready && !error && <p className="mt-4 text-sm text-[var(--muted)]">Checking your link...</p>}

      {error && (
        <div className="notice notice-warn mt-4">
          <p>{error}</p>
        </div>
      )}

      {ready && (
        <form onSubmit={handleSubmit} className="card mt-6">
          <label className="mb-3 block">
            <div className="label-xs">New password</div>
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="block">
            <div className="label-xs">Confirm password</div>
            <input
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              className="input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <button className="btn-primary mt-4 w-full" disabled={submitting}>
            {submitting ? "Saving..." : "Set new password"}
          </button>
        </form>
      )}
    </div>
  );
}
