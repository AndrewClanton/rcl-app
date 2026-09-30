import Link from "next/link";
import type { LedgerEntry } from "@/lib/data/member-account";
import type { VisitSummary } from "@/lib/visits-server";
import { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";
import { VISIT_POINTS } from "@/lib/visits";
import { CARD_UNDO_NOTE } from "@/lib/card-match";
import { dateShort, points } from "../format";
import { Empty, Panel, SpecPanel } from "../ui";
import { BadgeCabinet, StreakPanel } from "./Badges";

// notTheirs: sales found by a card that turned out not to be theirs (an
// Undo at the register): no receipt link, since the sale isn't theirs.
function describe(l: LedgerEntry, notTheirs: Set<string>): { title: string; href: string | null } {
  const receipt = l.orderId ? (notTheirs.has(l.orderId) ? null : `/account/purchases/order/${l.orderId}`) : l.bookingId ? `/account/purchases/ticket/${l.bookingId}` : null;
  switch (l.reason) {
    case "purchase":
      return { title: `Earned on ${l.note ?? "a purchase"}`, href: receipt };
    case "redeem":
      return { title: `Used for ${l.note ?? `$${REWARD_VALUE} off`}`, href: receipt };
    case "refund":
      if (l.note === CARD_UNDO_NOTE) return { title: "Taken back: not your card", href: null };
      return { title: "Purchase refunded", href: receipt };
    case "welcome_bonus":
      return { title: l.note ?? "Welcome bonus", href: null };
    case "opening_balance":
      return { title: "Starting balance", href: null };
    case "visit":
      return { title: "Check-in", href: null };
    case "badge":
      return { title: `Badge: ${l.note ?? "earned"}`, href: null };
    default:
      return { title: l.note && l.note !== "Adjusted by staff" ? `Adjusted by staff: ${l.note}` : "Adjusted by staff", href: null };
  }
}

export default function PointsView({ balance, ledger, visits, birthday }: { balance: number; ledger: LedgerEntry[]; visits: VisitSummary; birthday: string | null }) {
  const earned = ledger.filter((l) => l.delta > 0 && l.reason !== "opening_balance").reduce((s, l) => s + l.delta, 0);
  // (Math.abs: no redemptions would otherwise show as "-0".)
  const used = Math.abs(ledger.filter((l) => l.reason === "redeem").reduce((s, l) => s + l.delta, 0));
  const notTheirs = new Set(ledger.filter((l) => l.reason === "refund" && l.note === CARD_UNDO_NOTE && l.orderId).map((l) => l.orderId as string));

  return (
    <div className="space-y-10">
      <SpecPanel
        title="Your points"
        aside={`${POINTS_PER_REWARD} = $${REWARD_VALUE} off`}
        cells={[
          { k: "Balance", v: points(Math.floor(balance)), hot: true },
          { k: "Earned", v: points(Math.round(earned)) },
          { k: "Used", v: points(Math.round(used)) },
        ]}
      />

      <StreakPanel visits={visits} />

      <BadgeCabinet visits={visits} birthday={birthday} />

      <Panel title="How points work">
        <ul className="grid gap-4 p-5 text-[15px] sm:grid-cols-2">
          <li>
            <strong>1 point for every $1</strong> at the bar, kitchen and box office, and on tickets bought online.
          </li>
          <li>
            <strong>
              {POINTS_PER_REWARD} points = ${REWARD_VALUE} off
            </strong>
            . Ask at the register when you order.
          </li>
          <li>
            <strong>{VISIT_POINTS} points every check-in</strong>, once a day: type your phone on the tablet at the door.
          </li>
          <li>
            <strong>Badges</strong> pay bonus points once each. Come in every week to keep your streak going.
          </li>
          <li className="text-[var(--muted)]">Points land the moment your purchase goes through. Refunds take back the points that purchase earned.</li>
          <li className="text-[var(--muted)]">At the register, make sure staff attach your account: scan your member card or give your name.</li>
        </ul>
      </Panel>

      <section>
        <h2 className="font-display mb-4 text-2xl">History</h2>
        {ledger.length === 0 ? (
          <Empty>No points activity yet.</Empty>
        ) : (
          <div className="sheet overflow-x-auto">
            <table className="w-full min-w-[520px] text-[15px]">
              <thead>
                <tr className="border-b-2 border-[var(--foreground)] text-left">
                  <th className="spec-k px-4 py-3">Date</th>
                  <th className="spec-k px-4 py-3">What happened</th>
                  <th className="spec-k px-4 py-3 text-right">Change</th>
                  <th className="spec-k px-4 py-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => {
                  const d = describe(l, notTheirs);
                  return (
                    <tr key={l.id} className="border-t border-[var(--border)]">
                      <td className="spec-code whitespace-nowrap px-4 py-3">{dateShort(l.createdAt)}</td>
                      <td className="px-4 py-3">
                        {d.href ? (
                          <Link href={d.href} className="font-bold hover:underline">
                            {d.title}
                          </Link>
                        ) : (
                          d.title
                        )}
                      </td>
                      <td className={`font-display whitespace-nowrap px-4 py-3 text-right tabular-nums ${l.delta < 0 ? "text-[var(--accent)]" : "text-[var(--success-text)]"}`}>
                        {l.delta > 0 ? "+" : "−"}
                        {points(Math.abs(l.delta))}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{points(l.balanceAfter)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-sm text-[var(--muted)]">Something look wrong? Email info@royalecinemajoplin.com or ask at the box office and we&apos;ll sort it out.</p>
      </section>
    </div>
  );
}
