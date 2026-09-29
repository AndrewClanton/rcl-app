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
            Insiders+ monthly (${RATE_PRICE.adult}/mo)
          </button>
          <button className={`chip ${plan === "annual" ? "chip-selected" : ""}`} onClick={() => setPlan("annual")}>
            Insiders+ yearly ({dollars(ANNUAL_PRICE.adult)}/yr, save 15%)
          </button>
        </div>
        {plan !== "free" && (
          <div className="mt-2 space-y-1 text-xs text-[var(--muted)]">
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
      <p className="mt-3 text-center text-sm text-[var(--muted)]">
        Already have an account?{" "}
        <a href={signInHref} className="font-bold text-[var(--accent)] hover:underline">
          Sign in
        </a>{" "}
        and {plan !== "free" ? "go straight to payment" : "skip this form"}.
      </p>
    </div>
  );
}
