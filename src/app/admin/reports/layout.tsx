import { getStaffSession, hasManagerAccess } from "@/lib/auth";
import ReportsNav from "./ReportsNav";

// Every report shares the tabs: Day, Week, Month, Box office, Sales tax,
// Bar usage, Members, and for managers and up, Website usage. Each page
// checks the staff sign-in itself as well as the back office's layout (a
// layout alone doesn't guard a page's data); here the role only decides
// which tabs show.
export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaffSession();
  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between gap-3 print:hidden">
        <h1 className="text-2xl font-bold">Reports</h1>
      </div>
      <ReportsNav manager={!!staff && hasManagerAccess(staff.role)} />
      {children}
    </div>
  );
}
