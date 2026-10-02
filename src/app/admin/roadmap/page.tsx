import { hasAdminAccess, requireManager } from "@/lib/auth";
import { getAdminRoadmap } from "@/lib/data/roadmap";
import { appVersion } from "@/lib/app-version";
import RoadmapManager from "./RoadmapManager";

export const dynamic = "force-dynamic";

function renderTime() {
  return Date.now();
}

// The crew's roadmap, staff only: everything shipped, being built, in line,
// and the ideas. Owners and admins run it; managers see it and log requests
// people make at the bar. The page header is drawn by RoadmapManager, so
// its buttons can open the add and log sheets.
export default async function AdminRoadmapPage() {
  const staff = await requireManager();
  const items = await getAdminRoadmap();
  const owner = staff.role === "owner";
  return (
    <RoadmapManager
      items={items}
      canEdit={hasAdminAccess(staff.role)}
      version={owner ? appVersion().line : null}
      showVersions={owner}
      // One clock for the server's render and the browser's, so "Updated 3
      // min ago" reads the same in both.
      now={renderTime()}
    />
  );
}
