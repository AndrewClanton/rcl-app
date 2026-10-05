import { requireOwner } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { getOwnerRateSettings } from "@/lib/data/owner-rate";
import { OWNER_PRICING_LABEL, OWNER_RATE_NAME } from "@/lib/register-totals";
import { ownerPriceList, type OwnerPriceRow } from "@/lib/owner-rate-server";
import OwnerRatePeople from "./OwnerRatePeople";

export const dynamic = "force-dynamic";

// Back office -> Owner rate (owners only): which owners get the owner rate,
// every change to that, the latest orders rung at it, and what each menu
// item comes to. The register side is the "Owner rate" tick in
// pos/PosApp.tsx (shown only with an owner's own account on the order) and
// completeOrder in pos/actions.ts.

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function OwnerRatePage() {
  const session = await requireOwner();
  const [o, prices] = await Promise.all([getOwnerRateSettings(session), ownerPriceList()]);

  return (
    <div className="space-y-6">
      <PageHeader
        area="money"
        title="Owner rate"
        purpose={`The owners pay ${OWNER_RATE_NAME} for anything on the menu. Attach the owner's own account at the register, tick Owner rate, and take payment as usual: card, cash or a split.`}
      />

      {!o.ready && (
        <p className="notice notice-warn !p-3 text-sm">The owner rate needs its database update first (supabase/migrations/20261003060000_owner_tab.sql). Until then the register doesn&apos;t offer it.</p>
      )}

      {o.ready && <OwnerRatePeople candidates={o.candidates} />}

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
        <h2 className="text-base font-semibold">Latest owner-rate orders</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">Whose account was on the order, who rang it up and ticked Owner rate, and what it came to against the menu. Reports show them too.</p>
        {o.recent.length === 0 ? (
          <p className="mt-3 text-[var(--muted)]">None yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-[var(--muted)]">
                  <th className="pb-1.5 pr-2 font-medium">When</th>
                  <th className="pb-1.5 pr-2 font-medium">Owner</th>
                  <th className="pb-1.5 pr-2 font-medium">Rung up by</th>
                  <th className="pb-1.5 pr-2 text-right font-medium">Menu value</th>
                  <th className="pb-1.5 pr-2 text-right font-medium">Owner rate</th>
                  <th className="pb-1.5 text-right font-medium">Paid, with tax</th>
                </tr>
              </thead>
              <tbody>
                {o.recent.map((r) => (
                  <tr key={r.id} className={`border-t border-[var(--border)] ${r.status === "completed" ? "" : "text-[var(--muted)] line-through"}`}>
                    <td className="py-1.5 pr-2">
                      {when(r.at)} <span className="text-xs text-[var(--muted)]">#{r.orderNumber}</span>
                    </td>
                    <td className="py-1.5 pr-2 font-medium">{r.owner}</td>
                    <td className="py-1.5 pr-2">{r.cashier ?? "—"}</td>
                    <td className="py-1.5 pr-2 text-right text-[var(--muted)]">{money(r.menuValue)}</td>
                    <td className="py-1.5 pr-2 text-right">{money(r.subtotal)}</td>
                    <td className="py-1.5 text-right font-semibold">{money(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
                  {when(c.at)}
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
            A menu item is {OWNER_RATE_NAME} when a manager has ticked &ldquo;Recipe cost is complete&rdquo; on its recipe (Menu, the item, Recipe) and every ingredient in
            it has a cost on Ingredients &amp; counts: each ingredient&apos;s amount times its cost, plus 10%. Never more than the menu price.
          </li>
          <li>
            Anything else (no recipe, the tick not on, an ingredient with no cost): half the menu price, marked &ldquo;{OWNER_PRICING_LABEL.half}&rdquo;. Nothing is
            ticked to start with, and adding or taking off an ingredient unticks it, so a recipe missing something is never priced from its cost.
          </li>
          <li>Options and add-ons have no recipes of their own, so what they add to the price is charged at half.</li>
          <li>Movie tickets and custom items are their normal price. Sales tax is charged as on any sale.</li>
          <li>No member discount, daily coffee, reward, organization comp or points with it. It&apos;s paid at the register like any order.</li>
          <li>No PIN: the tick only shows when the owner&apos;s own account is on the order, and the order keeps whose account it was and who rang it up.</li>
        </ul>
      </section>
    </div>
  );
}

// Every item on the menu: its price, what its recipe costs, and what an
// owner pays, so the owner rate can be checked. Priced from the cost only
// with the recipe marked complete and every ingredient costed.
function Prices({ rows }: { rows: OwnerPriceRow[] }) {
  const atCost = rows.filter((r) => r.how === "cost").length;
  const why = (r: OwnerPriceRow) =>
    r.how === "cost"
      ? OWNER_RATE_NAME
      : !r.hasRecipe
        ? "half: no recipe"
        : r.missing.length
          ? `half: no cost for ${r.missing.join(", ")}`
          : "half: recipe cost not marked complete";
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
      <details>
        <summary className="min-h-11 cursor-pointer text-base font-semibold">
          Prices: owner rate against menu price
          <span className="ml-2 text-xs font-normal text-[var(--muted)]">
            {atCost} of {rows.length} items at {OWNER_RATE_NAME}, the rest half price
          </span>
        </summary>
        <p className="mt-1 text-xs text-[var(--muted)]">
          What an owner pays for each item, before options. To price an item from its cost, finish its recipe and tick &ldquo;Recipe cost is complete&rdquo; on the Menu
          page.
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
