import { getMembers } from "@/lib/data/members";
import MemberManager from "./MemberManager";

export const dynamic = "force-dynamic";

export default async function AdminMembersPage() {
  const members = await getMembers();
  return <MemberManager members={members} />;
}
