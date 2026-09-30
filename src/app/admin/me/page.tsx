import { notFound } from "next/navigation";
import { hasManagerAccess, requireStaff } from "@/lib/auth";
import { getAccount } from "@/lib/data/my-account";
import MyAccountView from "./MyAccountView";

export const dynamic = "force-dynamic";

// Back office → My account: your own shifts, hours this pay period,
// calendar, what you've done lately and what you rang. Opened by tapping
// your name in the menu. Always the signed-in person's own; managers see
// anyone's from Team (../team/[id]).
export default async function MyAccountPage() {
  const staff = await requireStaff();
  const data = await getAccount(staff.employeeId);
  if (!data) notFound();
  return <MyAccountView data={data} self canFix={hasManagerAccess(staff.role)} />;
}
