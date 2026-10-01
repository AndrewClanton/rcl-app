import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPlusCheckout, giftEndsWithoutRenewal, plusPaidFor } from "@/lib/plus-checkout";
import { openFinishToken } from "@/lib/plus-finish-token";
import { allowFromConnection } from "@/lib/public-form-guard";

// "Finish your Insiders+ on your phone": the QR code staff put on the
// customer screen, or the link they emailed (pos/legacy-plus-actions.ts),
// for a former unlimited member (lib/legacy-plus.ts) whose card should go
// on their own phone rather than the reader. Opens Stripe's card page
// already tied to their account, at the plan staff picked (senior or
// student only after an ID check at the register). Charged today, then
// monthly or yearly, the same as joining online.
// - Already paying: their billing page instead.
// - A link that's run out, or isn't ours: the ordinary "Get Insiders+".
// Link to it with a plain <a>, never next/link: a prefetch would open a
// Stripe session nobody asked for.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const go = (path: string) => NextResponse.redirect(new URL(path, url), 303);
  const token = openFinishToken(url.searchParams.get("t"));
  if (!token || token.expired) return go("/membership/join");
  // Each visit opens a Stripe session: capped per connection, like the join form.
  if (!(await allowFromConnection("membership"))) return go("/membership?checkout=unavailable#join");

  const { data: member } = await createAdminClient()
    .from("members")
    .select("id, name, email, phone, tier, comped, stripe_customer_id, stripe_subscription_id, subscription_status, plus_gift_until, erased_at")
    .eq("id", token.memberId)
    .maybeSingle();
  if (!member || member.erased_at || !member.email) return go("/membership/join");
  // Set up already (on the reader a minute ago, say): nothing to pay.
  if (plusPaidFor(member) && !giftEndsWithoutRenewal(member)) return go("/account/billing");

  const checkoutUrl = await createPlusCheckout({
    memberId: member.id,
    customerId: member.stripe_customer_id,
    name: member.name,
    email: member.email,
    phone: member.phone,
    priceTier: token.tier,
    interval: token.interval,
    returnTo: null,
    // Staff made the link for this member: the card is theirs.
    linkCard: true,
    legacyFinish: true,
  }).catch(() => null);
  if (!checkoutUrl) return go("/membership?checkout=unavailable#join");
  return NextResponse.redirect(checkoutUrl, 303);
}
