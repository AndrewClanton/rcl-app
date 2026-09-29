import { requireMember } from "@/lib/member-auth";
import { activityYears, getPurchases } from "@/lib/data/member-account";
import { getMembershipBilling } from "@/lib/data/member-billing";
import { currentGiftFrom } from "@/lib/gift-membership";
import BillingView from "./BillingView";

export const metadata = { title: "Billing" };

export default async function BillingPage() {
  const member = await requireMember();
  const [billing, purchases, giftFrom] = await Promise.all([getMembershipBilling(member), getPurchases(member.id), currentGiftFrom(member.id)]);
  return <BillingView member={member} billing={billing} years={activityYears(purchases)} giftFrom={giftFrom} />;
}
