import { requireAdmin } from "@/lib/auth";
import { BACKFILL_PAGE_SIZE, BACKFILL_TABS, getBackfillData, type BackfillTab } from "@/lib/data/fortis-backfill";
import BackfillReview from "./BackfillReview";

export const dynamic = "force-dynamic";

// Points for card purchases made before the new system (Fortis): review
// how each card was matched to a member, choose the rate, and grant.
// Owners and admins only -- it lists the names on customers' cards.
export default async function PastPurchasesPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; page?: string }> }) {
  await requireAdmin();
  const p = await searchParams;
  const asked = BACKFILL_TABS.includes(p.tab as BackfillTab) ? (p.tab as BackfillTab) : null;
  let data = await getBackfillData({ tab: asked ?? "review", query: p.q, page: Number(p.page) || 1 });
  // Nothing left to review: open on what's next.
  let tab: BackfillTab = asked ?? "review";
  if (!asked && data.summary.tabs.review === 0) {
    tab = data.summary.tabs.approved > 0 ? "approved" : data.summary.tabs.pick > 0 ? "pick" : "granted";
    data = await getBackfillData({ tab, query: p.q, page: Number(p.page) || 1 });
  }
  return <BackfillReview data={data} tab={tab} query={p.q ?? ""} pageSize={BACKFILL_PAGE_SIZE} />;
}
