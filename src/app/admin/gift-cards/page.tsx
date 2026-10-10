import Link from "next/link";
import { requireManager } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { getGiftCard, listGiftCards } from "@/lib/gift-cards-server";
import { GIFT_TX_LABEL } from "@/lib/gift-cards";
import AdjustForm from "./AdjustForm";

export const dynamic = "force-dynamic";

// Back office -> Gift cards (managers and up): every card the register has
// sold, what's left on each, its history (sold, spent, put back, adjusted,
// voided: who, when, which order, why), and a manager's adjustment with a
// reason. How gift cards work: lib/gift-cards.ts.

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export default async function GiftCardsPage({ searchParams }: { searchParams: Promise<{ q?: string; card?: string }> }) {
  await requireManager();
  const { q = "", card: cardId = "" } = await searchParams;
  const [list, detail] = await Promise.all([listGiftCards(q), cardId ? getGiftCard(cardId) : null]);
  const back = q ? `/admin/gift-cards?q=${encodeURIComponent(q)}` : "/admin/gift-cards";

  return (
    <div className="space-y-6">
      <PageHeader
        area="money"
        title="Gift cards"
        purpose="Every gift card sold at the register: what's left on it, its history, and changes to a balance. Sell one with the register's Gift card button; spend one with Gift card on the payment screen."
      />

      {!list.ready && <p className="notice notice-warn !p-3 text-sm">Gift cards need their database update first (supabase/migrations/20261009120000_gift_cards.sql).</p>}

      {list.ready && (
        <p className="text-sm">
          <strong>{money(list.outstanding)}</strong> is still on {list.count} card{list.count === 1 ? "" : "s"}: money already taken, owed as goods when the cards are spent.
        </p>
      )}

      {detail && (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-mono text-lg font-semibold">{detail.card.code}</h2>
            <Link href={back} className="text-xs underline">
              Close
            </Link>
          </div>
          <p className="mt-1">
            <strong className="text-2xl tabular-nums">{money(detail.card.balance)}</strong> left of {money(detail.card.initial)}
            {detail.card.status === "void" && <span className="ml-2 text-xs font-bold text-[var(--danger-text)]">VOID</span>}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Sold {when(detail.card.createdAt)}
            {detail.card.soldOrderNumber ? ` on order #${detail.card.soldOrderNumber}` : ""}
            {detail.card.memberId ? (
              <>
                {" "}
                · on{" "}
                <Link className="underline" href={`/admin/members/${detail.card.memberId}`}>
                  {detail.card.memberName ?? "a member"}
                </Link>
                &apos;s account
              </>
            ) : (
              " · not on anyone's account"
            )}
          </p>

          {detail.card.status === "active" && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold">Change the balance</h3>
              <AdjustForm cardId={detail.card.id} balance={detail.card.balance} />
            </div>
          )}

          <h3 className="mt-5 text-sm font-semibold">History</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-[var(--muted)]">
                  <th className="pb-1.5 pr-2 font-medium">When</th>
                  <th className="pb-1.5 pr-2 font-medium">What</th>
                  <th className="pb-1.5 pr-2 text-right font-medium">Amount</th>
                  <th className="pb-1.5 pr-2 text-right font-medium">Left</th>
                  <th className="pb-1.5 pr-2 font-medium">Order</th>
                  <th className="pb-1.5 pr-2 font-medium">By</th>
                  <th className="pb-1.5 font-medium">Why</th>
                </tr>
              </thead>
              <tbody>
                {detail.history.map((t) => (
                  <tr key={t.id} className="border-t border-[var(--border)]">
                    <td className="py-1.5 pr-2 whitespace-nowrap">{when(t.at)}</td>
                    <td className="py-1.5 pr-2">{GIFT_TX_LABEL[t.kind]}</td>
                    <td className="py-1.5 pr-2 text-right">{t.amount > 0 ? `+${money(t.amount)}` : money(t.amount)}</td>
                    <td className="py-1.5 pr-2 text-right">{money(t.balanceAfter)}</td>
                    <td className="py-1.5 pr-2">{t.orderNumber ? `#${t.orderNumber}` : "—"}</td>
                    <td className="py-1.5 pr-2">{t.by ?? "—"}</td>
                    <td className="py-1.5 text-xs">{t.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {list.ready && (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
          <form className="flex flex-wrap gap-2" action="/admin/gift-cards">
            <input name="q" defaultValue={q} className="input max-w-xs" placeholder="Code or member's name" />
            <button className="btn-secondary">Find</button>
            {q && (
              <Link href="/admin/gift-cards" className="self-center text-xs underline">
                Show all
              </Link>
            )}
          </form>
          {list.cards.length === 0 ? (
            <p className="mt-3 text-[var(--muted)]">{q ? "No card matches that." : "None sold yet."}</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-xs text-[var(--muted)]">
                    <th className="pb-1.5 pr-2 font-medium">Code</th>
                    <th className="pb-1.5 pr-2 text-right font-medium">Left</th>
                    <th className="pb-1.5 pr-2 text-right font-medium">Started at</th>
                    <th className="pb-1.5 pr-2 font-medium">Member</th>
                    <th className="pb-1.5 pr-2 font-medium">Sold</th>
                    <th className="pb-1.5 font-medium">Last change</th>
                  </tr>
                </thead>
                <tbody>
                  {list.cards.map((c) => (
                    <tr key={c.id} className="border-t border-[var(--border)]">
                      <td className="py-1.5 pr-2 font-mono">
                        <Link className="underline" href={`/admin/gift-cards?${new URLSearchParams({ ...(q ? { q } : {}), card: c.id }).toString()}`}>
                          {c.code}
                        </Link>
                        {c.status === "void" && <span className="ml-1 text-xs font-bold text-[var(--danger-text)]">VOID</span>}
                      </td>
                      <td className="py-1.5 pr-2 text-right">{money(c.balance)}</td>
                      <td className="py-1.5 pr-2 text-right">{money(c.initial)}</td>
                      <td className="py-1.5 pr-2">{c.memberName ?? "—"}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        {when(c.createdAt)}
                        {c.soldOrderNumber ? ` · #${c.soldOrderNumber}` : ""}
                      </td>
                      <td className="py-1.5 whitespace-nowrap">{when(c.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
