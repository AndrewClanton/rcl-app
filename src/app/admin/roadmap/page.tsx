import Link from "next/link";
import { hasAdminAccess, requireManager } from "@/lib/auth";
import { getAdminRoadmap } from "@/lib/data/roadmap";
import { appVersion } from "@/lib/app-version";
import PageHeader from "@/components/admin/PageHeader";
import RoadmapManager from "./RoadmapManager";

export const dynamic = "force-dynamic";

// The list behind the public What's new page: everything shipped, being
// built, in line, and the ideas, plus the inbox of suggestions. Owners and
// admins run it; managers see it and log requests people make at the bar.
export default async function AdminRoadmapPage() {
  const staff = await requireManager();
  const data = await getAdminRoadmap();
  const owner = staff.role === "owner";
  return (
    <div>
      <PageHeader
        area="guests"
        title="Roadmap & What's new"
        purpose={
          <>
            One list for what&apos;s shipped, being built, in line and being considered. Public items show on{" "}
            <Link href="/whats-new" className="font-semibold underline">
              What&apos;s new
            </Link>
            , where members vote, leave notes and suggest ideas. Say yes to a request, then copy its link and send it to whoever asked.
          </>
        }
        actions={
          <Link href="/whats-new" target="_blank" className="btn-secondary inline-flex min-h-11 items-center !px-4 !py-2">
            Open What&apos;s new ↗
          </Link>
        }
      />
      <RoadmapManager items={data.items} inbox={data.inbox} decided={data.decided} canEdit={hasAdminAccess(staff.role)} version={owner ? appVersion().line : null} showVersions={owner} />
    </div>
  );
}
