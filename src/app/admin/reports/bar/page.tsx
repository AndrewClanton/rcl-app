import { requireStaff } from "@/lib/auth";
import { getAlcoholUsageReport, getPourCostReport } from "@/lib/data/reports";
import BarScreen, { BAR_RANGES } from "./BarScreen";

export const dynamic = "force-dynamic";

// Reports -> Bar usage: are drinks costing what they should? Pour cost per
// drink, and what recipes say was poured against what the shelf counts say
// left (?days=7|30|90).
export default async function BarUsagePage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: asked } = await searchParams;
  const days = BAR_RANGES.includes(Number(asked)) ? Number(asked) : 30;
  const [, usage, pour] = await Promise.all([requireStaff(), getAlcoholUsageReport(days), getPourCostReport()]);
  return <BarScreen days={days} usage={usage} pour={pour} />;
}
