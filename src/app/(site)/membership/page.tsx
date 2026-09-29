import type { Metadata } from "next";
import { getStripe } from "@/lib/stripe";
import { ANNUAL_PRICE, RATE_PRICE, dollars } from "@/lib/membership-rates";
import { SALES_TAX_PERCENT } from "@/lib/sales-tax";
import { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";
import Link from "next/link";
import { getSignedInMember } from "@/lib/member-auth";
import { hasPlusPerks, plusNeedsCard } from "@/lib/plus-checkout";
import MemberAvatar from "@/components/MemberAvatar";
import { safePath } from "@/lib/safe-path";
import PlusLink from "@/components/PlusLink";
import MembershipForm from "./MembershipForm";
import { PageMasthead, ProofStamp, RegNote, SpecFoot, Starburst } from "@/components/print";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join Insiders",
  description: "Free to join. Upgrade to Insiders+ for unlimited entry to every screening, no ticket cost, ever.",
};

function Perk({ children, off = false }: { children: React.ReactNode; off?: boolean }) {
  return (
    <li className={`flex gap-2.5 ${off ? "text-[var(--muted)]" : ""}`}>
      <span aria-hidden="true" className={`font-display mt-px w-4 flex-none text-center ${off ? "" : "text-[var(--accent)]"}`}>
        {off ? "–" : "✓"}
      </span>
      <span>{children}</span>
    </li>
  );
}

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
  const isPlus = perks && !needsCard;
  const price = RATE_PRICE[member?.price_tier ?? "adult"];
  const yearly = dollars(ANNUAL_PRICE[member?.price_tier ?? "adult"]);

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

  const rates: [string, string, string][] = [
    ["Adult", `$${RATE_PRICE.adult}/mo`, `${dollars(ANNUAL_PRICE.adult)}/yr`],
    ["Senior", `$${RATE_PRICE.senior}/mo`, `${dollars(ANNUAL_PRICE.senior)}/yr`],
    ["Student", `$${RATE_PRICE.student}/mo`, `${dollars(ANNUAL_PRICE.student)}/yr`],
  ];

  return (
    <div>
      {/* Just joined: say so first thing, not at the bottom of the page. */}
      {subscriptionConfirmed && (
        <div className="sheet mb-10 flex flex-wrap items-center gap-5 p-5">
          {member && <MemberAvatar name={member.name} url={member.avatar_url} size={72} plus />}
          <div className="min-w-0 flex-1">
            <span className="ctag ctag-yellow">Insiders+</span>
            <h2 className="font-display mt-2 text-2xl">Welcome in{member ? `, ${member.name.split(" ")[0]}` : ""}.</h2>
            <p className="mt-1 text-[15px]">Your membership is active. Give your name or email at the door and walk in free to any screening.</p>
          </div>
          <Link href={next ?? "/showtimes"} className="btn-primary px-5 py-3">
            {next ? "Continue where you left off" : "See what's playing"}
          </Link>
        </div>
      )}

      <PageMasthead
        eyebrow="Membership"
        title={isPlus ? "Your Insiders+ membership" : "Join the Royale"}
        intro={isPlus ? "Unlimited entry to every screening, no ticket cost, ever. Here's everything it includes." : "Insiders is free and earns points on everything. Insiders+ gets you into every screening free, every time."}
        className="!mb-0"
      />

      <div className="mt-8 grid gap-7 md:grid-cols-2">
        {/* Free */}
        <section className="sheet crop flex flex-col">
          <div className="border-b-2 border-[var(--foreground)] px-5 py-5">
            <div className="spec-k">Free forever</div>
            <h2 className="font-display text-3xl">Insiders</h2>
            <div className="font-display mt-2 text-4xl leading-none">$0</div>
          </div>
          <ul className="flex-1 space-y-2.5 px-5 py-5 text-[15px]">
            <Perk>Mailing list and the weekly lineup</Perk>
            <Perk>
              1 point per $1 spent. {POINTS_PER_REWARD} points = ${REWARD_VALUE} off
            </Perk>
            <Perk off>Buy a ticket for each screening</Perk>
            <Perk off>Booth reservations at the regular fee</Perk>
          </ul>
          {!member && !subscriptionConfirmed && (
            <div className="px-5 pb-5">
              <a href="?plan=free#join" className="btn-secondary block px-5 py-3 text-center">
                Join free
              </a>
            </div>
          )}
        </section>

        {/* Insiders+ -- the Panel Pop treatment from the proof sheet. */}
        <section className="sheet relative flex flex-col !border-4 !shadow-[7px_7px_0_var(--foreground)]">
          <RegNote className="-top-7 left-0">Align to centerline</RegNote>
          {!isPlus && (
            <Starburst className="starburst-red absolute -top-9 -right-6 z-[2] hidden sm:block">
              Save
              <br />
              15%
            </Starburst>
          )}
          <div className="halftone halftone-hero relative rounded-t-[2px] border-b-[3px] border-[var(--foreground)] bg-[var(--gold)] px-5 py-5">
            <div className="relative z-[1]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="spec-k !text-[var(--foreground)]">{isPlus ? "Your plan" : "Unlimited screenings"}</div>
                  <h2 className="font-display text-3xl">Insiders+</h2>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
                <span className="font-display text-4xl leading-none">${price}/mo</span>
                <span className="text-[15px] font-bold">
                  or {yearly}/yr, save 15%
                </span>
              </div>
            </div>
          </div>
          <ul className="flex-1 space-y-2.5 px-5 py-5 text-[15px]">
            <Perk>
              <strong>Free entry to every screening</strong>, unlimited
            </Perk>
            <Perk>
              <a href="/booths" className="underline decoration-2 underline-offset-2">
                2 free booth reservations
              </a>{" "}
              every month
            </Perk>
            <Perk>Concession and merch discounts</Perk>
            <Perk>First access to weekly titles and member events</Perk>
            <Perk>1 point per $1 spent, same as Insiders</Perk>
          </ul>
          {!subscriptionConfirmed && (
            <div className="flex flex-wrap gap-3 px-5 pb-5">
              {isPlus ? (
                <Link href="/account/billing" className="btn-secondary px-5 py-3">
                  See your membership
                </Link>
              ) : (
                <>
                  <PlusLink next={next ?? undefined} className="btn-primary flex-1 px-5 py-3 text-center">
                    {needsCard ? `Add a card · $${price}/mo` : `Monthly · $${price}`}
                  </PlusLink>
                  <PlusLink next={next ?? undefined} annual className="btn-secondary flex-1 px-5 py-3 text-center">
                    Yearly · {yearly}
                  </PlusLink>
                </>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Every rate in one place, set as a spec panel. */}
      <section className="sheet crop mt-12">
        <h2 className="spec-head rounded-t-[4px]">
          <span>Insiders+ rates</span>
          <span className="flex items-center gap-4">
            <span>Plus {SALES_TAX_PERCENT}% sales tax</span>
            <ProofStamp>
              Rate
              <br />
              card
            </ProofStamp>
          </span>
        </h2>
        <div className="spec-grid spec-grid-3">
          {rates.map(([who, mo, yr]) => (
            <div key={who} className="spec-cell">
              <div className="spec-k">{who}</div>
              <div className="spec-v">{mo}</div>
              <div className="mt-0.5 text-sm text-[var(--muted)]">{yr} yearly</div>
            </div>
          ))}
        </div>
        <p className="border-t border-[var(--border)] px-4 py-3 text-sm">Senior or student? Join at the adult rate, then show your ID at the box office and we&apos;ll switch you. The lower price starts with your next bill.</p>
        <SpecFoot code="RCL-RATES · 2026 · REV A" />
      </section>

      <div id="join" className="mt-10 scroll-mt-40">
        {subscriptionConfirmed || isPlus ? null : (
          <>
            {checkout === "cancelled" && <div className="notice notice-warn mb-4">Checkout was cancelled. No charge was made. Feel free to try again.</div>}
            {checkout === "unavailable" && <div className="notice notice-warn mb-4">Insiders+ checkout isn&apos;t available right now. Please try again in a bit, or join at the box office.</div>}
            {member ? (
              // Signed in: we already have their name and email, so the only
              // thing left is the card, on Stripe's page.
              <div className="sheet flex flex-wrap items-center justify-between gap-4 p-5">
                {needsCard ? (
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-lg">Your Insiders+ was set up at the box office and doesn&apos;t have a card on file yet.</div>
                    <div className="mt-1 text-[15px] text-[var(--muted)]">Add one to keep it going, ${price}/month or {yearly}/year plus tax, billed to {member.email}. You keep all your perks in the meantime.</div>
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-lg">You&apos;re signed in as {member.name}.</div>
                    <div className="mt-1 text-[15px] text-[var(--muted)]">Insiders+ is ${price}/month, or {yearly}/year paid up front (15% off), billed to {member.email}.</div>
                  </div>
                )}
                <div className="flex flex-wrap gap-3">
                  <PlusLink next={next ?? undefined} className="btn-primary px-5 py-3">
                    Monthly · ${price}
                  </PlusLink>
                  <PlusLink next={next ?? undefined} annual className="btn-secondary px-5 py-3">
                    Yearly · {yearly}
                  </PlusLink>
                </div>
              </div>
            ) : (
              <MembershipForm initialPlan={plan === "annual" ? "annual" : plan === "plus" ? "plus" : "free"} returnTo={next} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
