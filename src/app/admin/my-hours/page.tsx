import { hasManagerAccess, requireStaff } from "@/lib/auth";
import { shiftDate } from "@/lib/ops/time";
import { getForgottenClockOuts, getTimesheet, openShiftOwner, thisWeek } from "@/lib/data/team";
import MyHoursView from "./MyHoursView";

export const dynamic = "force-dynamic";

// Anyone signed in to the back office checks their own hours here (display
// screens can't get this far; the back office layout turns them away). The
// numbers are Team → Timesheets' own, for one person. The register's "My
// hours" links here with its shift, since the person on shift at the iPad
// isn't always the one signed in on it; only a shift that's open right now
// works that way.
export default async function MyHoursPage({ searchParams }: { searchParams: Promise<{ shift?: string | string[] }> }) {
  const staff = await requireStaff();
  const { shift } = await searchParams;
  const fromRegister = typeof shift === "string" && shift.length > 0;
  const owner = fromRegister ? await openShiftOwner(shift) : null;
  const who = owner ?? { employeeId: staff.employeeId, name: staff.name };

  const current = thisWeek();
  const weeks = [0, 1, 2, 3].map((i) => shiftDate(current, -7 * i)); // this week first
  const [sheets, forgotten] = await Promise.all([Promise.all(weeks.map((w) => getTimesheet(w, who.employeeId).then((p) => p[0] ?? null))), getForgottenClockOuts(who.employeeId)]);

  return (
    <MyHoursView
      name={who.name}
      self={who.employeeId === staff.employeeId}
      fromRegister={fromRegister}
      canFix={hasManagerAccess(staff.role)}
      weeks={weeks}
      sheets={sheets}
      forgotten={forgotten}
    />
  );
}
