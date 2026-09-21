import {
  getTodaysCompletedOrders,
  getRecentOrders,
  getRevenueTrend,
  getMembershipAnalytics,
  getAlcoholUsageReport,
  getPourCostReport,
  getCashAllocationForDate,
} from "@/lib/data/reports";
import ReportsPanel from "./ReportsPanel";
import CashAllocationReport from "./CashAllocationReport";

export const dynamic = "force-dynamic";

const VALID_RANGES = [7, 30, 90];

function todayCentral() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const params = await searchParams;
  const days = VALID_RANGES.includes(Number(params.days)) ? Number(params.days) : 30;
  const today = todayCentral();

  const [todaysOrders, recentOrders, revenueTrend, membership, alcoholUsage, pourCost, cashAllocation] = await Promise.all([
    getTodaysCompletedOrders(),
    getRecentOrders(),
    getRevenueTrend(days),
    getMembershipAnalytics(),
    getAlcoholUsageReport(days),
    getPourCostReport(),
    getCashAllocationForDate(today),
  ]);

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Reports</h1>
      <div className="space-y-8">
        <CashAllocationReport initialDate={today} initial={cashAllocation} />
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
    </div>
  );
}
