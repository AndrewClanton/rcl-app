import Link from "next/link";
import PageHeader from "@/components/admin/PageHeader";
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
      <PageHeader
        area="money"
        title="Reports"
        purpose="How we're doing: sales by day, week and month, the box office for distributors, sales tax, the bar and members."
        actions={
          <Link href="/admin/reports/daily" className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] px-3 text-sm hover:border-[var(--foreground)]">
            Daily email
          </Link>
        }
        className="!mb-3 print:hidden"
      />
      <ReportsNav manager={!!staff && hasManagerAccess(staff.role)} />
      {children}
    </div>
  );
}
