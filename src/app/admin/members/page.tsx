import { getCommunityPrograms, getMembers } from "@/lib/data/members";
import MemberManager from "./MemberManager";

export const dynamic = "force-dynamic";

export default async function AdminMembersPage() {
  const [members, communityPrograms] = await Promise.all([getMembers(), getCommunityPrograms()]);
  return <MemberManager members={members} communityPrograms={communityPrograms} />;
}
