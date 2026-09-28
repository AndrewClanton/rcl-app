import type { Metadata } from "next";
import { getStripe } from "@/lib/stripe";
import { RATE_PRICE } from "@/lib/membership-rates";
import { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";
import Link from "next/link";
import { getSignedInMember } from "@/lib/member-auth";
import { hasPlusPerks, plusNeedsCard } from "@/lib/plus-checkout";
import MemberAvatar from "@/components/MemberAvatar";
import { safePath } from "@/lib/safe-path";
import PlusLink from "@/components/PlusLink";
import MembershipForm from "./MembershipForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join Insiders",
  description: "Free to join. Upgrade to Insiders+ for unlimited entry to every screening, no ticket cost, ever.",
};

export default async function MembershipPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; session_id?: string; plan?: string; next?: string }>;
}) {
  const { checkout, session_id, plan, next: nextParam } = await searchParams;
  const next = safePath(nextParam);
  const member = await getSignedInMember();
  const perks = !!member && hasPlusPerks(member);
  // Insiders+ set by staff at the register, with no card behind it yet.
  const needsCard = !!member && plusNeedsCard(member);
  const price = RATE_PRICE[member?.price_tier ?? "adult"];

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
      {/* Just joined: say so first thing, not at the bottom of the page. */}
      {subscriptionConfirmed && (
        <div className="notice notice-success mb-8 flex flex-wrap items-center gap-5">
          {member && <MemberAvatar name={member.name} url={member.avatar_url} size={72} plus />}
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl">Welcome to Insiders+{member ? `, ${member.name.split(" ")[0]}` : ""}!</h2>
            <p className="mt-1 text-sm opacity-90">Your membership is active. Give your name or email at the door and walk in free to any screening.</p>
          </div>
          <Link href={next ?? "/showtimes"} className="btn-primary">
            {next ? "Continue where you left off" : "See what's playing"}
          </Link>
        </div>
      )}
      <h1 className="font-display mb-2 text-3xl font-semibold">{perks && !needsCard ? "Your Insiders+ membership" : "Join Insiders"}</h1>
      <p className="mb-5 max-w-2xl text-[var(--muted)]">
        {perks && !needsCard ? "Unlimited entry to every screening, no ticket cost, ever. Here's everything it includes." : "Free to join. Upgrade to Insiders+ for unlimited entry to every screening, no ticket cost, ever."}
      </p>
      {!subscriptionConfirmed && (
        <div className="mb-8">
          {perks && !needsCard ? (
            <Link href="/account/billing" className="btn-secondary">
              See your membership
            </Link>
          ) : (
            <PlusLink next={next ?? undefined} className="btn-primary">
              {needsCard ? `Add a card to your Insiders+ · ${price}/month` : `Get Insiders+ · ${price}/month`}
            </PlusLink>
          )}
        </div>
      )}

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
                <div className="mt-0.5 text-xs font-normal text-[var(--muted)]">${RATE_PRICE.adult}/mo</div>
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
              <td className="px-4 py-3">Buy a ticket per screening</td>
              <td className="px-4 py-3 font-medium text-[var(--accent)]">Free, unlimited, always</td>
            </tr>
            <tr>
              <td className="px-4 py-3 text-[var(--muted)]">
                Loyalty points
                <div className="mt-0.5 text-xs">
                  {POINTS_PER_REWARD} points = ${REWARD_VALUE} off
                </div>
              </td>
              <td className="px-4 py-3">1 point per $1 spent</td>
              <td className="px-4 py-3">1 point per $1 spent</td>
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
            <tr>
              <td className="px-4 py-3 text-[var(--muted)]">
                <a href="/booths" className="hover:underline">
                  Booth reservations
                </a>
              </td>
              <td className="px-4 py-3 text-[var(--muted)]">Pay the reservation fee</td>
              <td className="px-4 py-3 font-medium text-[var(--accent)]">2 free every month</td>
            </tr>
          </tbody>
        </table>
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">
          <span>
            Insiders+ pricing: Adults <strong className="text-[var(--accent)]">${RATE_PRICE.adult}/mo</strong>
          </span>
          <span>
            Seniors <strong className="text-[var(--accent)]">${RATE_PRICE.senior}/mo</strong>
          </span>
          <span>
            Students <strong className="text-[var(--accent)]">${RATE_PRICE.student}/mo</strong>
          </span>
          <span>Senior and student rates are set at the box office with a valid ID.</span>
        </div>
      </div>

      <div id="join" className="scroll-mt-40">
        {subscriptionConfirmed || (perks && !needsCard) ? null : (
          <>
            {checkout === "cancelled" && <div className="notice notice-warn mb-4">Checkout was cancelled — no charge was made. Feel free to try again.</div>}
            {checkout === "unavailable" && <div className="notice notice-warn mb-4">Insiders+ checkout isn&apos;t available right now. Please try again in a bit, or join at the box office.</div>}
            {member ? (
              // Signed in: we already have their name and email, so the only
              // thing left is the card, on Stripe's page.
              <div className="card flex flex-wrap items-center justify-between gap-4">
                {needsCard ? (
                  <div>
                    <div className="font-semibold">Your Insiders+ was set up at the box office and doesn&apos;t have a card on file yet.</div>
                    <div className="text-sm text-[var(--muted)]">Add one to keep it going, ${price}/month billed to {member.email}. You keep all your perks in the meantime.</div>
                  </div>
                ) : (
                  <div>
                    <div className="font-semibold">You&apos;re signed in as {member.name}.</div>
                    <div className="text-sm text-[var(--muted)]">
                      Insiders+ will be billed monthly to {member.email}. Senior or student? Join here, then show your ID at the box office and we&apos;ll switch your rate.
                    </div>
                  </div>
                )}
                <PlusLink next={next ?? undefined} className="btn-primary">
                  {needsCard ? "Add a card" : "Continue to payment"}
                </PlusLink>
              </div>
            ) : (
              <MembershipForm initialPlan={plan === "plus" ? "plus" : "free"} returnTo={next} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
