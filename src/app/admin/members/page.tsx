import Link from "next/link";
import { getStaffSession, hasAdminAccess, hasManagerAccess } from "@/lib/auth";
import { getCommunityPrograms, getMembersPage } from "@/lib/data/members";
import { getStaffInfoForMembers } from "@/lib/data/employees";
import { getLegacySummary } from "@/lib/data/legacy";
import PageHeader from "@/components/admin/PageHeader";
import MemberManager from "./MemberManager";

export const dynamic = "force-dynamic";

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; comped?: string; removed?: string; warn?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  // Who's looking decides how much contact info comes back: a cashier sees
  // emails and phones shortened (lib/contact-mask.ts). No session can't
  // happen under the admin layout, but would get the cashier view.
  const session = await getStaffSession();
  const [membersPage, communityPrograms] = await Promise.all([
    getMembersPage({ query: params.q, page, compedOnly: params.comped === "1", viewerRole: session?.role ?? "cashier" }),
    getCommunityPrograms(),
  ]);
  const staffInfo = await getStaffInfoForMembers(membersPage.members, session?.employeeId ?? null);
  const legacy = session && hasAdminAccess(session.role) ? await getLegacySummary() : null;
  const legacyTotal = legacy ? Object.values(legacy.groups).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-4">
      <PageHeader
        area="guests"
        title="Members"
        purpose="Find a member by name, email or phone to see their details, points and Insiders+. Adding a member and the free community programs are below the list (on a computer, beside it)."
      />
      {params.removed === "1" && (
        <div className="notice notice-success text-sm">
          <strong>Personal info removed.</strong> Reply to their request to let them know it&apos;s done. The privacy page promises a confirmation
          email.
          {params.warn && <div className="mt-1 text-[var(--warn-text)]">{params.warn}</div>}
        </div>
      )}
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
      {session && hasAdminAccess(session.role) && (
        <Link
          href="/admin/members/duplicates"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm hover:border-[var(--foreground)]"
        >
          <span>
            <span className="font-semibold">Possible duplicates</span> · two accounts for one person (often one made at the door tablet), to merge
          </span>
          <span className="text-[var(--muted)]">Review →</span>
        </Link>
      )}
      {session && hasManagerAccess(session.role) && (
        <Link
          href="/admin/members/former-unlimited"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm hover:border-[var(--foreground)]"
        >
          <span>
            <span className="font-semibold">Former unlimited members</span> · paid for unlimited on the old website: who&apos;s set up here yet
          </span>
          <span className="text-[var(--muted)]">See the list →</span>
        </Link>
      )}
      {session && hasManagerAccess(session.role) && (
        <Link
          href="/admin/members/regulars"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm hover:border-[var(--foreground)]"
        >
          <span>
            <span className="font-semibold">Top regulars</span> · who came in most and spent most this month, for prizes
          </span>
          <span className="text-[var(--muted)]">See the list →</span>
        </Link>
      )}
      {session && hasManagerAccess(session.role) && (
        <Link
          href="/admin/members/past-purchases"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm hover:border-[var(--foreground)]"
        >
          <span>
            <span className="font-semibold">◀◀ Rewind: points from past card purchases</span> · find a regular&apos;s visits from before the new system and
            surprise them with the points
          </span>
          <span className="text-[var(--muted)]">{hasAdminAccess(session.role) ? "Review →" : "Rewind →"}</span>
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
