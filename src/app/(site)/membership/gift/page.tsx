import { pageMeta } from "@/lib/seo/page-meta";
import Link from "next/link";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { activateGiftFromCheckout } from "@/lib/gift-membership";
import { PageMasthead, SpecFoot } from "@/components/print";

export const dynamic = "force-dynamic";
// A buyer's own receipt page: kept out of search results.
export const metadata = pageMeta({ title: "Gift membership", description: "An Insiders+ gift membership from Royale Cinema Lounge.", path: "/membership/gift", noindex: true });

// Where Stripe sends the buyer after paying for a gift at the box office
// (on the staff device, or their own phone from a texted link). The
// session id is Stripe's unguessable one; the page shows only the friend's
// first name and the date.
export default async function GiftDonePage({ searchParams }: { searchParams: Promise<{ session_id?: string; cancelled?: string }> }) {
  const { session_id: sessionId, cancelled } = await searchParams;

  if (cancelled || !sessionId) {
    return (
      <div className="mx-auto max-w-xl">
        <PageMasthead eyebrow="Insiders+ gift" title="No charge was made." intro="The payment page was closed before paying. Ask the box office for a new link whenever you're ready." />
        <Link href="/membership" className="btn-secondary px-6 py-3">
          About Insiders+
        </Link>
      </div>
    );
  }

  const session = await getStripe()
    .checkout.sessions.retrieve(sessionId)
    .catch(() => null);
  const giftId = session?.metadata?.gift_membership_id;
  if (!session || !giftId) {
    return (
      <div className="mx-auto max-w-xl">
        <PageMasthead eyebrow="Insiders+ gift" title="We couldn't find that gift." intro="If you were charged, don't worry: ask at the box office or call 417-281-4172 and we'll sort it out." />
      </div>
    );
  }

  // The webhook does this too; whichever gets there first adds the year.
  await activateGiftFromCheckout(session);
  const { data: gift } = await createAdminClient()
    .from("gift_memberships")
    .select("status, buyer_name, ends_at, recipient:members!gift_memberships_recipient_member_id_fkey(name)")
    .eq("id", giftId)
    .maybeSingle();
  const friend = ((gift?.recipient as unknown as { name: string } | null)?.name ?? "").split(" ")[0] || "your friend";
  const ends = gift?.ends_at
    ? new Date(gift.ends_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Chicago" })
    : null;

  if (gift?.status !== "paid") {
    return (
      <div className="mx-auto max-w-xl">
        <PageMasthead eyebrow="Insiders+ gift" title="Almost done." intro="Stripe is still confirming the payment. Refresh this page in a moment." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <PageMasthead
        eyebrow="Insiders+ gift"
        title={`Thank you, ${gift.buyer_name.split(" ")[0]}!`}
        intro={`${friend} now has a year of Insiders+${ends ? `, good through ${ends}` : ""}. It's paid in full and won't renew.`}
        className="!mb-0"
      />
      <section className="sheet crop p-6">
        <span className="ctag ctag-yellow">What {friend} gets</span>
        <ul className="mt-4 space-y-2 text-[15px]">
          <li>Free entry to every screening, unlimited</li>
          <li>2 free booth reservations every month</li>
          <li>Concession and merch discounts</li>
          <li>First access to weekly titles and member events</li>
        </ul>
        <p className="mt-4 text-[15px] text-[var(--muted)]">They can sign in on our website with their email to use it, or just give their name at the box office.</p>
        <SpecFoot />
      </section>
    </div>
  );
}
