import Link from "next/link";
import type { MembershipAnalytics } from "@/lib/data/reports";
import type { MembersPayments } from "@/lib/membership-payments/read";
import { TIERS } from "@/lib/membership-payments/rows";
import MembershipsCard, { syncNote } from "../MembershipsCard";
import { BarList, Card, Rows, Stat, money, num } from "../ui";
import RereadButton from "./RereadButton";

// Reports -> Members, as drawn: the page (./page.tsx) checks the sign-in
// and gets the figures.

const TIER_LABEL = { adult: "Adult", senior: "Senior", student: "Student" } as const;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" });

export default function MembersScreen({ m, payments: p, canReread }: { m: MembershipAnalytics; payments: MembersPayments; canReread: boolean }) {
  const [thisMonth, lastMonth] = p.months;
  const monthly = TIERS.reduce((s, t) => s + p.plans.month[t], 0);
  const yearly = TIERS.reduce((s, t) => s + p.plans.year[t], 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat hero className="col-span-2" label="All members" value={num(m.total)} sub={`${num(m.newThisMonth)} joined this month`} />
        <Stat label="Insiders+ paying" value={num(m.payingInsidersPlus)} sub={p.plans.total ? `${num(monthly)} monthly · ${num(yearly)} yearly` : "on Stripe billing"} />
        <Stat label="Free through a program" value={num(m.compedMembers)} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Insiders+ by plan" subtitle="Everyone Stripe is billing now, by what they pay. Insiders+ set by hand, complimentary or gifted isn't here (Stripe never charges it).">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-[var(--muted)]">
                <th className="pb-1.5 font-medium" />
                <th className="pb-1.5 text-right font-medium">Monthly</th>
                <th className="pb-1.5 text-right font-medium">Yearly</th>
                <th className="pb-1.5 text-right font-medium">Both</th>
              </tr>
            </thead>
            <tbody>
              {TIERS.map((t) => (
                <tr key={t} className="border-t border-[var(--border)]">
                  <td className="py-1.5 pr-2">{TIER_LABEL[t]}</td>
                  <td className="py-1.5 text-right">{num(p.plans.month[t])}</td>
                  <td className="py-1.5 text-right">{num(p.plans.year[t])}</td>
                  <td className="py-1.5 text-right">{num(p.plans.month[t] + p.plans.year[t])}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-[var(--foreground)] font-semibold">
                <td className="pt-1.5 pr-2">Paying</td>
                <td className="pt-1.5 text-right">{num(monthly)}</td>
                <td className="pt-1.5 text-right">{num(yearly)}</td>
                <td className="pt-1.5 text-right">{num(monthly + yearly)}</td>
              </tr>
            </tbody>
          </table>
          {(p.plans.trialing > 0 || p.plans.pastDue > 0 || p.plans.unknown > 0) && (
            <div className="mt-3">
              <Rows
                rows={[
                  ...(p.plans.trialing ? [{ key: "t", label: "Card saved, first charge still to come", value: num(p.plans.trialing), muted: true }] : []),
                  ...(p.plans.pastDue ? [{ key: "d", label: "A renewal didn't go through (Stripe is retrying)", value: num(p.plans.pastDue), muted: true }] : []),
                  ...(p.plans.unknown ? [{ key: "u", label: "Paying, plan not known yet", value: num(p.plans.unknown), muted: true }] : []),
                  { key: "all", label: "On Stripe billing", value: num(p.plans.total), strong: true },
                ]}
              />
            </div>
          )}
        </Card>

        <MembershipsCard
          title={`${thisMonth.label} so far`}
          showMembersLink={false}
          m={thisMonth.totals}
          before={lastMonth.totals}
          prevName={`in ${lastMonth.label}`}
          ended={thisMonth.ended}
          endedBefore={lastMonth.ended}
          sync={p.sync}
        />

        <Card title="Renewing in the next 7 days" subtitle="When Stripe charges them next, from their last payment.">
          {!p.tracked ? (
            <p className="text-sm text-[var(--muted)]">{syncNote(p.sync)}</p>
          ) : p.renewing.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Nobody renews in the next 7 days.</p>
          ) : (
            <Rows
              rows={p.renewing.map((r, i) => ({
                key: `${r.memberId ?? "x"}-${i}`,
                label: (
                  <>
                    {r.memberId ? (
                      <Link href={`/admin/members/${r.memberId}`} className="underline-offset-2 hover:underline">
                        {r.name ?? "Member"}
                      </Link>
                    ) : (
                      "Not linked to a member"
                    )}
                    <span className="ml-1.5 text-xs text-[var(--muted)]">
                      {r.plan} · last {money(r.last)}
                    </span>
                  </>
                ),
                value: day(r.on),
              }))}
            />
          )}
        </Card>

        <Card title="Recent membership payments" subtitle="The last 25 Stripe charged or gave back, newest first.">
          {!p.tracked ? (
            <p className="text-sm text-[var(--muted)]">{syncNote(p.sync)}</p>
          ) : p.recent.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No membership payments read yet.</p>
          ) : (
            <Rows
              rows={p.recent.map((l) => ({
                key: l.id,
                muted: l.kind === "refund",
                label: (
                  <>
                    <span className="text-xs text-[var(--muted)]">{day(l.paidAt)} · </span>
                    {l.label}
                    <span className="block text-xs text-[var(--muted)]">
                      {l.memberId ? (
                        <Link href={`/admin/members/${l.memberId}`} className="underline-offset-2 hover:underline">
                          {l.memberName ?? "Member"}
                        </Link>
                      ) : (
                        "not linked to a member"
                      )}
                      {` · ${money(l.tax)} tax`}
                      {l.status === "refunded" ? " · refunded" : l.status === "partly_refunded" ? " · partly refunded" : ""}
                    </span>
                  </>
                ),
                value: <span className="font-semibold">{money(l.amount)}</span>,
              }))}
            />
          )}
        </Card>

        <Card title="Membership mix">
          <Rows
            rows={[
              { label: "Insiders (free)", value: num(m.insiders) },
              { label: "Insiders+ paying (Stripe billing)", value: num(m.payingInsidersPlus) },
              { label: "Insiders+ not billed (set by hand, complimentary or gifted)", value: num(m.insidersPlus - m.payingInsidersPlus) },
              { label: "Free through a community program", value: num(m.compedMembers) },
              { label: "Joined this month", value: num(m.newThisMonth) },
              { label: "All members", value: num(m.total), strong: true },
            ]}
          />
        </Card>
        <Card title="Free members by community program" subtitle="For grant and impact reporting.">
          {m.byProgram.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No community-program members yet.</p>
          ) : (
            <BarList rows={m.byProgram.map(({ program, count }) => ({ label: program, value: count }))} format={num} />
          )}
        </Card>
      </div>

      <Card title="Reading payments from Stripe" className="text-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-prose text-[var(--muted)]">
            {syncNote(p.sync)} Reports read new charges by themselves (every 10 minutes while they&apos;re open, and each morning before the daily email). Re-reading goes back
            to launch and never counts a payment twice.
          </p>
          {canReread && p.sync.ready && p.sync.allowed && <RereadButton />}
        </div>
      </Card>
    </div>
  );
}
