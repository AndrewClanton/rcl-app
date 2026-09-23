import { notFound } from "next/navigation";
import { getStaffSession } from "@/lib/auth";
import { getCommunityPrograms, getMemberById, getMemberPurchaseHistory } from "@/lib/data/members";
import { getStaffInfoForMembers } from "@/lib/data/employees";
import MemberDetail from "./MemberDetail";

export const dynamic = "force-dynamic";

export default async function AdminMemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await getMemberById(id);
  if (!member) notFound();

  const [purchases, communityPrograms, session] = await Promise.all([getMemberPurchaseHistory(id), getCommunityPrograms(), getStaffSession()]);
  const staffInfo = await getStaffInfoForMembers([member], session?.employeeId ?? null);

  return <MemberDetail member={member} purchases={purchases} communityPrograms={communityPrograms} staffInfo={staffInfo[member.id]} />;
}
