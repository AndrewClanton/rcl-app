import Link from "next/link";
import { requireManager } from "@/lib/auth";
import MemberAvatar from "@/components/MemberAvatar";
import PageHeader from "@/components/admin/PageHeader";
import { getMostRegular, type RegularsSource } from "@/lib/data/most-regular";
import type { RegularSort } from "@/lib/regularity";

export const dynamic = "force-dynamic";

// Who's the most regular regular, all time. Managers and up, like Top
// regulars: it shows when members come in.

const PAGE = "/admin/members/regulars/most-regular";
const SORTS: { key: RegularSort; label: string }[] = [
  { key: "days", label: "Most days" },
  { key: "longest", label: "Longest run" },
  { key: "current", label: "Current run" },
];

function day(date: string | null) {
  return date ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";
}

function weeks(n: number) {
  return `${n} wk${n === 1 ? "" : "s"}`;
}

export default async function MostRegularPage({ searchParams }: { searchParams: Promise<{ source?: string; sort?: string }> }) {
  await requireManager();
  const p = await searchParams;
  const source: RegularsSource = p.source === "cards" ? "cards" : "all";
  const sort: RegularSort = SORTS.some((s) => s.key === p.sort) ? (p.sort as RegularSort) : "days";
  const report = await getMostRegular(source, sort);
  const href = (s: RegularsSource, o: RegularSort) => {
    const params = new URLSearchParams();
    if (s !== "all") params.set("source", s);
    if (o !== "days") params.set("sort", o);
    const qs = params.toString();
    return qs ? `${PAGE}?${qs}` : PAGE;
  };
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm ${active ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]" : "border-[var(--border)] hover:border-[var(--foreground)]"}`;

  return (
    <div className="space-y-4">
      <PageHeader
        area="guests"
        back={{ href: "/admin/members/regulars", label: "Top regulars" }}
        title="Most regular regulars"
        purpose="All time: who comes in on the most days, and the most weeks in a row. For settling the debate. Staff only."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Link href={href("all", sort)} className={chip(source === "all")}>
          Cards + check-ins
        </Link>
        <Link href={href("cards", sort)} className={chip(source === "cards")}>
          Cards only
        </Link>
        <span className="mx-1 h-5 w-px bg-[var(--border)]" aria-hidden />
        {SORTS.map((s) => (
          <Link key={s.key} href={href(source, s.key)} className={chip(sort === s.key)}>
            {s.label}
          </Link>
        ))}
        <span className="ml-auto text-sm text-[var(--muted)]">{report.ranked.toLocaleString()} members ranked</span>
      </div>

      <p className="text-xs text-[var(--muted)]">
        A visit is a business day (4 a.m. to 4 a.m.) they paid with a card matched to them on the old card machine
        {source === "all" ? ", or checked in on the new system" : ""}. Weeks run Monday to Sunday; a week we were closed doesn&apos;t break a run, and this
        week doesn&apos;t until it&apos;s over.
        {source === "all" && " Neither does the week the card history ends, since we only see part of it."}
        {source === "cards" && report.cardsThrough && <> Card history ends {day(report.cardsThrough)}, so current runs are counted to then.</>} Cards only
        count once they&apos;re matched to the member (Members &gt; Points from past card purchases); paying cash leaves no trace here.
      </p>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        {report.rows.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No visits to rank yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                  <th className="w-6 pb-1 font-normal">#</th>
                  <th className="pb-1 font-normal">Member</th>
                  <th className="pb-1 text-right font-normal">Days</th>
                  <th className="pb-1 text-right font-normal">Longest run</th>
                  <th className="pb-1 text-right font-normal">Current run</th>
                  <th className="pb-1 pl-3 text-right font-normal">First visit</th>
                  <th className="pb-1 pl-3 text-right font-normal">Last visit</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r, i) => (
                  <tr key={r.memberId} className="border-t border-[var(--border)]">
                    <td className="py-1.5 text-[var(--muted)]">{i + 1}</td>
                    <td className="py-1.5">
                      <Link href={`/admin/members/${r.memberId}`} className="flex items-center gap-2 hover:underline">
                        <MemberAvatar name={r.name} url={r.avatarUrl} size={26} plus={r.tier === "Insiders+"} />
                        <span className="truncate">{r.name}</span>
                      </Link>
                    </td>
                    <td className={`py-1.5 text-right ${sort === "days" ? "font-bold" : ""}`}>{r.days}</td>
                    <td className={`py-1.5 text-right ${sort === "longest" ? "font-bold" : ""}`}>{weeks(r.longestRun)}</td>
                    <td className={`py-1.5 text-right ${sort === "current" ? "font-bold" : ""}`}>{weeks(r.currentRun)}</td>
                    <td className="whitespace-nowrap py-1.5 pl-3 text-right text-[var(--muted)]">{day(r.first)}</td>
                    <td className="whitespace-nowrap py-1.5 pl-3 text-right text-[var(--muted)]">{day(r.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
