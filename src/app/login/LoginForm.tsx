"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    searchParams.get("error") === "not_staff" ? "That account isn't linked to an active employee record." : null
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setSubmitting(false);
      return;
    }
    // Only same-site paths -- otherwise a crafted link could send someone
    // off to another site right after they sign in.
    router.push(afterSignIn());
    router.refresh();
  }

  function afterSignIn() {
    const requested = searchParams.get("redirect") ?? "";
    const safe = requested.startsWith("/") && !requested.startsWith("//") && !requested.includes("\\");
    return safe ? requested : "/admin";
  }

  // Staff whose login email is a Google account can skip the password. The
  // callback finishes the sign-in, then the page checks they're staff.
  async function signInWithGoogle() {
    setError(null);
    setSubmitting(true);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/account/callback?next=${encodeURIComponent(afterSignIn())}`,
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setError("Couldn't start Google sign-in. Try again, or use your email and password.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card w-full max-w-sm">
      <h1 className="font-display mb-1 text-lg">Staff sign in</h1>
      <p className="mb-4 text-sm" style={{ color: "var(--muted)" }}>
        Royale Cinema Lounge back office &amp; POS.
      </p>

      <label className="mb-3 block">
        <div className="label-xs">Email</div>
        <input type="email" required autoFocus className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="mb-4 block">
        <div className="label-xs">Password</div>
        <input type="password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>

      {error && (
        <div className="mb-4 text-sm" style={{ color: "var(--danger-text)" }}>
          {error}
        </div>
      )}

      <button type="submit" disabled={submitting} className="btn-primary w-full">
        {submitting ? "Signing in..." : "Sign in"}
      </button>
      <div className="my-3 text-center text-xs" style={{ color: "var(--muted)" }}>
        or
      </div>
      <button type="button" disabled={submitting} className="btn-secondary w-full" onClick={signInWithGoogle}>
        Continue with Google
      </button>
      <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
        Use the Google account with the same email as your staff login.
      </p>
    </form>
  );
}
