import { requireStaff } from "@/lib/auth";
import { getSalesTaxReport } from "@/lib/data/reports";
import { businessDay } from "@/lib/ops/time";
import { ensureMemberPaymentsFresh } from "@/lib/membership-payments/sync";
import { getPaymentSyncStatus } from "@/lib/membership-payments/read";
import TaxScreen, { quarterOf } from "./TaxScreen";

export const dynamic = "force-dynamic";

// Reports -> Sales tax: collected for the Missouri return, by month or by
// quarter (?period=2026-09 or ?period=2026-Q3). Figures come from
// src/lib/data/reports.ts (getSalesTaxReport), which says what's counted
// and how refunds are handled.
export default async function SalesTaxPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const { period: asked } = await searchParams;
  const thisMonth = businessDay().date.slice(0, 7);
  const wanted = asked && asked <= (asked.includes("Q") ? quarterOf(thisMonth) : thisMonth) ? asked : thisMonth;
  await requireStaff();
  // Insiders+ charges are read from Stripe first if it's been a while.
  await ensureMemberPaymentsFresh();
  const [found, sync] = await Promise.all([getSalesTaxReport(wanted), getPaymentSyncStatus()]);
  const report = found ?? (await getSalesTaxReport(thisMonth))!;
  return <TaxScreen report={report} thisMonth={thisMonth} sync={sync} />;
}
