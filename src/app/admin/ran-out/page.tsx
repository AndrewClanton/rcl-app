import { hasAdminAccess, requireStaff } from "@/lib/auth";
import { getRanOutBoard } from "@/lib/data/ran-out";
import PageHeader from "@/components/admin/PageHeader";
import InfoTip from "@/components/help/InfoTip";
import RanOutView from "./RanOutView";

export const dynamic = "force-dynamic";

// Back office → Ran out. The ran-out email's "Back in stock" link lands
// here (?id= the report), so any signed-in staff member can open it; who
// gets the email is for owners and admins.
export default async function RanOutPage({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const staff = await requireStaff("/admin/ran-out");
  const [{ id }, board] = await Promise.all([searchParams, getRanOutBoard()]);
  return (
    <div>
      <PageHeader
        area="stock"
        title="Ran out"
        titleAside={<InfoTip topic="ran-out-alerts" />}
        purpose="Things staff reported out on the register. The buyers get an email the moment it happens; mark it back in stock here once it's restocked. Running out before the week is over usually means the par is too low."
      />
      <RanOutView board={board} focusId={typeof id === "string" ? id.toLowerCase() : null} canEditAlerts={hasAdminAccess(staff.role)} />
    </div>
  );
}
