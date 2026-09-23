import Link from "next/link";
import { getStaffSession, hasAdminAccess } from "@/lib/auth";
import { getCommunityPrograms, getMembersPage } from "@/lib/data/members";
import { getStaffInfoForMembers } from "@/lib/data/employees";
import { getLegacySummary } from "@/lib/data/legacy";
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
  const legacy = session && hasAdminAccess(session.role) ? await getLegacySummary() : null;
  const legacyTotal = legacy ? Object.values(legacy.groups).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-4">
      {legacy && legacyTotal > 0 && (
        <Link
          href="/admin/members/old-site"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm hover:border-[var(--foreground)]"
        >
          <span>
            <span className="font-semibold">Old site members</span> · {legacy.imported.toLocaleString()} imported ·{" "}
            {legacy.toImport.toLocaleString()} approved, waiting
            {legacy.awaitingReview > 0 && <> · <span className="text-[var(--accent)]">{legacy.awaitingReview} need review</span></>}
          </span>
          <span className="text-[var(--muted)]">Review →</span>
        </Link>
      )}
      <MemberManager
        membersPage={membersPage}
        communityPrograms={communityPrograms}
        staffInfo={staffInfo}
        query={params.q ?? ""}
        compedOnly={params.comped === "1"}
      />
    </div>
  );
}
