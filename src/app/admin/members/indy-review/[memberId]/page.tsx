import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { getIndyMemberOrders, OVER_LIMIT } from "@/lib/data/indy-review";

export const dynamic = "force-dynamic";

const usd = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// One member's Indy orders: what's behind their proposed points. Read-only.
export default async function IndyMemberPage({ params }: { params: Promise<{ memberId: string }> }) {
  await requireAdmin();
  const { memberId } = await params;
  const { member, orders } = await getIndyMemberOrders(memberId);
  const back = { href: "/admin/members/indy-review", label: "Indy history review" };
  if (!member) {
    return (
      <div className="space-y-6">
        <PageHeader area="guests" back={back} title="No Indy purchases" purpose="This member has no counted purchases in the Indy history." />
      </div>
    );
  }

  const facts: [string, string][] = [
    ["Proposed points", member.points.toLocaleString()],
    ["Purchases (tax in)", usd(member.purchaseCents)],
    ["Tax in that", usd(member.taxCents)],
    ["Orders", member.orders.toLocaleString()],
    ["First – last", `${member.firstAt?.slice(0, 10) ?? "—"} – ${member.lastAt?.slice(0, 10) ?? "—"}`],
    ["Indy balance (unreliable)", `${member.indyRemaining.toLocaleString()} · preloaded ${member.indyPreloaded.toLocaleString()}`],
    ["RCL points now", member.rclPoints.toLocaleString()],
    ["Card-history points", member.fortisPoints ? member.fortisPoints.toLocaleString() : "none"],
  ];
  const flags = [
    member.points > OVER_LIMIT && `Over ${OVER_LIMIT.toLocaleString()}: needs a manual look`,
    member.staff && (member.indyEmployee ? "Staff (marked employee in Indy)" : "Staff"),
    member.fortisPoints && "Already got points from past card purchases: some of these visits may be counted twice",
    member.sameName && "Another member has the same name",
    member.phoneOther && "The Indy phone number belongs to a different member",
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <PageHeader
        area="guests"
        back={back}
        title={member.name}
        purpose={
          <>
            {member.email ?? "No email"} · matched by {member.matchKinds} ·{" "}
            <Link className="underline" href={`/admin/members/${member.memberId}`}>
              member page
            </Link>
          </>
        }
      />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <div className="text-xs text-[var(--muted)]">{k}</div>
            <div className="font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </section>
      {flags.length > 0 && (
        <ul className="list-disc rounded-xl border border-[var(--accent)] px-8 py-3 text-sm">
          {flags.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <h2 className="border-b border-[var(--border)] px-4 py-3 font-semibold">
          Indy orders <span className="text-sm font-normal text-[var(--muted)]">newest first · greyed lines don&apos;t count toward points</span>
        </h2>
        <div className="divide-y divide-[var(--border)]">
          {orders.map((o) => (
            <div key={o.orderId} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="font-medium tabular-nums">{o.paidAt?.slice(0, 16) ?? "not paid"}</span>
                  {o.showing && <span className="ml-2 text-[var(--muted)]">{o.showing}</span>}
                  {o.orderState && o.orderState !== "completed" && <span className="ml-2 rounded-full border border-[var(--border)] px-2 text-xs">{o.orderState}</span>}
                </div>
                <div className="tabular-nums">
                  Counts <b>{usd(o.countedCents)}</b> <span className="text-[var(--muted)]">(tax {usd(o.taxCents)})</span>
                </div>
              </div>
              <ul className="mt-1 space-y-0.5">
                {o.lines.map((l, i) => (
                  <li key={i} className={`flex justify-between gap-3 ${l.counts ? "" : "text-[var(--muted)] line-through decoration-[var(--border)]"}`}>
                    <span>
                      {l.description}
                      <span className="ml-1 text-xs text-[var(--muted)]">
                        {l.type}
                        {l.state !== "paid" ? ` · ${l.state}` : ""}
                      </span>
                    </span>
                    <span className="tabular-nums whitespace-nowrap">
                      {usd(l.priceCents)}
                      {l.taxCents ? ` + ${usd(l.taxCents)} tax` : ""}
                      {l.discountCents ? ` − ${usd(l.discountCents)} off` : ""}
                      {l.voucherCents ? ` (${usd(l.voucherCents)} by voucher)` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              {o.payments.length > 0 && (
                <div className="mt-1 text-xs text-[var(--muted)]">
                  Paid:{" "}
                  {o.payments
                    .map(
                      (p) =>
                        `${usd(p.amountCents)} ${p.type ?? ""}${p.subtype ? ` (${p.subtype})` : ""}${p.cardType ? ` ${p.cardType}` : ""}${p.lastFour ? ` …${p.lastFour}` : ""}${p.state && p.state !== "completed" ? ` [${p.state}]` : ""}`,
                    )
                    .join(" · ")}
                </div>
              )}
            </div>
          ))}
          {orders.length === 0 && <p className="px-4 py-6 text-sm text-[var(--muted)]">No Indy orders.</p>}
        </div>
      </section>
    </div>
  );
}
