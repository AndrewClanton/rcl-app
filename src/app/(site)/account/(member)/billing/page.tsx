import { requireMember } from "@/lib/member-auth";
import { activityYears, getPurchases } from "@/lib/data/member-account";
import { getMembershipBilling } from "@/lib/data/member-billing";
import BillingView from "./BillingView";

export const metadata = { title: "Billing" };

export default async function BillingPage() {
  const member = await requireMember();
  const [billing, purchases] = await Promise.all([getMembershipBilling(member), getPurchases(member.id)]);
  return <BillingView member={member} billing={billing} years={activityYears(purchases)} />;
}
