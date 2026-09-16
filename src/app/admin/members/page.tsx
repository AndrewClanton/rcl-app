import { getCommunityPrograms, getMembersPage } from "@/lib/data/members";
import MemberManager from "./MemberManager";

export const dynamic = "force-dynamic";

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; comped?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const [membersPage, communityPrograms] = await Promise.all([
    getMembersPage({ query: params.q, page, compedOnly: params.comped === "1" }),
    getCommunityPrograms(),
  ]);

  return <MemberManager membersPage={membersPage} communityPrograms={communityPrograms} query={params.q ?? ""} compedOnly={params.comped === "1"} />;
}
