import Link from "next/link";
import { requireManager } from "@/lib/auth";
import { businessDay } from "@/lib/ops/time";
import MemberAvatar from "@/components/MemberAvatar";
import PageHeader from "@/components/admin/PageHeader";
import { currentBusinessMonth, getTopRegulars, shiftMonth, type RegularRow } from "@/lib/data/regulars";

export const dynamic = "force-dynamic";

// Top regulars for a month, for picking prize winners: most visits, and
// biggest spend. Managers and up. Visits only count when the member was on
// the order -- which is what check-in at the customer screen is for.

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function monthName(month: string) {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// The business day it counted for (a 1 a.m. drink is the night before).
function visitDay(iso: string) {
  const date = businessDay(new Date(iso)).date;
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function href(month: string, current: string) {
  return month === current ? "/admin/members/regulars" : `/admin/members/regulars?month=${month}`;
}

export default async function TopRegularsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireManager();
  const p = await searchParams;
  const current = currentBusinessMonth();
  const month = p.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(p.month) && p.month <= current ? p.month : current;
  const report = await getTopRegulars(month);

  return (
    <div className="space-y-4">
      <PageHeader
        area="guests"
        back={{ href: "/admin/members", label: "Members" }}
        title="Top regulars"
        purpose="Who came in most and who spent most, month by month, for picking prize winners."
      />
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href(shiftMonth(month, -1), current)} className="chip !px-2.5 !py-1 !text-sm" aria-label="Previous month">
          ◀
        </Link>
        <span className="min-w-[9rem] text-center text-base font-semibold">
          {monthName(month)}
          {month === current ? " so far" : ""}
        </span>
        {month < current ? (
          <Link href={href(shiftMonth(month, 1), current)} className="chip !px-2.5 !py-1 !text-sm" aria-label="Next month">
            ▶
          </Link>
        ) : (
          <span className="chip !px-2.5 !py-1 !text-sm opacity-30">▶</span>
        )}
        <span className="ml-auto text-sm text-[var(--muted)]">
          {report.visitors.toLocaleString()} member{report.visitors === 1 ? "" : "s"} came in
        </span>
      </div>

      <p className="text-xs text-[var(--muted)]">
        A visit is a business day (4 a.m. to 4 a.m.) with an order on their account, or a movie they had an online ticket for. Spend is what they paid,
        tax included, tips not. Only sales with the member attached count, so checking in at the customer screen matters.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <RegularsTable title="Most visits" rows={report.byVisits} highlight="visits" thisMonth={month === current} />
        <RegularsTable title="Biggest spend" rows={report.bySpend} highlight="spend" thisMonth={month === current} />
      </div>
    </div>
  );
}

function RegularsTable({ title, rows, highlight, thisMonth }: { title: string; rows: RegularRow[]; highlight: "visits" | "spend"; thisMonth: boolean }) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No member visits {thisMonth ? "yet this month" : "that month"}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                <th className="w-6 pb-1 font-normal">#</th>
                <th className="pb-1 font-normal">Member</th>
                <th className="pb-1 text-right font-normal">Visits</th>
                <th className="pb-1 text-right font-normal">Spend</th>
                <th className="pb-1 text-right font-normal">Points</th>
                <th className="pb-1 pl-3 text-right font-normal">Last visit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.memberId} className="border-t border-[var(--border)]">
                  <td className="py-1.5 text-[var(--muted)]">{i + 1}</td>
                  <td className="py-1.5">
                    <Link href={`/admin/members/${r.memberId}`} className="flex items-center gap-2 hover:underline">
                      <MemberAvatar name={r.name} url={r.avatarUrl} size={26} plus={r.tier === "Insiders+"} />
                      <span className="truncate">{r.name}</span>
                    </Link>
                  </td>
                  <td className={`py-1.5 text-right ${highlight === "visits" ? "font-bold" : ""}`}>{r.visits}</td>
                  <td className={`py-1.5 text-right ${highlight === "spend" ? "font-bold" : ""}`}>{money(r.spend)}</td>
                  <td className="py-1.5 text-right">{Math.round(r.points).toLocaleString()}</td>
                  <td className="whitespace-nowrap py-1.5 pl-3 text-right text-[var(--muted)]">{visitDay(r.lastVisit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
