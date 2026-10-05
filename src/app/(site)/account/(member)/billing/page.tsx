import { requireMember } from "@/lib/member-auth";
import { activityYears, getPurchases } from "@/lib/data/member-account";
import { getMembershipBilling } from "@/lib/data/member-billing";
import { currentGiftFrom } from "@/lib/gift-membership";
import { getPaidThrough, prepaidInForce } from "@/lib/paid-through";
import BillingView from "./BillingView";

export const metadata = { title: "Billing" };

export default async function BillingPage() {
  const member = await requireMember();
  const [billing, purchases, giftFrom, paidRec] = await Promise.all([getMembershipBilling(member), getPurchases(member.id), currentGiftFrom(member.id), getPaidThrough(member.id)]);
  // Paid ahead on the old website, until a date (lib/paid-through.ts).
  const prepaid = giftFrom ? null : prepaidInForce(member, paidRec);
  return (
    <BillingView
      member={member}
      billing={billing}
      years={activityYears(purchases)}
      giftFrom={giftFrom}
      prepaid={prepaid?.paidThrough ? { paidThrough: prepaid.paidThrough, renewsAs: prepaid.renewsAs } : null}
    />
  );
}
