import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { pointsEconomy, pointsSettings, rewardCatalog, watchList } from "@/lib/rewards-server";
import { POINT_VALUE } from "@/lib/rewards";
import CatalogEditor from "./CatalogEditor";
import LimitsForm from "./LimitsForm";
import FlagButton from "./FlagButton";

export const dynamic = "force-dynamic";

// Back office -> Points (owners and admins). Four tabs:
//   Rewards     the catalog members spend points on (Spend points, on the
//               customer screen): edit, add, switch off;
//   Limits      the daily earning ceilings and the per-member limits on
//               redeeming real goods;
//   Watch list  members whose earning or redeeming looks unusual, each
//               with its reason and a Flag button (the member flag system);
//   Economy     points issued and redeemed by month, what members hold (as
//               dollars), what the goods redeemed cost, and the top earners
//               and redeemers.

const TABS = [
  { key: "rewards", label: "Rewards" },
  { key: "limits", label: "Limits" },
  { key: "watch", label: "Watch list" },
  { key: "economy", label: "Economy" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const monthName = (k: string) => new Date(`${k}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export default async function PointsPage({ searchParams }: { searchParams: Promise<{ tab?: string; days?: string }> }) {
  await requireAdmin();
  const p = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === p.tab) ? (p.tab as Tab) : "rewards";
  const days = [7, 30, 90].includes(Number(p.days)) ? Number(p.days) : 30;

  return (
    <div className="space-y-6">
      <PageHeader
        area="guests"
        title="Points"
        purpose="What points buy, the limits that keep them fair, who to keep an eye on, and what points cost us. Spending never lowers what a member has earned."
      >
        <nav className="mt-3 flex flex-wrap gap-2" aria-label="Points">
          {TABS.map((t) => (
            <Link key={t.key} href={`/admin/points?tab=${t.key}`} className={`chip ${tab === t.key ? "chip-selected" : ""}`} aria-current={tab === t.key ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
      </PageHeader>
      {tab === "rewards" && <Rewards />}
      {tab === "limits" && <Limits />}
      {tab === "watch" && <Watch days={days} />}
      {tab === "economy" && <EconomyTab />}
    </div>
  );
}

async function Rewards() {
  const catalog = await rewardCatalog().catch(() => null);
  if (!catalog) return <p className="notice notice-warn !p-3 text-sm">The rewards catalog needs its database update first (supabase/migrations/20261007020000_points_rewards.sql).</p>;
  return (
    <>
      <p className="text-sm text-[var(--muted)]">
        Members see these on the customer screen under Spend points, cheapest first. A point is worth about {Math.round(POINT_VALUE * 100)}¢ (100 points = $5 off), so price a
        reward at what it sells for: a $2 popcorn is 40 points. Real goods go on the order at $0 and come off their points when the sale is paid; vanity perks unlock
        at once. Switch one off to hide it.
      </p>
      <CatalogEditor rows={catalog} />
    </>
  );
}

async function Limits() {
  const s = await pointsSettings();
  return <LimitsForm settings={s} />;
}

async function Watch({ days }: { days: number }) {
  const rows = await watchList(days).catch(() => null);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-[var(--muted)]">Looking back</span>
        {[7, 30, 90].map((d) => (
          <Link key={d} href={`/admin/points?tab=watch&days=${d}`} className={`chip ${days === d ? "chip-selected" : ""}`}>
            {d} days
          </Link>
        ))}
      </div>
      <p className="text-sm text-[var(--muted)]">
        Not proof of anything: just patterns worth a look. Flag one to look into it on their page (it doesn&apos;t block anything), or open their points history.
      </p>
      {rows === null ? (
        <p className="notice notice-warn !p-3 text-sm">The watch list needs its database update first (supabase/migrations/20261007020000_points_rewards.sql).</p>
      ) : rows.length === 0 ? (
        <p className="text-sm">Nothing unusual in the last {days} days.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          {rows.map((r) => (
            <li key={r.memberId} className="flex flex-wrap items-start justify-between gap-3 p-3 sm:p-4">
              <div className="min-w-0 flex-1 basis-64">
                <Link href={`/admin/members/${r.memberId}`} className="font-semibold underline-offset-2 hover:underline">
                  {r.name}
                </Link>
                {r.flagged && <span className="ml-2 text-xs font-bold">🚩 Flagged</span>}
                <span className="ml-2 text-xs text-[var(--muted)]">
                  {r.points.toLocaleString("en-US")} points · last {when(r.lastAt)}
                </span>
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {r.reasons.map((x, i) => (
                    <li key={i}>{x.reason}</li>
                  ))}
                </ul>
              </div>
              <FlagButton memberId={r.memberId} reason={r.reasons.map((x) => x.reason).join("; ")} flagged={r.flagged} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function EconomyTab() {
  const e = await pointsEconomy(6).catch(() => null);
  if (!e) return <p className="notice notice-warn !p-3 text-sm">The points summary couldn&apos;t load. It needs the database update in supabase/migrations/20261007020000_points_rewards.sql.</p>;
  const issued = e.months.reduce((s, m) => s + m.issued, 0);
  const redeemed = e.months.reduce((s, m) => s + m.redeemed, 0);
  const cost = e.months.reduce((s, m) => s + m.goodsCost, 0);
  const max = Math.max(1, ...e.months.flatMap((m) => [m.issued, m.redeemed]));
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Members hold" value={`${e.outstanding.toLocaleString("en-US")} pts`} />
        <Stat label="Worth (what we owe)" value={money(e.liability)} />
        <Stat label="Issued, 6 months" value={`${issued.toLocaleString("en-US")} pts`} />
        <Stat label="Redeemed, 6 months" value={`${redeemed.toLocaleString("en-US")} pts`} sub={`Goods cost us ${money(cost)}`} />
      </div>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm sm:p-5">
        <h2 className="text-base font-semibold">By month</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">Issued: purchases, check-ins, badges, bonuses and staff credits. Redeemed: the $5 off, goods and perks. Cost: what the goods redeemed cost us.</p>
        <table className="mt-3 w-full text-left tabular-nums">
          <thead className="text-xs text-[var(--muted)]">
            <tr>
              <th className="py-1 font-medium">Month</th>
              <th className="py-1 font-medium">Issued</th>
              <th className="py-1 font-medium">Redeemed</th>
              <th className="hidden py-1 font-medium sm:table-cell" aria-hidden="true"></th>
              <th className="py-1 text-right font-medium">Goods cost</th>
            </tr>
          </thead>
          <tbody>
            {e.months.map((m) => (
              <tr key={m.month} className="border-t border-[var(--border)]">
                <td className="py-1.5">{monthName(m.month)}</td>
                <td className="py-1.5">{m.issued.toLocaleString("en-US")}</td>
                <td className="py-1.5">{m.redeemed.toLocaleString("en-US")}</td>
                <td className="hidden w-1/3 py-1.5 sm:table-cell" aria-hidden="true">
                  <div className="h-2 rounded bg-[var(--accent)]" style={{ width: `${(m.issued / max) * 100}%` }} />
                  <div className="mt-0.5 h-2 rounded bg-[var(--muted)]" style={{ width: `${(m.redeemed / max) * 100}%` }} />
                </td>
                <td className="py-1.5 text-right">{money(m.goodsCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <TopList title="Top earners (6 months)" rows={e.topEarners} />
        <TopList title="Top redeemers (6 months)" rows={e.topRedeemers} />
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          <h2 className="text-base font-semibold">Rewards redeemed</h2>
          {e.byReward.length === 0 ? (
            <p className="mt-2 text-[var(--muted)]">None yet.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {e.byReward.map((r) => (
                <li key={r.name} className="flex justify-between gap-2">
                  <span className="truncate">
                    {r.name} <span className="text-[var(--muted)]">×{r.count}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {r.points.toLocaleString("en-US")} pts · {money(r.cost)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="mt-0.5 text-xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

function TopList({ title, rows }: { title: string; rows: { memberId: string; name: string; points: number }[] }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
      <h2 className="text-base font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-[var(--muted)]">None yet.</p>
      ) : (
        <ol className="mt-2 space-y-1">
          {rows.map((r, i) => (
            <li key={r.memberId} className="flex justify-between gap-2">
              <Link href={`/admin/members/${r.memberId}`} className="truncate hover:underline">
                {i + 1}. {r.name}
              </Link>
              <span className="shrink-0 tabular-nums">{r.points.toLocaleString("en-US")}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
