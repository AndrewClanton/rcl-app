import { requireStaff } from "@/lib/auth";
import { getKitchenTickets } from "@/lib/data/prepTickets";
import PrepTicketBoard from "../PrepTicketBoard";

export const dynamic = "force-dynamic";

export default async function KitchenDisplayPage() {
  await requireStaff();
  const tickets = await getKitchenTickets();
  return <PrepTicketBoard title="Kitchen" station="kitchen" initialTickets={tickets} />;
}
