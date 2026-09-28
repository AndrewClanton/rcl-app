import { NextResponse, type NextRequest } from "next/server";
import { getSignedInMember } from "@/lib/member-auth";
import { createPlusCheckout, plusPaidFor } from "@/lib/plus-checkout";
import { safePath } from "@/lib/safe-path";

// Every "Get Insiders+" button on the site points here.
// - Signed in: straight to Stripe's payment page; we already have their
//   name and email, so the card is the only thing left to ask.
// - Already paying (or complimentary): their billing page.
// - Insiders+ set by staff with no card: checkout, to put a card on it.
// - Not signed in: the short join form, with Insiders+ already picked.
// ?next= is where to come back to afterwards (e.g. the showtime they were on).
// Link to it with a plain <a> (components/PlusLink), never next/link: a
// prefetch would open a Stripe session nobody asked for.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const next = safePath(url.searchParams.get("next"));
  const go = (path: string) => NextResponse.redirect(new URL(path, url), 303);
  const joinForm = `/membership?plan=plus${next ? `&next=${encodeURIComponent(next)}` : ""}#join`;

  const member = await getSignedInMember();
  if (!member || !member.email) return go(joinForm);
  // Paid for or complimentary: nothing to buy. (Insiders+ set by hand at the
  // register with no card falls through to checkout, to add one.)
  if (plusPaidFor(member)) return go("/account/billing");

  const checkoutUrl = await createPlusCheckout({
    memberId: member.id,
    customerId: member.stripe_customer_id,
    name: member.name,
    email: member.email,
    phone: member.phone,
    // Online joins are at the adult rate unless staff already switched
    // this member to senior/student after checking an ID.
    priceTier: member.price_tier ?? "adult",
    returnTo: next,
  }).catch(() => null);
  if (!checkoutUrl) return go("/membership?checkout=unavailable#join");
  return NextResponse.redirect(checkoutUrl, 303);
}
