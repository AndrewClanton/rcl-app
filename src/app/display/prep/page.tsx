import { requireStaff } from "@/lib/auth";
import { getAllPrepTickets } from "@/lib/data/prepTickets";
import PrepTicketBoard from "../PrepTicketBoard";

export const dynamic = "force-dynamic";

// The kitchen and the bar are close enough to share one screen.
export default async function PrepDisplayPage() {
  await requireStaff();
  const tickets = await getAllPrepTickets();
  return <PrepTicketBoard title="Kitchen & bar" station="all" initialTickets={tickets} />;
}
