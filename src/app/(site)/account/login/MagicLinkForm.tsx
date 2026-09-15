"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function MagicLinkForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/account/callback` },
    });
    if (error) {
      setError(error.message);
      setSubmitting(false);
      return;
    }
    setSent(true);
    setSubmitting(false);
  }

  if (sent) {
    return (
      <div className="notice notice-success">
        <h2 className="text-lg font-semibold">Check your email</h2>
        <p className="mt-2 text-sm opacity-90">We sent a sign-in link to {email}. Open it on this device to continue.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      <label className="block">
        <div className="label-xs">Email</div>
        <input type="email" required autoFocus className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {error && <div className="mt-3 text-sm text-[var(--danger-text)]">{error}</div>}
      <button className="btn-primary mt-4 w-full" disabled={submitting}>
        {submitting ? "Sending..." : "Send sign-in link"}
      </button>
    </form>
  );
}
