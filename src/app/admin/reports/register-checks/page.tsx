import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { getCardPaymentsWithNoSale, getRegisterFlags } from "@/lib/data/register-checks";
import { businessDay, clock, shortDay } from "@/lib/ops/time";
import DateJump from "../DateJump";
import { Card, money } from "../ui";

export const dynamic = "force-dynamic";

// Reports -> Register checks (managers and up): card payments the register
// took that have no sale behind them, for a business day (?date=2026-10-02,
// today by default), and what the server flagged about register sales,
// newest first. Figures from src/lib/data/register-checks.ts; the flags are
// written by src/lib/register-sale-checks.ts. Read only.
export default async function RegisterChecksPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requireManager();
  const { date: asked } = await searchParams;
  const today = businessDay().date;
  const date = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today;
  const [orphans, flags] = await Promise.all([getCardPaymentsWithNoSale(date), getRegisterFlags()]);
  const dayName = date === today ? "today" : shortDay(`${date}T17:00:00Z`);

  return (
    <div className="space-y-5">
      <Card
        title="Card payments with no sale"
        subtitle={`Cards the register charged ${date === today ? "today" : `on ${dayName}`} (4 a.m. to 4 a.m.) that no order points to: the money was taken, but the sale never saved. Match each to what was sold around that time; if nobody should have paid it, refund it in Stripe. Stripe's search runs a minute or so behind.`}
        action={<DateJump date={date} max={today} path="/admin/reports/register-checks" label="Pick a business day" />}
      >
        {!orphans.ok ? (
          <p className="text-sm text-[var(--danger-text)]">Couldn&apos;t check Stripe: {orphans.error}</p>
        ) : orphans.payments.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            {orphans.checked === 0 ? `No card payments on the register ${date === today ? "yet today" : `on ${dayName}`}.` : `All ${orphans.checked} card payment${orphans.checked === 1 ? "" : "s"} ${date === today ? "today" : `on ${dayName}`} have a sale.`}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {orphans.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 text-sm">
                <span className="font-semibold tabular-nums">{money(p.amount)}</span>
                <span className="text-xs text-[var(--muted)]">
                  {clock(p.at)} · {p.source}
                  {p.card ? ` · ${p.card}` : ""}
                  {p.tip > 0 ? ` · ${money(p.tip)} tip` : ""}
                </span>
                {p.refunded > 0 && <span className="text-xs text-[var(--success-text)]">{money(p.refunded)} refunded</span>}
                {p.voidedOrder !== null && <span className="text-xs text-[var(--muted)]">its order #{p.voidedOrder} was voided</span>}
                {p.flags.map((f) => (
                  <span key={f} className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs">
                    {f}
                  </span>
                ))}
                <a href={p.stripeUrl} target="_blank" rel="noreferrer" className="ml-auto text-xs underline-offset-2 hover:underline">
                  Open in Stripe
                </a>
              </li>
            ))}
          </ul>
        )}
        {orphans.ok && orphans.more && <p className="mt-2 text-xs text-[var(--muted)]">Only the first 500 of each kind were checked.</p>}
      </Card>

      <Card title="Flagged sales" subtitle="What the server wanted a person to look at, newest first: totals that didn't add up, card payments it refused, tabs paid twice, sales staff stopped trying to save. The last 100.">
        {!flags.ok ? (
          <p className="text-sm text-[var(--muted)]">
            {flags.missing ? "Flags need a database update first (migration 20261001100000_register_sale_flags.sql). Until then they're only in the server log." : `Couldn't load the flags: ${flags.error}`}
          </p>
        ) : flags.flags.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nothing flagged.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {flags.flags.map((f) => (
              <li key={f.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs font-semibold">{f.label}</span>
                  {f.orderNumber !== null ? (
                    <Link href={`/admin/reports?date=${f.day}&order=${f.orderNumber}`} className="font-semibold underline-offset-2 hover:underline">
                      #{f.orderNumber}
                    </Link>
                  ) : (
                    <span className="text-xs text-[var(--muted)]">no order</span>
                  )}
                  <span className="text-xs text-[var(--muted)]">
                    {shortDay(f.at)}, {clock(f.at)}
                    {f.cashier ? ` · ${f.cashier}` : ""}
                  </span>
                  {f.amount !== null && <span className="ml-auto font-semibold tabular-nums">{money(f.amount)}</span>}
                </div>
                <p className="mt-1 text-[var(--muted)]">{f.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
