import type { Metadata } from "next";
import { getStripe } from "@/lib/stripe";
import MembershipForm from "./MembershipForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join Insiders",
  description: "Free to join. Upgrade to Insiders+ for unlimited entry to every screening, no ticket cost, ever.",
};

export default async function MembershipPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; session_id?: string }>;
}) {
  const { checkout, session_id } = await searchParams;

  let subscriptionConfirmed = false;
  if (checkout === "success" && session_id) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(session_id, { expand: ["subscription"] });
      const sub = session.subscription;
      const status = typeof sub === "string" ? null : sub?.status;
      subscriptionConfirmed = status === "active" || status === "trialing";
    } catch {
      subscriptionConfirmed = false;
    }
  }

  return (
    <div>
      <h1 className="font-display mb-2 text-3xl font-semibold">Join Insiders</h1>
      <p className="mb-8 max-w-2xl text-[var(--muted)]">
        Free to join. Upgrade to Insiders+ for unlimited entry to every screening, no ticket cost, ever.
      </p>

      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        <div className="card">
          <div className="font-medium text-[var(--accent)]">Royale Insiders — Free</div>
          <ul className="mt-2 space-y-1 text-sm text-[var(--muted)]">
            <li>Free mailing list subscription with weekly updates</li>
            <li>$5 day pass to the lounge (+$3 on new-release days)</li>
            <li>Earn points with every purchase</li>
          </ul>
        </div>
        <div className="card">
          <div className="font-medium text-[var(--accent)]">Royale Insiders+ — Monthly</div>
          <ul className="mt-2 space-y-1 text-sm text-[var(--muted)]">
            <li>Unlimited entry to every screening — free tickets, always</li>
            <li>Priority access to weekly titles and exclusive events</li>
            <li>Discounts on concessions and merchandise, plus faster points</li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <span>
              Adults <strong className="text-[var(--accent)]">$15/mo</strong>
            </span>
            <span>
              Seniors <strong className="text-[var(--accent)]">$12/mo</strong>
            </span>
            <span>
              Students <strong className="text-[var(--accent)]">$10/mo</strong>
            </span>
          </div>
        </div>
      </div>

      {subscriptionConfirmed ? (
        <div className="notice notice-success">
          <h2 className="text-lg font-semibold">Welcome to Insiders+!</h2>
          <p className="mt-2 text-sm opacity-90">Your subscription is active. Show your email at the door for free entry to any screening.</p>
        </div>
      ) : (
        <>
          {checkout === "cancelled" && <div className="notice notice-warn mb-4">Checkout was cancelled — no charge was made. Feel free to try again.</div>}
          <MembershipForm />
        </>
      )}
    </div>
  );
}
