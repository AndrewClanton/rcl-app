import { getTodaysCompletedOrders, getRecentOrders } from "@/lib/data/reports";
import ReportsPanel from "./ReportsPanel";

export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  const [todaysOrders, recentOrders] = await Promise.all([getTodaysCompletedOrders(), getRecentOrders()]);
  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Reports</h1>
      <ReportsPanel todaysOrders={todaysOrders} recentOrders={recentOrders} />
    </div>
  );
}
