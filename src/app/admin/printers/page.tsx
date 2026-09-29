import { requireManager } from "@/lib/auth";
import { getPrintersOverview } from "@/lib/data/printers";
import { SITE_URL } from "@/lib/site";
import PrintersAdmin from "./PrintersAdmin";

export const dynamic = "force-dynamic";

// Back office -> Printers, for managers and up: the receipt printers at the
// bar and the outdoor stand and the kitchen's order-ticket printer, which
// collect their print jobs from the website (lib/print/queue.ts).
export default async function PrintersPage() {
  await requireManager();
  const { printers, jobs } = await getPrintersOverview();
  return <PrintersAdmin printers={printers} jobs={jobs} pollUrl={`${SITE_URL}/api/print/poll`} />;
}
