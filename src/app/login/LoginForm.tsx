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
    router.push(searchParams.get("redirect") || "/admin");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950">
      <h1 className="mb-1 text-lg font-semibold">Staff sign in</h1>
      <p className="mb-4 text-sm text-neutral-500">Royale Cinema Lounge back office &amp; POS.</p>

      <label className="mb-3 block">
        <div className="mb-1 text-xs text-neutral-500">Email</div>
        <input
          type="email"
          required
          autoFocus
          className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="mb-4 block">
        <div className="mb-1 text-xs text-neutral-500">Password</div>
        <input
          type="password"
          required
          className="w-full rounded border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      {error && <div className="mb-4 text-sm text-red-600">{error}</div>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-neutral-900 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {submitting ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
