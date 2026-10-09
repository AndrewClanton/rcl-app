import { requireAdmin } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { getIndyReviewData, OVER_LIMIT } from "@/lib/data/indy-review";
import IndyReview from "./IndyReview";

export const dynamic = "force-dynamic";

const usd = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// What the old Indy register's history would turn into as points, for the
// owners to check before anything is given. Read-only: nothing on this page
// grants points or changes a member. Admin/owner only: it lists customers'
// names, emails and orders.
export default async function IndyReviewPage() {
  await requireAdmin();
  const data = await getIndyReviewData();
  const proposed = data.members.filter((m) => m.points > 0);
  const sum = (list: typeof proposed) => list.reduce((s, m) => s + m.points, 0);
  const over = proposed.filter((m) => m.points > OVER_LIMIT);
  const under = proposed.filter((m) => m.points <= OVER_LIMIT);
  const staff = proposed.filter((m) => m.staff);
  const fortis = proposed.filter((m) => (m.fortisPoints ?? 0) > 0);
  const dollars = proposed.reduce((s, m) => s + m.purchaseCents, 0);
  const tax = proposed.reduce((s, m) => s + m.taxCents, 0);
  const mt = data.matching;

  const tiles: { label: string; value: string; note?: string }[] = [
    { label: "Members", value: proposed.length.toLocaleString(), note: "with Indy purchases" },
    { label: "Proposed points", value: sum(proposed).toLocaleString(), note: "1 point per $1" },
    { label: "Dollars behind them", value: usd(dollars), note: `${usd(tax)} of it tax` },
    { label: `${OVER_LIMIT.toLocaleString()} or under`, value: under.length.toLocaleString(), note: `${sum(under).toLocaleString()} points` },
    { label: `Over ${OVER_LIMIT.toLocaleString()}`, value: over.length.toLocaleString(), note: `${sum(over).toLocaleString()} points · max ${Math.max(0, ...over.map((m) => m.points)).toLocaleString()}` },
    { label: "Staff", value: staff.length.toLocaleString(), note: `${sum(staff).toLocaleString()} points (included)` },
    { label: "Already have card-history points", value: fortis.length.toLocaleString(), note: `${sum(fortis).toLocaleString()} proposed on top` },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        area="guests"
        back={{ href: "/admin/members", label: "Members" }}
        title="Indy history review"
        purpose={
          <>
            What the old Indy register&apos;s purchases would turn into as points. Look only: nothing here gives anyone points yet. Click a member to see
            the orders behind their number.
          </>
        }
        actions={
          <button
            type="button"
            disabled
            title="Nothing is given out until the owners have gone through the specifics."
            className="cursor-not-allowed rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)] opacity-60"
          >
            Approve (not yet enabled)
          </button>
        }
      />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <div className="text-xs text-[var(--muted)]">{t.label}</div>
            <div className="text-xl font-semibold tabular-nums">{t.value}</div>
            {t.note && <div className="text-xs text-[var(--muted)]">{t.note}</div>}
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm leading-relaxed">
        <h2 className="mb-1 font-semibold">How the numbers are made</h2>
        <ul className="list-disc space-y-1 pl-5 text-[var(--muted)]">
          <li>
            <b className="text-[var(--foreground)]">Counted:</b> paid Indy order lines for food and drink, tickets, other items and booking fees: price plus tax,
            minus discounts. Not counted: tips, memberships, gift card and voucher purchases, donations, credit adjustments, and anything voided or still
            open. Each member&apos;s total is rounded down to whole dollars.
          </li>
          <li>
            <b className="text-[var(--foreground)]">Matching:</b> {mt.matched.toLocaleString()} of {mt.indyUsers.toLocaleString()} Indy accounts matched a
            member (
            {Object.entries(mt.byKind)
              .map(([k, v]) => `${v.toLocaleString()} by ${k === "indy_id" ? "Indy id" : k}`)
              .join(", ")}
            ; a match only counts when exactly one member has that email or phone). {mt.unmatchedBuyers.toLocaleString()} Indy buyers matched no member (
            {usd(mt.unmatchedCents)}), and {mt.noUserOrders.toLocaleString()} orders had no Indy account on them at all ({usd(mt.noUserCents)}).
          </li>
          <li>
            <b className="text-[var(--foreground)]">Indy&apos;s own balances</b> are shown for comparison only: they&apos;re unreliable. Indy&apos;s points
            file has {data.indyLedger.remaining.toLocaleString()} unused points for these members; the users file says{" "}
            {data.indyLedger.preloaded.toLocaleString()} were preloaded.
          </li>
          <li>
            <b className="text-[var(--foreground)]">Card history:</b> no Indy card payment is linked to a card-machine sale yet, so a member who already got
            points from past card purchases may have some of the same visits counted twice. Those members are flagged.
          </li>
        </ul>
      </section>

      <IndyReview members={data.members} unmatched={data.unmatched} giftCards={data.giftCards} vouchers={data.vouchers} overLimit={OVER_LIMIT} />
    </div>
  );
}
