import { notFound, redirect } from "next/navigation";
import { requireManager } from "@/lib/auth";
import { getAccount } from "@/lib/data/my-account";
import MyAccountView from "../../me/MyAccountView";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Team → one person: the same page as their My account, for managers and
// up (the names on Schedule and Timesheets link here). Your own goes to My
// account.
export default async function TeamPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireManager();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  if (id === staff.employeeId) redirect("/admin/me");
  const data = await getAccount(id);
  if (!data) notFound();
  return <MyAccountView data={data} self={false} canFix />;
}
