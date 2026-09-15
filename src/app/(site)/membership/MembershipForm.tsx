"use client";

import { useState } from "react";
import { submitMembershipSignup } from "./actions";

export default function MembershipForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canSubmit = name.trim() && email.includes("@");

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitMembershipSignup({ name, email, phone });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="notice notice-success">
        <h2 className="text-lg font-semibold">Welcome to Insiders!</h2>
        <p className="mt-2 text-sm opacity-90">You&apos;re signed up. Give staff your name or email next time you order to start earning points.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <div className="label-xs">Name</div>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <div className="label-xs">Email</div>
          <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block sm:col-span-2">
          <div className="label-xs">Phone (optional)</div>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
      </div>

      {error && <div className="mt-3 text-sm text-[var(--danger-text)]">{error}</div>}

      <button className="btn-primary mt-4 w-full" disabled={!canSubmit || submitting} onClick={handleSubmit}>
        {submitting ? "Signing up..." : "Join Insiders — it's free"}
      </button>
    </div>
  );
}
