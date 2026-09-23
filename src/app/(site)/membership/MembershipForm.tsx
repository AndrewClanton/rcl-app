"use client";

import { useState } from "react";
import { submitMembershipSignup, startMembershipCheckout } from "./actions";

type Plan = "free" | "plus";

export default function MembershipForm() {
  const [plan, setPlan] = useState<Plan>("free");
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
      if (plan === "free") {
        const result = await submitMembershipSignup({ name, email, phone });
        if (!result.ok) {
          setError(result.error);
          setSubmitting(false);
          return;
        }
        setDone(true);
      } else {
        const result = await startMembershipCheckout({ name, email, phone });
        if (!result.ok) {
          setError(result.error);
          setSubmitting(false);
          return;
        }
        window.location.href = result.url;
      }
    } catch {
      setError("Something went wrong. Please try again.");
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
      <div className="mb-4">
        <div className="label-xs">Plan</div>
        <div className="flex flex-wrap gap-2">
          <button className={`chip ${plan === "free" ? "chip-selected" : ""}`} onClick={() => setPlan("free")}>
            Insiders (free)
          </button>
          <button className={`chip ${plan === "plus" ? "chip-selected" : ""}`} onClick={() => setPlan("plus")}>
            Insiders+ ($15/mo)
          </button>
        </div>
        {plan === "plus" && (
          <div className="mt-2 space-y-1 text-xs text-[var(--muted)]">
            <p>You&apos;ll be redirected to Stripe to set up your monthly payment. You&apos;re billed on the same day each month.</p>
            <p>
              Senior ($12/mo) or student ($10/mo)? Join here, then show your ID at the box office and we&apos;ll switch your rate. The lower price
              starts with your next bill.
            </p>
          </div>
        )}
      </div>

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
        {submitting ? "Please wait..." : plan === "free" ? "Join Insiders — it's free" : "Continue to payment"}
      </button>
    </div>
  );
}
