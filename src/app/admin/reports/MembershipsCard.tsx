import Link from "next/link";
import InfoTip from "@/components/help/InfoTip";
import type { MembershipTotals } from "@/lib/membership-payments/rows";
import type { PaymentSyncStatus } from "@/lib/membership-payments/read";
import { Card, Delta, Rows, money, num } from "./ui";

// Insiders+ and gift memberships for a day, week or month: what Stripe
// charged (new members, renewals, switches to yearly), gifts, refunds, and
// the money and tax. They're in Collected as their own part, never as
// orders. Read from Stripe (src/lib/membership-payments/sync.ts).

const clock = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

// When Stripe was last read, or why it isn't.
export function syncNote(s: PaymentSyncStatus): string {
  if (!s.ready) return "Not counted yet: the member payments database update hasn't been applied.";
  if (!s.allowed) return s.keyMode === "none" ? "This server has no Stripe key, so it doesn't read payments." : "This copy of the site has Stripe's test key, so it doesn't read payments. The live site does.";
  if (s.lastError) return `The last read from Stripe didn't work${s.succeededAt ? `; these are as of ${clock(s.succeededAt)}` : ""}. It tries again in 10 minutes.`;
  return s.succeededAt ? `Read from Stripe ${clock(s.succeededAt)}.` : "Not read from Stripe yet.";
}

export default function MembershipsCard({
  m,
  before,
  prevName,
  ended,
  endedBefore,
  sync,
  href,
  title = "Insiders+ memberships",
  showMembersLink = true,
  className = "",
}: {
  title?: string;
  showMembersLink?: boolean; // "Members →" (not on the Members tab itself)
  m: MembershipTotals;
  before?: MembershipTotals; // the period before, to compare
  prevName?: string; // "last week"
  ended?: number | null; // Insiders+ subscriptions that ended (null: not known)
  endedBefore?: number | null;
  sync: PaymentSyncStatus;
  href?: (line: string) => string; // a line opens this (the Day drill-down)
  className?: string;
}) {
  const line = (key: string) => m.lines.find((l) => l.key === key);
  const count = (key: string, n: number, was?: number) => {
    const l = line(key);
    return (
      <span className="flex items-baseline gap-2">
        {was !== undefined && <Delta now={n} before={was} />}
        <span className={n ? "font-semibold" : "text-[var(--muted)]"}>{num(n)}</span>
        {l && <span className="w-20 text-right text-[var(--muted)]">{money(l.collected)}</span>}
      </span>
    );
  };
  const rows = [
    { key: "new_month", label: "New monthly", n: m.newMonthly, was: before?.newMonthly },
    { key: "new_year", label: "New yearly", n: m.newYearly, was: before?.newYearly },
    { key: "renewal", label: "Renewals", n: m.renewals, was: before?.renewals },
    ...(m.switches || before?.switches ? [{ key: "switch", label: "Switched monthly to yearly", n: m.switches, was: before?.switches }] : []),
    { key: "gift", label: "Gift memberships", n: m.gifts, was: before?.gifts },
    // No up/down arrow on refunds and cancellations: green there would read as good news.
    { key: "refund", label: "Refunds", n: m.refunds, was: undefined },
  ];

  return (
    <Card
      title={
        <>
          {title}
          <InfoTip topic="membership-payments" />
        </>
      }
      subtitle="Charged by Stripe, not the register: new members, renewals, switches to yearly, and gifts. In Collected, with their tax. Counted the day they were charged; a refund comes off the day of the charge."
      action={
        showMembersLink ? (
          <Link href="/admin/reports/members" className="font-medium underline-offset-2 hover:underline">
            Members →
          </Link>
        ) : undefined
      }
      className={className}
    >
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-3xl font-bold tabular-nums">{money(m.collected)}</span>
        {before && <Delta now={m.collected} before={before.collected} />}
        <span className="text-sm text-[var(--muted)]">
          {money(m.sales)} before tax · {money(m.tax)} tax
          {before && prevName ? ` · ${money(before.collected)} ${prevName}` : ""}
        </span>
      </div>
      <Rows
        rows={[
          ...rows.map((r) => ({
            key: r.key,
            label: r.label,
            value: count(r.key, r.n, before ? r.was : undefined),
            muted: !r.n,
            href: href && r.n ? href(r.key) : undefined,
          })),
          ...(ended !== undefined && ended !== null
            ? [
                {
                  key: "ended",
                  label: "Cancelled (subscription ended)",
                  value: (
                    <span className="flex items-baseline gap-2">
                      {endedBefore !== undefined && endedBefore !== null && prevName && (
                        <span className="text-xs text-[var(--muted)]">
                          {num(endedBefore)} {prevName}
                        </span>
                      )}
                      <span className={ended ? "font-semibold" : ""}>{num(ended)}</span>
                    </span>
                  ),
                  muted: !ended,
                },
              ]
            : []),
        ]}
      />
      {m.refunded > 0 && <p className="mt-2 text-xs text-[var(--muted)]">{money(m.refunded)} was given back in refunds, already taken off.</p>}
      <p className="mt-2 text-xs text-[var(--muted)]">{syncNote(sync)}</p>
    </Card>
  );
}
