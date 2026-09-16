import {
  getTodaysCompletedOrders,
  getRecentOrders,
  getRevenueTrend,
  getMembershipAnalytics,
  getAlcoholUsageReport,
  getPourCostReport,
} from "@/lib/data/reports";
import ReportsPanel from "./ReportsPanel";

export const dynamic = "force-dynamic";

const VALID_RANGES = [7, 30, 90];

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const params = await searchParams;
  const days = VALID_RANGES.includes(Number(params.days)) ? Number(params.days) : 30;

  const [todaysOrders, recentOrders, revenueTrend, membership, alcoholUsage, pourCost] = await Promise.all([
    getTodaysCompletedOrders(),
    getRecentOrders(),
    getRevenueTrend(days),
    getMembershipAnalytics(),
    getAlcoholUsageReport(days),
    getPourCostReport(),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Reports</h1>
      <ReportsPanel
        todaysOrders={todaysOrders}
        recentOrders={recentOrders}
        revenueTrend={revenueTrend}
        membership={membership}
        alcoholUsage={alcoholUsage}
        pourCost={pourCost}
        days={days}
      />
    </div>
  );
}
