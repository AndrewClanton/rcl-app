import { requireManager } from "@/lib/auth";
import { getPrintersOverview } from "@/lib/data/printers";
import { SITE_URL } from "@/lib/site";
import { getPatternSettings } from "@/lib/print/pattern-settings";
import { DEFAULT_PATTERN_SETTINGS } from "@/lib/print/receipt-patterns";
import PrintersAdmin from "./PrintersAdmin";

export const dynamic = "force-dynamic";

// Back office -> Printers, for managers and up: the receipt printers at the
// bar and the outdoor stand and the kitchen's order-ticket printer, which
// collect their print jobs from the website (lib/print/queue.ts).
export default async function PrintersPage() {
  await requireManager();
  const [{ printers, jobs }, patterns] = await Promise.all([getPrintersOverview(), getPatternSettings().catch(() => DEFAULT_PATTERN_SETTINGS)]);
  return <PrintersAdmin printers={printers} jobs={jobs} pollUrl={`${SITE_URL}/api/print/poll`} patterns={patterns} />;
}
