import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { businessDay } from "@/lib/ops/time";
import { getOwnerTabOverview, monthLabel, type OwnerMonth, type OwnerTabOrder, type OwnerTabPerson } from "@/lib/data/owner-tab";
import { OWNER_PRICING_LABEL } from "@/lib/register-totals";
import { ownerPriceList, type OwnerPriceRow } from "@/lib/owner-rate-server";
import OwnerRatePeople from "./OwnerRatePeople";
import RecordPayment from "./RecordPayment";
import { RemovedNote, StatusPill, day, money, plainDate, statementHref, time } from "./ui";

export const dynamic = "force-dynamic";

// Back office -> Owner tab (owners only): what each owner had at the owner
// rate this month, line by line, their earlier months and whether each is
// settled, a printable statement, recording a payment, and who gets the
// owner rate. The data is lib/data/owner-tab.ts; the register side is
// pos/OwnerRateModal.tsx and completeOwnerTabOrder in pos/actions.ts.

export default async function OwnerTabPage() {
  await requireOwner();
  const [o, prices] = await Promise.all([getOwnerTabOverview(), ownerPriceList()]);
  const today = businessDay().date;
  const shown = o.people.filter((p) => p.ticked || (o.current[p.id]?.length ?? 0) > 0);
  const earlier = o.people.flatMap((p) => p.months.filter((m) => m.month < o.thisMonth && (m.orders > 0 || m.paid > 0)).map((m) => ({ p, m })));
  const payable = o.people.map((p) => ({
    id: p.id,
    firstName: p.firstName,
    // Oldest first: the statement to settle next.
    months: p.months
      .filter((m) => m.balance > 0.005)
      .reverse()
      .map((m) => ({ month: m.month, label: m.label, balance: m.balance, running: m.status === "running" })),
  }));
  const payments = o.people.flatMap((p) => p.payments.map((x) => ({ ...x, owner: p.firstName }))).sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="space-y-6">
      <PageHeader
        area="money"
        title="Owner tab"
        purpose="What the owners had at the owner rate, and what they've paid. The register rings it up as usual, the owner types their own PIN, and it goes on their tab for the month instead of being paid. Each month they settle it in one payment."
      />

      {!o.ready && (
        <p className="notice notice-warn !p-3 text-sm">The owner tab needs its database update first (supabase/migrations/20261003060000_owner_tab.sql). Until then the register doesn&apos;t offer the owner rate.</p>
      )}

      <section aria-labelledby="month-heading" className="space-y-4">
        <h2 id="month-heading" className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
          {monthLabel(o.thisMonth)} so far
        </h2>
        {shown.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nobody gets the owner rate yet. Tick who does under &ldquo;Who gets the owner rate&rdquo; below.</p>
        ) : (
          shown.map((p) => <MonthCard key={p.id} person={p} orders={o.current[p.id] ?? []} month={p.months.find((m) => m.month === o.thisMonth)} />)
        )}
      </section>

      <section aria-labelledby="earlier-heading" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
        <h2 id="earlier-heading" className="text-base font-semibold">
          Earlier months
        </h2>
        <p className="mt-1 text-xs text-[var(--muted)]">Each month&apos;s statement: at cost, with tax. Orders taken off the tab aren&apos;t on it.</p>
        {earlier.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">No earlier months yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-[var(--muted)]">
                  <th className="pb-1.5 pr-2 font-medium">Owner</th>
                  <th className="pb-1.5 pr-2 font-medium">Month</th>
                  <th className="pb-1.5 pr-2 text-right font-medium">Orders</th>
                  <th className="pb-1.5 pr-2 text-right font-medium">Menu value</th>
                  <th className="pb-1.5 pr-2 text-right font-medium">Statement</th>
                  <th className="pb-1.5 pr-2 text-right font-medium">Paid</th>
                  <th className="pb-1.5 pr-2 font-medium" />
                  <th className="pb-1.5" />
                </tr>
              </thead>
              <tbody>
                {earlier.map(({ p, m }) => (
                  <tr key={`${p.id}-${m.month}`} className="border-t border-[var(--border)]">
                    <td className="py-2 pr-2 font-medium">{p.firstName}</td>
                    <td className="py-2 pr-2">{m.label}</td>
                    <td className="py-2 pr-2 text-right">{m.orders}</td>
                    <td className="py-2 pr-2 text-right text-[var(--muted)]">{money(m.menuValue)}</td>
                    <td className="py-2 pr-2 text-right font-semibold">{money(m.owed)}</td>
                    <td className="py-2 pr-2 text-right">{money(m.paid)}</td>
                    <td className="py-2 pr-2">
                      <StatusPill m={m} />
                    </td>
                    <td className="py-2 text-right">
                      <Link href={statementHref(p.id, m.month)} className="inline-flex min-h-11 items-center whitespace-nowrap underline-offset-2 hover:underline">
                        Statement →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {o.ready && (
        <RecordPayment key={payable.map((x) => x.months.map((m) => `${m.month}:${m.balance}`).join(",")).join("|")} owners={payable} today={today} />
      )}

      {payments.length > 0 && (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
          <h2 className="text-base font-semibold">Payments recorded</h2>
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {payments.slice(0, 24).map((x) => (
              <li key={x.id} className="flex items-baseline gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{x.owner}</span>, {monthLabel(x.month)} · {x.method}
                  <span className="block text-xs text-[var(--muted)]">
                    Paid {plainDate(x.paidOn)} · recorded {day(x.at)} {time(x.at)}
                    {x.recordedBy ? ` by ${x.recordedBy}` : ""}
                    {x.note ? ` · ${x.note}` : ""}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{money(x.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {o.ready && <OwnerRatePeople candidates={o.candidates} />}

      {o.ready && o.rateChanges.length > 0 && (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
          <h2 className="text-base font-semibold">Changes to who gets it</h2>
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {o.rateChanges.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
                <span>
                  <span className="font-medium">{c.person}</span> {c.on ? "gets the owner rate" : "no longer gets the owner rate"}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {day(c.at)} {time(c.at)}
                  {c.by ? ` · by ${c.by}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {prices && <Prices rows={prices} />}

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
        <h2 className="text-base font-semibold">How the owner rate is priced</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[var(--muted)]">
          <li>
            A menu item is at cost when a manager has ticked &ldquo;Recipe cost is complete&rdquo; on its recipe (Menu, the item, Recipe) and every ingredient in it has a
            cost on Ingredients &amp; counts: each ingredient&apos;s amount times its cost. Never more than the menu price.
          </li>
          <li>
            Anything else (no recipe, the tick not on, an ingredient with no cost): half the menu price, marked &ldquo;{OWNER_PRICING_LABEL.half}&rdquo;. Nothing is
            ticked to start with, and adding or taking off an ingredient unticks it, so a recipe missing something is never &ldquo;at cost&rdquo;.
          </li>
          <li>Options and add-ons have no recipes of their own, so what they add to the price is charged at half.</li>
          <li>Movie tickets and custom items are their normal price. Sales tax is charged as on any sale and owed with the tab.</li>
          <li>No member discount, daily coffee, reward or points with it. Reports show it on its own line, and it&apos;s money in when it&apos;s paid.</li>
          <li>
            A wrong one comes off the tab in Reports (the order, Take off tab) with another owner&apos;s PIN, not the tab owner&apos;s, and a reason. The statement shows who
            took it off and why.
          </li>
          <li>Staff who aren&apos;t owners see only a total for the owner tab in Reports: no names, statements or payments.</li>
        </ul>
      </section>
    </div>
  );
}

// One owner's month so far: every line, with the menu price, the owner
// price and how it was priced, each order's tax, and the running total.
function MonthCard({ person, orders, month }: { person: OwnerTabPerson; orders: OwnerTabOrder[]; month: OwnerMonth | undefined }) {
  // The tab after each order, oldest first (a refunded one adds nothing).
  const running = orders.reduce<number[]>((acc, o) => [...acc, (acc[acc.length - 1] ?? 0) + (o.refunded ? 0 : o.total)], []);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold">
          {person.firstName}
          {!person.ticked && <span className="ml-2 text-xs font-normal text-[var(--muted)]">(doesn&apos;t get the owner rate now)</span>}
        </h3>
        <span className="text-sm">
          <b className="tabular-nums">{money(month?.owed ?? 0)}</b> <span className="text-[var(--muted)]">so far · menu value {money(month?.menuValue ?? 0)}</span>
        </span>
        {month && month.paid > 0 && <span className="text-xs text-[var(--muted)]">{money(month.paid)} paid already</span>}
        <Link href={statementHref(person.id, month?.month ?? "")} className="ml-auto inline-flex min-h-11 items-center text-sm underline-offset-2 hover:underline">
          Statement →
        </Link>
      </div>
      {orders.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted)]">Nothing on the tab this month yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-[var(--muted)]">
                <th className="pb-1.5 pr-2 font-medium">Date</th>
                <th className="pb-1.5 pr-2 font-medium">Item</th>
                <th className="pb-1.5 pr-2 text-right font-medium">Menu price</th>
                <th className="pb-1.5 pr-2 text-right font-medium">Owner price</th>
                <th className="pb-1.5 pr-2 text-right font-medium">Tax</th>
                <th className="pb-1.5 text-right font-medium">Running total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order, n) => {
                const last = order.lines.length - 1;
                return order.lines.map((l, i) => (
                  <tr key={`${order.id}-${i}`} className={`${i === 0 ? "border-t border-[var(--border)]" : ""} align-top ${order.refunded ? "text-[var(--muted)] line-through" : ""}`}>
                    <td className="whitespace-nowrap py-1.5 pr-2">
                      {i === 0 && (
                        <>
                          {day(order.at)}
                          <span className="block text-xs text-[var(--muted)]">
                            #{order.orderNumber} · {time(order.at)}
                          </span>
                          {order.refunded && <RemovedNote order={order} />}
                        </>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      {l.qty > 1 ? `${l.qty} × ` : ""}
                      {l.name}
                      {l.mods.length > 0 && <span className="block text-xs text-[var(--muted)]">{l.mods.join(", ")}</span>}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-[var(--muted)]">{money(l.menuUnit * l.qty)}</td>
                    <td className="py-1.5 pr-2 text-right">
                      {money(l.ownerUnit * l.qty)}
                      <span className={`block text-xs ${l.how === "half" ? "text-[var(--danger-text)]" : "text-[var(--muted)]"}`}>{OWNER_PRICING_LABEL[l.how]}</span>
                    </td>
                    <td className="py-1.5 pr-2 text-right">{i === last ? money(order.tax) : ""}</td>
                    <td className="py-1.5 text-right font-semibold">{i === last ? money(running[n]) : ""}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Every item on the menu: its price, what its recipe costs, and what an
// owner pays, so "at cost" can be checked. At cost only with the recipe
// marked complete and every ingredient costed.
function Prices({ rows }: { rows: OwnerPriceRow[] }) {
  const atCost = rows.filter((r) => r.how === "cost").length;
  const why = (r: OwnerPriceRow) =>
    r.how === "cost"
      ? "at cost"
      : !r.hasRecipe
        ? "half: no recipe"
        : r.missing.length
          ? `half: no cost for ${r.missing.join(", ")}`
          : "half: recipe cost not marked complete";
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
      <details>
        <summary className="min-h-11 cursor-pointer text-base font-semibold">
          Prices: cost against menu price
          <span className="ml-2 text-xs font-normal text-[var(--muted)]">
            {atCost} of {rows.length} items at cost, the rest half price
          </span>
        </summary>
        <p className="mt-1 text-xs text-[var(--muted)]">
          What an owner pays for each item, before options. To put an item at cost, finish its recipe and tick &ldquo;Recipe cost is complete&rdquo; on the Menu page.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-[var(--muted)]">
                <th className="pb-1.5 pr-2 font-medium">Item</th>
                <th className="pb-1.5 pr-2 text-right font-medium">Menu price</th>
                <th className="pb-1.5 pr-2 text-right font-medium">Recipe cost</th>
                <th className="pb-1.5 pr-2 text-right font-medium">Owner pays</th>
                <th className="pb-1.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[var(--border)] align-top">
                  <td className="py-1.5 pr-2">
                    {r.name}
                    {r.category && <span className="block text-xs text-[var(--muted)]">{r.category}</span>}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-[var(--muted)]">{money(r.price)}</td>
                  <td className="py-1.5 pr-2 text-right">{r.cost === null ? "—" : money(r.cost)}</td>
                  <td className="py-1.5 pr-2 text-right font-semibold">{money(r.owner)}</td>
                  <td className={`py-1.5 text-xs ${r.how === "cost" ? "text-[var(--muted)]" : "text-[var(--danger-text)]"}`}>{why(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
