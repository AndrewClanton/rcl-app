import { requireStaff } from "@/lib/auth";
import { getAllPrepTickets } from "@/lib/data/prepTickets";
import { getBoardEntries } from "@/lib/data/barBook";
import PrepTicketBoard from "../PrepTicketBoard";

export const dynamic = "force-dynamic";

// The kitchen and the bar are close enough to share one screen.
export default async function PrepDisplayPage() {
  await requireStaff();
  // Drink icons and recipes for the bar's lines: a board with none still works as before.
  const [tickets, drinks] = await Promise.all([getAllPrepTickets(), getBoardEntries().catch(() => ({ items: {}, recipes: {} }))]);
  return <PrepTicketBoard title="Kitchen & bar" station="all" initialTickets={tickets} drinks={drinks} />;
}
