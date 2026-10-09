"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { IndyReviewData, IndyReviewMember } from "@/lib/data/indy-review";

const usd = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (s: string | null) => (s ? s.slice(0, 10) : "—");

type Filter = "all" | "over" | "staff" | "fortis" | "dup";
type SortKey = "name" | "orders" | "purchaseCents" | "firstAt" | "lastAt" | "points" | "indy" | "rclPoints";

const COLS: { key: SortKey; label: string; right?: boolean }[] = [
  { key: "name", label: "Member" },
  { key: "orders", label: "Orders", right: true },
  { key: "purchaseCents", label: "Purchases (tax in)", right: true },
  { key: "firstAt", label: "First" },
  { key: "lastAt", label: "Last" },
  { key: "points", label: "Proposed", right: true },
  { key: "indy", label: "Indy balance", right: true },
  { key: "rclPoints", label: "RCL now", right: true },
];

function sortValue(m: IndyReviewMember, k: SortKey): string | number {
  if (k === "indy") return m.indyRemaining;
  if (k === "name") return m.name.toLowerCase();
  return (m[k] as string | number | null) ?? "";
}

function Flags({ m, overLimit }: { m: IndyReviewMember; overLimit: number }) {
  const chip = "rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap";
  return (
    <div className="flex flex-wrap gap-1">
      {m.points > overLimit && <span className={`${chip} border-[var(--accent)] text-[var(--accent)]`}>Over {overLimit.toLocaleString()}</span>}
      {m.staff && <span className={`${chip} border-[var(--foreground)]`}>Staff</span>}
      {(m.fortisPoints ?? 0) > 0 && (
        <span className={`${chip} border-[var(--border)]`} title="Already got points from past card purchases: some visits may be counted twice">
          Card pts {m.fortisPoints?.toLocaleString()}
        </span>
      )}
      {(m.sameName || m.phoneOther) && (
        <span className={`${chip} border-[var(--border)]`} title={[m.sameName && "Another member has the same name", m.phoneOther && "The Indy phone belongs to a different member"].filter(Boolean).join(". ")}>
          Possible duplicate
        </span>
      )}
    </div>
  );
}

