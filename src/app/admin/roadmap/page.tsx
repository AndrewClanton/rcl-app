import { hasAdminAccess, requireManager } from "@/lib/auth";
import { getAdminRoadmap } from "@/lib/data/roadmap";
import { appVersion } from "@/lib/app-version";
import RoadmapManager from "./RoadmapManager";

export const dynamic = "force-dynamic";

function renderTime() {
  return Date.now();
}

// The list behind the public What's new page, drawn like it: everything
// shipped, being built, in line, and the ideas, plus the inbox of
// suggestions. Owners and admins run it; managers see it and log requests
// people make at the bar. The page header is drawn by RoadmapManager, so
// its buttons can open the add and log sheets.
export default async function AdminRoadmapPage() {
  const staff = await requireManager();
  const data = await getAdminRoadmap();
  const owner = staff.role === "owner";
  return (
    <RoadmapManager
      items={data.items}
      inbox={data.inbox}
      decided={data.decided}
      canEdit={hasAdminAccess(staff.role)}
      version={owner ? appVersion().line : null}
      showVersions={owner}
      // One clock for the server's render and the browser's, so "Updated 3
      // min ago" reads the same in both.
      now={renderTime()}
    />
  );
}
