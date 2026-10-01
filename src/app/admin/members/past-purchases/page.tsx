import { hasAdminAccess, requireManager } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { BACKFILL_PAGE_SIZE, BACKFILL_TABS, getBackfillData, type BackfillTab } from "@/lib/data/fortis-backfill";
import BackfillReview from "./BackfillReview";
import Rewind from "./Rewind";

export const dynamic = "force-dynamic";

// Points for card purchases made before the new system (Fortis).
// Managers and up get Rewind at the top: find a regular's card from a
// purchase or two on their bank app, assign it and give the points.
// Owners and admins also get the review below -- every card, how it was
// matched, the rate, and Grant -- since it lists the names on customers'
// cards.
export default async function PastPurchasesPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; page?: string }> }) {
  const staff = await requireManager();
  const isAdmin = hasAdminAccess(staff.role);
  const rewind = <Rewind isAdmin={isAdmin} />;
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader
          area="guests"
          back={{ href: "/admin/members", label: "Members" }}
          title="Points from past card purchases"
          purpose={
            <>
              Regulars paid by card for years before the new system and started it at 0 points. A regular whose card is found here gets points for those
              visits. Members see it in their points history as &ldquo;Points from your past visits&rdquo;.
            </>
          }
        />
        {rewind}
      </div>
    );
  }
  const p = await searchParams;
  const asked = BACKFILL_TABS.includes(p.tab as BackfillTab) ? (p.tab as BackfillTab) : null;
  let data = await getBackfillData({ tab: asked ?? "review", query: p.q, page: Number(p.page) || 1 });
  // Nothing left to review: open on what's next.
  let tab: BackfillTab = asked ?? "review";
  if (!asked && data.summary.tabs.review === 0) {
    tab = data.summary.tabs.approved > 0 ? "approved" : data.summary.tabs.pick > 0 ? "pick" : "granted";
    data = await getBackfillData({ tab, query: p.q, page: Number(p.page) || 1 });
  }
  return <BackfillReview data={data} tab={tab} query={p.q ?? ""} pageSize={BACKFILL_PAGE_SIZE} rewind={rewind} />;
}
