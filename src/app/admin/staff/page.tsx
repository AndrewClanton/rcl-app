import { requireOwner } from "@/lib/auth";
import { getEmployees } from "@/lib/data/employees";
import StaffPanel from "./StaffPanel";

export const dynamic = "force-dynamic";

export default async function AdminStaffPage() {
  await requireOwner();
  const employees = await getEmployees();
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Staff & access</h1>
      <p className="mb-4 text-sm text-[var(--muted)]">
        Who has admin access. Only you (the owner) can see this page or change roles.
      </p>
      <StaffPanel employees={employees} />
    </div>
  );
}
