import Link from "next/link";
import { requireMember } from "@/lib/member-auth";
import { getPointsLedger, type LedgerEntry } from "@/lib/data/member-account";
import { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/points";
import { dateShort, points } from "../format";

export const metadata = { title: "Points" };

function describe(l: LedgerEntry): { title: string; href: string | null } {
  const receipt = l.orderId ? `/account/purchases/order/${l.orderId}` : l.bookingId ? `/account/purchases/ticket/${l.bookingId}` : null;
  switch (l.reason) {
    case "purchase":
      return { title: `Earned on ${l.note ?? "a purchase"}`, href: receipt };
    case "redeem":
      return { title: `Used for ${l.note ?? `$${REWARD_VALUE} off`}`, href: receipt };
    case "refund":
      return { title: "Purchase refunded", href: receipt };
    case "welcome_bonus":
      return { title: l.note ?? "Welcome bonus", href: null };
    case "opening_balance":
      return { title: "Starting balance", href: null };
    default:
      return { title: l.note && l.note !== "Adjusted by staff" ? `Adjusted by staff: ${l.note}` : "Adjusted by staff", href: null };
  }
}

export default async function PointsPage() {
  const member = await requireMember();
  const ledger = await getPointsLedger(member.id);
  const earned = ledger.filter((l) => l.delta > 0 && l.reason !== "opening_balance").reduce((s, l) => s + l.delta, 0);
  const used = -ledger.filter((l) => l.reason === "redeem").reduce((s, l) => s + l.delta, 0);
  const balance = Number(member.points);

  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Balance" value={points(Math.floor(balance))} strong />
        <Stat label="Earned" value={points(Math.round(earned))} />
        <Stat label="Used" value={points(Math.round(used))} />
      </div>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-sm">
        <h2 className="font-display mb-2 text-lg">How points work</h2>
        <ul className="grid gap-1.5 text-[var(--muted)] sm:grid-cols-2">
          <li>
            <strong className="text-[var(--foreground)]">1 point for every $1</strong> at the bar, kitchen and box office, and on tickets bought online.
          </li>
          <li>
            <strong className="text-[var(--foreground)]">
              {POINTS_PER_REWARD} points = ${REWARD_VALUE} off
            </strong>
            . Ask at the register when you order.
          </li>
          <li>Points land the moment your purchase goes through. Refunds take back the points that purchase earned.</li>
          <li>At the register, make sure staff attach your account: scan your member card or give your name.</li>
        </ul>
      </section>

      <section>
        <h2 className="font-display mb-3 text-xl">History</h2>
        {ledger.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-sm text-[var(--muted)]">No points activity yet.</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
                  <th className="px-4 py-2.5 font-bold">Date</th>
                  <th className="px-4 py-2.5 font-bold">What happened</th>
                  <th className="px-4 py-2.5 text-right font-bold">Change</th>
                  <th className="px-4 py-2.5 text-right font-bold">Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => {
                  const d = describe(l);
                  return (
                    <tr key={l.id} className="border-t border-[var(--border)]">
                      <td className="whitespace-nowrap px-4 py-3 text-[var(--muted)]">{dateShort(l.createdAt)}</td>
                      <td className="px-4 py-3">
                        {d.href ? (
                          <Link href={d.href} className="hover:underline">
                            {d.title}
                          </Link>
                        ) : (
                          d.title
                        )}
                      </td>
                      <td className={`whitespace-nowrap px-4 py-3 text-right font-bold tabular-nums ${l.delta < 0 ? "text-[var(--accent)]" : "text-[var(--success-text)]"}`}>
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
        <p className="mt-3 text-xs text-[var(--muted)]">
          Something look wrong? Email info@royalecinemajoplin.com or ask at the box office and we&apos;ll sort it out.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${strong ? "border-2 border-[var(--foreground)] bg-[var(--gold)]" : "border-[var(--border)] bg-[var(--surface)]"}`}>
      <div className="text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">{label}</div>
      <div className="font-display mt-1 text-3xl tabular-nums">{value}</div>
    </div>
  );
}
