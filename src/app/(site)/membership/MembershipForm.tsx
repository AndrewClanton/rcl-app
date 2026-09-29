"use client";

import { useState } from "react";
import { ANNUAL_PRICE, RATE_PRICE, dollars } from "@/lib/membership-rates";
import { submitMembershipSignup, startMembershipCheckout } from "./actions";

type Plan = "free" | "plus" | "annual";

// For visitors who aren't signed in. Signed-in members never see this: they
// go straight to payment (see join/route.ts).
export default function MembershipForm({ initialPlan = "free", returnTo = null }: { initialPlan?: Plan; returnTo?: string | null }) {
  const [plan, setPlan] = useState<Plan>(initialPlan);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canSubmit = name.trim() && email.includes("@");
  // Signing in brings them back here with everything filled in -- or, for
  // Insiders+, straight to payment.
  const joinQuery = new URLSearchParams({ ...(plan === "annual" ? { plan: "annual" } : {}), ...(returnTo ? { next: returnTo } : {}) }).toString();
  const afterSignIn = plan === "free" ? "/account" : `/membership/join${joinQuery ? `?${joinQuery}` : ""}`;
  const signInHref = `/account/login?next=${encodeURIComponent(afterSignIn)}`;

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
        const result = await startMembershipCheckout({ name, email, phone, returnTo, annual: plan === "annual" });
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
      <div className="sheet p-5">
        <span className="ctag ctag-yellow">Insiders</span>
        <h2 className="font-display mt-3 text-2xl">You&apos;re in.</h2>
        <p className="mt-2 text-[15px]">Give staff your name or email next time you order to start earning points.</p>
      </div>
    );
  }

  const plans: { id: Plan; name: string; price: string; note: string }[] = [
    { id: "free", name: "Insiders", price: "Free", note: "Points on everything" },
    { id: "plus", name: "Insiders+ monthly", price: `$${RATE_PRICE.adult}/mo`, note: "Every screening free" },
    { id: "annual", name: "Insiders+ yearly", price: `${dollars(ANNUAL_PRICE.adult)}/yr`, note: "Save 15%" },
  ];

  return (
    <section className="sheet">
      <h2 className="spec-head rounded-t-[4px]">
        <span>Join</span>
        <span>Takes a minute</span>
      </h2>
      <div className="p-4 sm:p-5">
      <div className="mb-5">
        <div className="label-xs">Pick a plan</div>
        <div role="radiogroup" aria-label="Plan" className="grid gap-3 sm:grid-cols-3">
          {plans.map((p) => (
            <button
              key={p.id}
              role="radio"
              aria-checked={plan === p.id}
              onClick={() => setPlan(p.id)}
              className={`rounded-[4px] border-2 border-[var(--foreground)] px-4 py-3 text-left transition-transform ${plan === p.id ? "bg-[var(--gold)] shadow-[3px_3px_0_var(--foreground)]" : "bg-[var(--surface)] hover:-translate-y-px"}`}
            >
              <div className="spec-k !text-[var(--foreground)]">{p.name}</div>
              <div className="font-display text-xl leading-tight">{p.price}</div>
              <div className="text-sm">{p.note}</div>
            </button>
          ))}
        </div>
        {plan !== "free" && (
          <div className="mt-3 space-y-1 text-sm text-[var(--muted)]">
            <p>
              {plan === "annual"
                ? `You'll be redirected to Stripe to pay ${dollars(ANNUAL_PRICE.adult)} for the year (15% off monthly), plus tax. It renews on the same date next year.`
                : "You'll be redirected to Stripe to set up your monthly payment, plus tax. You're billed on the same day each month."}
            </p>
            <p>
              Senior (${RATE_PRICE.senior}/mo) or student (${RATE_PRICE.student}/mo)? Join here, then show your ID at the box office and we&apos;ll switch your rate. The lower price
              starts with your next bill.
            </p>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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

      {error && <div className="mt-3 text-sm font-bold text-[var(--danger-text)]">{error}</div>}

      <button className="btn-primary mt-5 w-full px-5 py-3 text-base" disabled={!canSubmit || submitting} onClick={handleSubmit}>
        {submitting ? "One moment…" : !canSubmit ? "Add your name and email" : plan === "free" ? "Join Insiders, free" : "Continue to payment"}
      </button>
      <p className="mt-3 text-center text-sm text-[var(--muted)]">
        Already have an account?{" "}
        <a href={signInHref} className="font-bold text-[var(--accent)] hover:underline">
          Sign in
        </a>{" "}
        and {plan !== "free" ? "go straight to payment" : "skip this form"}.
      </p>
      </div>
    </section>
  );
}
