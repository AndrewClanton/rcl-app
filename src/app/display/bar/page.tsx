import { requireStaff } from "@/lib/auth";
import { getBarTickets } from "@/lib/data/prepTickets";
import { getBoardEntries } from "@/lib/data/barBook";
import PrepTicketBoard from "../PrepTicketBoard";

export const dynamic = "force-dynamic";

export default async function BarDisplayPage() {
  await requireStaff();
  // Drink icons and recipes: a board with none still works as before.
  const [tickets, drinks] = await Promise.all([getBarTickets(), getBoardEntries().catch(() => ({}))]);
  return <PrepTicketBoard title="Bar" station="bar" initialTickets={tickets} drinks={drinks} />;
}
