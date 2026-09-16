import { notFound } from "next/navigation";
import { getCommunityPrograms, getMemberById, getMemberPurchaseHistory } from "@/lib/data/members";
import MemberDetail from "./MemberDetail";

export const dynamic = "force-dynamic";

export default async function AdminMemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await getMemberById(id);
  if (!member) notFound();

  const [purchases, communityPrograms] = await Promise.all([getMemberPurchaseHistory(id), getCommunityPrograms()]);

  return <MemberDetail member={member} purchases={purchases} communityPrograms={communityPrograms} />;
}