export default function IndyReview({
  members,
  unmatched,
  giftCards,
  vouchers,
  overLimit,
}: Pick<IndyReviewData, "members" | "unmatched" | "giftCards" | "vouchers"> & { overLimit: number }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "points", desc: true });
  const [showAllUnmatched, setShowAllUnmatched] = useState(false);

  const proposed = useMemo(() => members.filter((m) => m.points > 0), [members]);
  const counts: Record<Filter, number> = {
    all: proposed.length,
    over: proposed.filter((m) => m.points > overLimit).length,
    staff: proposed.filter((m) => m.staff).length,
    fortis: proposed.filter((m) => (m.fortisPoints ?? 0) > 0).length,
    dup: proposed.filter((m) => m.sameName || m.phoneOther).length,
  };

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = proposed.filter((m) => {
      if (filter === "over" && m.points <= overLimit) return false;
      if (filter === "staff" && !m.staff) return false;
      if (filter === "fortis" && !((m.fortisPoints ?? 0) > 0)) return false;
      if (filter === "dup" && !(m.sameName || m.phoneOther)) return false;
      return !needle || m.name.toLowerCase().includes(needle) || (m.email ?? "").toLowerCase().includes(needle);
    });
    const dir = sort.desc ? -1 : 1;
    return [...list].sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      return x < y ? -dir : x > y ? dir : a.memberId < b.memberId ? -1 : 1;
    });
  }, [proposed, filter, q, sort, overLimit]);

  const shownPoints = rows.reduce((s, m) => s + m.points, 0);
  const bigUnmatched = unmatched.filter((u) => u.purchaseCents >= 10000);
  const unmatchedList = showAllUnmatched ? unmatched : unmatched.slice(0, 25);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "over", label: `Over ${overLimit.toLocaleString()}` },
    { key: "staff", label: "Staff" },
    { key: "fortis", label: "Have card-history points" },
    { key: "dup", label: "Possible duplicates" },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`min-h-9 rounded-full border px-3 py-1 text-sm ${f.key === filter ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]" : "border-[var(--border)] hover:border-[var(--foreground)]"}`}
              >
                {f.label} <span className="opacity-70">{counts[f.key].toLocaleString()}</span>
              </button>
            ))}
          </div>
          <input
            className="min-w-[220px] rounded border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
            placeholder="Search name or email..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <p className="px-4 pt-2 text-xs text-[var(--muted)]">
          {rows.length.toLocaleString()} members · {shownPoints.toLocaleString()} proposed points. Click a column to sort.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                {COLS.map((c) => (
                  <th key={c.key} className={`px-3 py-2 font-medium ${c.right ? "text-right" : ""}`}>
                    <button
                      type="button"
                      className="hover:text-[var(--foreground)]"
                      onClick={() => setSort((s) => ({ key: c.key, desc: s.key === c.key ? !s.desc : c.key !== "name" }))}
                    >
                      {c.label}
                      {sort.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
                    </button>
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((m) => (
                <tr key={m.memberId} className="hover:bg-[var(--background)]">
                  <td className="px-3 py-2">
                    <Link href={`/admin/members/indy-review/${m.memberId}`} className="font-medium hover:underline">
                      {m.name}
                    </Link>
                    <div className="text-xs text-[var(--muted)]">
                      {m.email ?? "no email"} · matched by {m.matchKinds}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.orders.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd(m.purchaseCents)}</td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">{day(m.firstAt)}</td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">{day(m.lastAt)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{m.points.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--muted)]" title={`Preloaded in Indy: ${m.indyPreloaded.toLocaleString()}`}>
                    {m.indyRemaining.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{m.rclPoints.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <Flags m={m} overLimit={overLimit} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLS.length + 1} className="px-4 py-6 text-sm text-[var(--muted)]">
                    Nothing matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <h2 className="font-semibold">Open Indy gift cards</h2>
          <p className="mb-2 text-xs text-[var(--muted)]">
            {giftCards.length} with a balance, {usd(giftCards.reduce((s, g) => s + g.balanceCents, 0))} total. None is tied to an Indy account.
          </p>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {giftCards.map((g) => (
              <li key={g.id} className="flex justify-between py-1.5">
                <span>Card #{g.id}</span>
                <span className="tabular-nums">
                  {usd(g.balanceCents)} of {usd(g.initialCents)}
                  {g.expires ? ` · expires ${day(g.expires)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <h2 className="font-semibold">Open Indy vouchers</h2>
          <p className="mb-2 text-xs text-[var(--muted)]">{vouchers.length} still valid in Indy.</p>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {vouchers.map((v) => (
              <li key={v.id} className="flex justify-between gap-3 py-1.5">
                <span>{v.type ?? "Voucher"}</span>
                <span className="text-right text-[var(--muted)]">{v.memberName ? `${v.memberName} (member)` : (v.email ?? "no account")}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h2 className="font-semibold">Indy buyers with no member match</h2>
          <p className="text-xs text-[var(--muted)]">
            {unmatched.length.toLocaleString()} buyers, {usd(unmatched.reduce((s, u) => s + u.purchaseCents, 0))} in purchases. {bigUnmatched.length} spent $100
            or more ({usd(bigUnmatched.reduce((s, u) => s + u.purchaseCents, 0))}). No points are proposed for them: there&apos;s no member to give them to.
            Biggest first.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                <th className="px-3 py-2 font-medium">Indy account</th>
                <th className="px-3 py-2 text-right font-medium">Orders</th>
                <th className="px-3 py-2 text-right font-medium">Purchases</th>
                <th className="px-3 py-2 font-medium">First</th>
                <th className="px-3 py-2 font-medium">Last</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {unmatchedList.map((u) => (
                <tr key={u.indyUserId}>
                  <td className="px-3 py-2">
                    <div>{u.name || "(no name)"}</div>
                    <div className="text-xs text-[var(--muted)]">{u.email ?? "no email"}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{u.orders.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd(u.purchaseCents)}</td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">{day(u.firstAt)}</td>
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">{day(u.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {unmatched.length > 25 && (
          <div className="border-t border-[var(--border)] px-4 py-2">
            <button type="button" className="text-sm underline" onClick={() => setShowAllUnmatched((v) => !v)}>
              {showAllUnmatched ? "Show the top 25" : `Show all ${unmatched.length.toLocaleString()}`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
