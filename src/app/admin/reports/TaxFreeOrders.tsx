import { taxFreeCallout, taxFreeLine, type TaxFreeOrder } from "@/lib/tax-exempt";
import { Card, money } from "./ui";

// Register orders rung up tax-free, explained (lib/tax-exempt.ts): a
// one-line callout for the top of a day, and the list. Used by the Day,
// Week and Month reports and the Sales tax tab; the nightly email has its
// own copy of the same lines (lib/email/daily-digest-email.ts).

// "1 tax-free order today: $0.44 of tax not charged." Nothing when none.
export function TaxFreeCallout({ orders, when }: { orders: TaxFreeOrder[]; when: string }) {
  const text = taxFreeCallout(orders, when);
  if (!text) return null;
  return (
    <p role="note" className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] px-3 py-2 text-sm text-[var(--warn-text)]">
      {text} Who marked {orders.length === 1 ? "it" : "them"} and why is under Tax-free orders below.
    </p>
  );
}

// "Oct 2, 8:41 PM · $5.00 · $0.44 not charged · marked by Andrew · Courtesy",
// one per order. Nothing when none.
export function TaxFreeOrdersCard({ orders, className }: { orders: TaxFreeOrder[]; className?: string }) {
  if (!orders.length) return null;
  const notCharged = Math.round(orders.reduce((s, o) => s + o.taxNotCharged, 0) * 100) / 100;
  return (
    <Card
      title={`Tax-free orders · ${orders.length}`}
      subtitle={`${money(notCharged)} of sales tax not charged. Each needs a manager's PIN and a reason; orders from before reasons were recorded show who rang them up.`}
      className={className}
    >
      <ul className="space-y-1.5 text-sm tabular-nums">
        {orders.map((o) => (
          <li key={o.id}>
            {taxFreeLine(o)} <span className="text-[var(--muted)]">· #{o.orderNumber}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
