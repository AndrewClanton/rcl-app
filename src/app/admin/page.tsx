import { requireStaff, hasManagerAccess } from "@/lib/auth";
import { getSignals, getTodayBoard, navBadges } from "@/lib/data/backoffice";
import { getPinStatus } from "@/lib/data/employees";
import { navFor } from "./_nav/map";
import TodayView from "./TodayView";

export const dynamic = "force-dynamic";

// Back office → Today (the dashboard): tonight at a glance, anything that
// needs a look, and quick links grouped the same way as the menu. The
// layout is in TodayView.tsx.
export default async function AdminDashboardPage() {
  const staff = await requireStaff();
  const [signals, board, pin] = await Promise.all([getSignals(staff.role), getTodayBoard(staff), getPinStatus(staff.employeeId)]);
  return <TodayView signals={signals} board={board} badges={navBadges(signals, pin)} nav={navFor(staff.role)} manager={hasManagerAccess(staff.role)} />;
}
