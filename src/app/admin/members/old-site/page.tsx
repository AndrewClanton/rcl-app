import { requireAdmin } from "@/lib/auth";
import { getLegacyPage, getLegacySummary, LEGACY_PAGE_SIZE, type LegacyGroup } from "@/lib/data/legacy";
import OldSiteReview from "./OldSiteReview";

export const dynamic = "force-dynamic";

const GROUPS: LegacyGroup[] = ["review", "paying", "likely_real", "bot"];

// Accounts pulled from the old site: review the automatic sort, override
// anything that looks wrong, then copy the approved ones into Members.
// Admin/owner only -- this lists ~13,000 people's contact details.
export default async function OldSiteImportPage({ searchParams }: { searchParams: Promise<{ group?: string; q?: string; page?: string }> }) {
  await requireAdmin();
  const params = await searchParams;
  const summary = await getLegacySummary();
  const group: LegacyGroup = GROUPS.includes(params.group as LegacyGroup) ? (params.group as LegacyGroup) : summary.awaitingReview > 0 ? "review" : "paying";
  const page = await getLegacyPage({ group, query: params.q, page: Number(params.page) || 1 });

  return <OldSiteReview summary={summary} group={group} query={params.q ?? ""} page={page} pageSize={LEGACY_PAGE_SIZE} />;
}
