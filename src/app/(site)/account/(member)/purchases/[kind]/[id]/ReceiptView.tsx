import Link from "next/link";
import type { Receipt } from "@/lib/data/member-account";
import MoviePoster from "@/components/MoviePoster";
import { money, points, showtime } from "../../../format";

const TZ = "America/Chicago";

export default function ReceiptView({ r }: { r: Receipt }) {
  const kind = r.kind;
  const id = r.id;
  const when = new Date(r.date);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/account/purchases" className="text-sm font-bold text-[var(--muted)] hover:text-[var(--foreground)]">
          ← All purchases
        </Link>
        <a href={`/account/purchases/${kind}/${id}/pdf`} className="btn-primary !px-4 !py-2 text-sm">
          Download PDF receipt
        </a>
      </div>

      <article className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-sm">
        <header className="flex items-end justify-between gap-4 bg-[var(--foreground)] px-6 py-5 text-[var(--background)]">
          <div>
            <div className="font-display text-lg leading-tight">Royale Cinema Lounge</div>
            <div className="text-xs opacity-70">715 E Broadway, Joplin, MO 64801</div>
          </div>
          <div className="text-right">
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--gold)]">Receipt</div>
            <div className="font-display text-lg">{r.number}</div>
          </div>
        </header>
        <div className="h-1 bg-[var(--accent)]" />

        <div className="space-y-5 p-6">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">Date</dt>
              <dd>
                {when.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ })},{" "}
                {when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ })}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">Payment</dt>
              <dd>{r.payment}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">Status</dt>
              <dd className={r.status === "refunded" ? "font-bold text-[var(--accent)]" : ""}>{r.status === "refunded" ? "Refunded" : "Paid"}</dd>
            </div>
          </dl>

          {r.screening && (
            <div className="flex items-center gap-4 rounded-xl bg-[var(--background)] p-3">
              <div className="w-12 shrink-0">
                <MoviePoster posterUrl={r.screening.posterUrl} title={r.screening.title} sizes="48px" />
              </div>
              <div>
                <div className="font-bold">{r.screening.title}</div>
                <div className="text-sm text-[var(--muted)]">
                  {showtime(r.screening.startsAt)} · {r.screening.room}
                </div>
              </div>
            </div>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-[var(--foreground)] text-left text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
                <th className="pb-2 font-bold">Item</th>
                <th className="pb-2 text-right font-bold">Qty</th>
                <th className="pb-2 text-right font-bold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l, i) => (
                <tr key={i} className="border-b border-[var(--border)] align-top">
                  <td className="py-2.5 pr-3">
                    {l.name}
                    {l.modifiers.length > 0 && <div className="text-xs text-[var(--muted)]">{l.modifiers.join(", ")}</div>}
                    {l.quantity > 1 && <div className="text-xs text-[var(--muted)]">{money(l.unitPrice)} each</div>}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{l.quantity}</td>
                  <td className="py-2.5 text-right tabular-nums">{money(l.unitPrice * l.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="ml-auto max-w-xs space-y-1.5 text-sm">
            <Row label="Subtotal" value={money(r.subtotal)} />
            {r.discounts.map((d) => (
              <Row key={d.label} label={d.label} value={money(-d.amount)} muted />
            ))}
            {r.kind === "order" && <Row label={r.taxFree ? "Sales tax (exempt)" : "Sales tax"} value={money(r.tax)} />}
            {r.tip > 0 && <Row label="Tip" value={money(r.tip)} />}
            <div className="flex justify-between border-t-2 border-[var(--foreground)] pt-2 text-base font-bold">
              <dt>Total</dt>
              <dd className="tabular-nums">{money(r.total)}</dd>
            </div>
          </dl>

          {(r.pointsEarned !== 0 || r.pointsRedeemed !== 0) && (
            <div className="flex flex-wrap gap-2 text-xs">
              {r.pointsEarned !== 0 && (
                <span className="rounded-full bg-[var(--gold)] px-2.5 py-1 font-bold text-[var(--gold-foreground)]">
                  {r.pointsEarned > 0 ? "+" : ""}
                  {points(r.pointsEarned)} points earned
                </span>
              )}
              {r.pointsRedeemed !== 0 && (
                <span className="rounded-full border border-[var(--border)] px-2.5 py-1 font-bold">{points(r.pointsRedeemed)} points used</span>
              )}
            </div>
          )}
        </div>
        <footer className="border-t border-[var(--border)] px-6 py-4 text-xs text-[var(--muted)]">
          Questions about this receipt? info@royalecinemajoplin.com · 417-281-4172
        </footer>
      </article>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-[var(--muted)]" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
