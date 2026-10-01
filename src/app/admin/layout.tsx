import Link from "next/link";
import { cookies } from "next/headers";
import { requireStaff, hasAdminAccess, hasManagerAccess } from "@/lib/auth";
import { getPinStatus } from "@/lib/data/employees";
import { getSignals, navBadges } from "@/lib/data/backoffice";
import AdminErrorBar from "./AdminErrorBar";
import AdminShell from "./_nav/AdminShell";
import { navFor } from "./_nav/map";
import { RAIL_COOKIE } from "./_nav/prefs";

// The back office's frame: the menu (a sidebar on an iPad or computer, a
// drawer on a phone), grouped by the job and cut down to what this
// person's role can open, with live counts on it. The pages themselves
// still check the role (requireManager() and friends) -- hiding a link is
// never the security.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const [signals, pinStatus, jar] = await Promise.all([getSignals(staff.role), getPinStatus(staff.employeeId), cookies()]);
  const nav = navFor(staff.role);

  return (
    <AdminShell
      nav={nav}
      badges={navBadges(signals, pinStatus)}
      me={{ id: staff.employeeId, name: staff.name, role: staff.role }}
      canNote={hasAdminAccess(staff.role)}
      initialRail={jar.get(RAIL_COOKIE)?.value === "rail"}
    >
      {/* Everyone started on 9999, and it keeps working until they pick
          their own -- this nags until they do (src/app/admin/my-pin). */}
      {(pinStatus === "default" || pinStatus === "temporary") && (
        <div className="notice notice-warn mb-6 flex flex-wrap items-center justify-between gap-2 print:hidden">
          <span>
            {pinStatus === "default" ? "Your PIN is still 9999, the one everyone knows. Pick your own." : "You're on a temporary PIN the owner set. Pick your own."}
            {hasManagerAccess(staff.role) && " Until you do, anyone who knows it can approve refunds as you."}
          </span>
          <Link href="/admin/my-pin" className="inline-flex min-h-11 items-center font-bold underline">
            Set my PIN
          </Link>
        </div>
      )}
      {children}
      <AdminErrorBar />
    </AdminShell>
  );
}
