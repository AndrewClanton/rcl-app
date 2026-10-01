import { requireStaff, hasManagerAccess } from "@/lib/auth";
import { getSignals, getTodayBoard, navBadges } from "@/lib/data/backoffice";
import { getPinStatus } from "@/lib/data/employees";
import { getHomeExtras } from "@/lib/data/home";
import { navFor } from "./_nav/map";
import { defaultShortcuts, hrefsForPatterns, shortcutEntries } from "./_nav/shortcuts";
import TodayView from "./TodayView";

export const dynamic = "force-dynamic";

const ROLE_PLURAL: Record<string, string> = { owner: "the owners", admin: "admins", manager: "managers", cashier: "staff" };

// Back office → Today (the home page): your shortcuts, tonight at a
// glance, anything that needs a look, the week ahead, and quick links
// grouped the same way as the menu. The layout is in TodayView.tsx.
export default async function AdminDashboardPage() {
  const staff = await requireStaff();
  const [signals, board, pin, extras] = await Promise.all([getSignals(staff.role), getTodayBoard(staff), getPinStatus(staff.employeeId), getHomeExtras(staff)]);
  const nav = navFor(staff.role);
  const entries = shortcutEntries(nav.find);
  return (
    <TodayView
      signals={signals}
      board={board}
      extras={extras}
      badges={navBadges(signals, pin)}
      nav={nav}
      manager={hasManagerAccess(staff.role)}
      shortcuts={{
        employeeId: staff.employeeId,
        entries,
        fromRole: hrefsForPatterns((extras.roleTop ?? []).map((p) => p.pattern), entries),
        defaults: defaultShortcuts(staff.role),
        roleName: ROLE_PLURAL[staff.role] ?? "staff",
      }}
    />
  );
}
