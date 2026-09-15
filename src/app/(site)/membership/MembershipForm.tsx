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
      <div className="rounded-xl border border-green-300 bg-green-50 p-6 dark:border-green-800 dark:bg-green-950">
        <h2 className="text-lg font-semibold text-green-900 dark:text-green-300">Welcome to Insiders!</h2>
        <p className="mt-2 text-sm text-green-800 dark:text-green-400">
          You&apos;re signed up. Give staff your name or email next time you order to start earning points.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <div className="mb-1 text-xs text-neutral-500">Name</div>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <div className="mb-1 text-xs text-neutral-500">Email</div>
          <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block sm:col-span-2">
          <div className="mb-1 text-xs text-neutral-500">Phone (optional)</div>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
      </div>

      {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

      <button
        className="mt-4 w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        disabled={!canSubmit || submitting}
        onClick={handleSubmit}
      >
        {submitting ? "Signing up..." : "Join Insiders — it's free"}
      </button>
    </div>
  );
}
