import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { getOwnerStatement } from "@/lib/data/owner-tab";
import { OWNER_PRICING_LABEL } from "@/lib/register-totals";
import { SITE_NAME, THEATER_ADDRESS } from "@/lib/site";
import { RemovedNote, StatusPill, day, money, plainDate, time } from "../ui";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

// One owner's monthly owner-tab statement, made to print: every order at
// the owner rate with the menu price beside it, the tax, what's been paid
// against it and what's left. Owners only, like the Owner tab page.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OwnerStatementPage({ searchParams }: { searchParams: Promise<{ owner?: string; month?: string }> }) {
  const session = await requireOwner();
  const p = await searchParams;
  const owner = p.owner ?? "";
  const month = p.month ?? "";
  if (!UUID.test(owner) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) notFound();
  const s = await getOwnerStatement(session, owner, month);
  if (!s) notFound();
  const m = s.month;
  const counted = s.orders.filter((o) => !o.refunded);

  return (
    <div className="mx-auto max-w-3xl space-y-5 print:max-w-none">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/admin/owner-tab" className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
          <span aria-hidden>←</span> Owner tab
        </Link>
        <PrintButton />
      </div>

      <header className="border-b-2 border-[var(--foreground)] pb-3">
        <div className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">{SITE_NAME}</div>
        <div className="text-xs text-[var(--muted)]">
          {THEATER_ADDRESS.streetAddress}, {THEATER_ADDRESS.addressLocality}, {THEATER_ADDRESS.addressRegion} {THEATER_ADDRESS.postalCode}
        </div>
        <h1 className="mt-2 text-2xl font-bold leading-tight">Owner tab statement</h1>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span className="font-semibold">{s.person.name}</span>
          <span>{m.label}</span>
          <StatusPill m={m} />
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Figure label="Menu value" value={money(m.menuValue)} />
        <Figure label="At the owner rate" value={money(m.sales)} />
        <Figure label="Sales tax" value={money(m.tax)} />
        <Figure label={m.status === "running" ? "So far" : "Statement total"} value={money(m.owed)} strong />
      </section>

      {s.orders.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Nothing on the tab in {m.label}.</p>
      ) : (
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-[var(--muted)]">
              <th className="pb-1.5 pr-2 font-medium">Date</th>
              <th className="pb-1.5 pr-2 font-medium">Item</th>
              <th className="pb-1.5 pr-2 text-right font-medium">Menu</th>
              <th className="pb-1.5 pr-2 text-right font-medium">Owner</th>
              <th className="pb-1.5 text-right font-medium">Order</th>
            </tr>
          </thead>
          <tbody>
            {s.orders.map((o) => {
              const last = o.lines.length - 1;
              return o.lines.map((l, i) => (
                <tr key={`${o.id}-${i}`} className={`${i === 0 ? "border-t border-[var(--border)]" : ""} align-top ${o.refunded ? "text-[var(--muted)] line-through" : ""}`}>
                  <td className="whitespace-nowrap py-1 pr-2">
                    {i === 0 && (
                      <>
                        {day(o.at)}
                        <span className="block text-xs text-[var(--muted)]">
                          #{o.orderNumber} · {time(o.at)}
                        </span>
                        {o.refunded && <RemovedNote order={o} suffix=" (not counted)" />}
                      </>
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    {l.qty > 1 ? `${l.qty} × ` : ""}
                    {l.name}
                    <span className="block text-xs text-[var(--muted)]">{[...l.mods, OWNER_PRICING_LABEL[l.how]].join(", ")}</span>
                  </td>
                  <td className="py-1 pr-2 text-right text-[var(--muted)]">{money(l.menuUnit * l.qty)}</td>
                  <td className="py-1 pr-2 text-right">{money(l.ownerUnit * l.qty)}</td>
                  <td className="py-1 text-right">
                    {i === last && (
                      <>
                        <span className="font-semibold">{money(o.total)}</span>
                        <span className="block text-xs text-[var(--muted)]">incl. {money(o.tax)} tax</span>
                      </>
                    )}
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      )}

      <section className="ml-auto max-w-sm text-sm">
        <Row label={`${counted.length} order${counted.length === 1 ? "" : "s"} at the owner rate`} value={money(m.sales)} />
        <Row label="Sales tax" value={money(m.tax)} />
        <Row label="Statement total" value={money(m.owed)} strong />
        {s.payments.map((x) => (
          <Row key={x.id} label={`Paid ${plainDate(x.paidOn)} by ${x.method}${x.note ? ` (${x.note})` : ""}`} value={`−${money(x.amount)}`} muted />
        ))}
        <Row label={m.balance < 0 ? "Paid more than owed" : m.status === "running" ? "Owed so far" : "Left to pay"} value={money(Math.abs(m.balance))} strong />
        <p className="mt-2 text-xs text-[var(--muted)]">
          The owner rate saved {money(Math.max(0, m.menuValue - m.sales))} against menu prices this month. Menu items are at cost from their recipes where the recipe
          cost is marked complete, otherwise half price; tickets and custom items at their normal price.
        </p>
      </section>

      {s.payments.length > 0 && (
        <p className="text-xs text-[var(--muted)] print:hidden">
          Payments recorded by {[...new Set(s.payments.map((x) => x.recordedBy ?? "someone"))].join(", ")}.
        </p>
      )}
    </div>
  );
}

function Figure({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border)] px-3 py-2">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className={`tabular-nums ${strong ? "text-lg font-bold" : "font-semibold"}`}>{value}</div>
    </div>
  );
}

function Row({ label, value, strong = false, muted = false }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 border-b border-[var(--border)] py-1 ${strong ? "font-semibold" : ""} ${muted ? "text-[var(--muted)]" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
