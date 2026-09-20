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

      <div className="card mb-8 overflow-x-auto !p-0">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left">
              <th className="px-4 py-3 font-medium text-[var(--muted)]">&nbsp;</th>
              <th className="px-4 py-3 font-medium">
                Insiders
                <div className="mt-0.5 text-xs font-normal text-[var(--muted)]">Free</div>
              </th>
              <th className="px-4 py-3 font-medium text-[var(--accent)]">
                Insiders+
                <div className="mt-0.5 text-xs font-normal text-[var(--muted)]">$15/mo</div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            <tr>
              <td className="px-4 py-3 text-[var(--muted)]">Mailing list &amp; weekly updates</td>
              <td className="px-4 py-3">Included</td>
              <td className="px-4 py-3">Included</td>
            </tr>
            <tr>
              <td className="px-4 py-3 text-[var(--muted)]">Lounge entry</td>
              <td className="px-4 py-3">$5 day pass (+$3 new releases)</td>
              <td className="px-4 py-3 font-medium text-[var(--accent)]">Free, unlimited, always</td>
            </tr>
            <tr>
              <td className="px-4 py-3 text-[var(--muted)]">Points on every purchase</td>
              <td className="px-4 py-3">Standard rate</td>
              <td className="px-4 py-3">Faster rate</td>
            </tr>
            <tr>
              <td className="px-4 py-3 text-[var(--muted)]">Priority access to weekly titles &amp; exclusive events</td>
              <td className="px-4 py-3 text-[var(--muted)]">—</td>
              <td className="px-4 py-3">Included</td>
            </tr>
            <tr>
              <td className="px-4 py-3 text-[var(--muted)]">Concession &amp; merch discounts</td>
              <td className="px-4 py-3 text-[var(--muted)]">—</td>
              <td className="px-4 py-3">Included</td>
            </tr>
          </tbody>
        </table>
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">
          <span>
            Insiders+ pricing: Adults <strong className="text-[var(--accent)]">$15/mo</strong>
          </span>
          <span>
            Seniors <strong className="text-[var(--accent)]">$12/mo</strong>
          </span>
          <span>
            Students <strong className="text-[var(--accent)]">$10/mo</strong>
          </span>
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
