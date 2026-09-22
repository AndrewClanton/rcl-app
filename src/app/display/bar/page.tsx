import { requireStaff } from "@/lib/auth";
import { getBarTickets } from "@/lib/data/prepTickets";
import PrepTicketBoard from "../PrepTicketBoard";

export const dynamic = "force-dynamic";

export default async function BarDisplayPage() {
  await requireStaff();
  const tickets = await getBarTickets();
  return <PrepTicketBoard title="Bar" station="bar" initialTickets={tickets} />;
}
