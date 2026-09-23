import { getStaffSession } from "@/lib/auth";
import { getCommunityPrograms, getMembersPage } from "@/lib/data/members";
import { getStaffInfoForMembers } from "@/lib/data/employees";
import MemberManager from "./MemberManager";

export const dynamic = "force-dynamic";

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; comped?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const [membersPage, communityPrograms, session] = await Promise.all([
    getMembersPage({ query: params.q, page, compedOnly: params.comped === "1" }),
    getCommunityPrograms(),
    getStaffSession(),
  ]);
  const staffInfo = await getStaffInfoForMembers(membersPage.members, session?.employeeId ?? null);

  return (
    <MemberManager
      membersPage={membersPage}
      communityPrograms={communityPrograms}
      staffInfo={staffInfo}
      query={params.q ?? ""}
      compedOnly={params.comped === "1"}
    />
  );
}
