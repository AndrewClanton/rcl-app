import { requireMember } from "@/lib/member-auth";
import { getPurchases } from "@/lib/data/member-account";
import PurchasesView from "./PurchasesView";

export const metadata = { title: "Purchases" };

export default async function PurchasesPage() {
  const member = await requireMember();
  return <PurchasesView purchases={await getPurchases(member.id)} />;
}
