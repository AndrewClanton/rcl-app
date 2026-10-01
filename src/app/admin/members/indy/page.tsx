import { requireAdmin } from "@/lib/auth";
import { getIndyPage, getIndySummary, INDY_PAGE_SIZE, INDY_TABS, type IndyTab } from "@/lib/data/indy";
import IndyReview from "./IndyReview";

export const dynamic = "force-dynamic";
// The Import button's server action works for about 75 seconds a press.
export const maxDuration = 120;

// People from Indy, the ticketing system before this app: review the
// automatic sort, pick for the conflicts, approve the new people, then copy
// them into Members. (An old ?tab=said_no link lands on New.) Admin/owner only -- this lists ~1,500
// people's contact details.
export default async function IndyImportPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; page?: string }> }) {
  await requireAdmin();
  const params = await searchParams;
  const tab: IndyTab = INDY_TABS.includes(params.tab as IndyTab) ? (params.tab as IndyTab) : "new";
  const [summary, page] = await Promise.all([getIndySummary(), getIndyPage({ tab, query: params.q, page: Number(params.page) || 1 })]);

  return <IndyReview summary={summary} tab={tab} query={params.q ?? ""} page={page} pageSize={INDY_PAGE_SIZE} />;
}
