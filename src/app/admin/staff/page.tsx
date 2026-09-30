import { requireOwner } from "@/lib/auth";
import { getEmployees } from "@/lib/data/employees";
import PageHeader from "@/components/admin/PageHeader";
import StaffPanel from "./StaffPanel";

export const dynamic = "force-dynamic";

export default async function AdminStaffPage() {
  await requireOwner();
  const employees = await getEmployees();
  return (
    <div>
      <PageHeader area="setup" title="Staff logins & access" purpose="Who can sign in, and what each person can do. Only owners can see this page or change roles." />
      <StaffPanel employees={employees} />
    </div>
  );
}
