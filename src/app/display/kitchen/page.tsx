import { requireStaff } from "@/lib/auth";
import { getRecentKitchenTickets } from "@/lib/data/kitchen";
import KitchenDisplay from "./KitchenDisplay";

export const dynamic = "force-dynamic";

export default async function KitchenDisplayPage() {
  await requireStaff();
  const tickets = await getRecentKitchenTickets();
  return <KitchenDisplay initialTickets={tickets} />;
}
