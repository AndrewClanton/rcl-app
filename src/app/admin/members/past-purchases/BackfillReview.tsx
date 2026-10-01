"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHeader from "@/components/admin/PageHeader";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { DEFAULT_GRANT_SETTINGS, cappedPoints, pointsForDollars, validSettings, type GrantSettings } from "@/lib/fortis-backfill";
import { SALES_TAX_PERCENT } from "@/lib/sales-tax";
import type { BackfillData, BackfillRow, BackfillTab, MemberTotal } from "@/lib/data/fortis-backfill";
import { approveExactMatches, decideCard, grantBackfillPoints, pickCardMember, recheckMatches, searchMembersToPick } from "./actions";

const PAGE = "/admin/members/past-purchases";

const TAB_INFO: Record<BackfillTab, { label: string; hint: string }> = {
  review: { label: "To review", hint: "Matched automatically. Approve the ones that are right, skip the ones that aren't, or pick someone else." },
  approved: { label: "Approved", hint: "These get their points when you press Grant." },
  pick: { label: "Needs a pick", hint: "More than one member fits, or a member with the same last name goes by a short form of the name on the card. Pick who it is, or skip." },
  unclaimed: { label: "Unclaimed", hint: "No member matches. Most taps don't send a name. These stay here for when someone claims their card; you can pick a member now if you know who it is." },
  skipped: { label: "Skipped", hint: "Not getting points. Undo puts one back." },
  granted: { label: "Granted", hint: "Already paid. A card is never paid twice." },
};
const TABS: BackfillTab[] = ["review", "approved", "pick", "unclaimed", "skipped", "granted"];

const KIND: Record<string, string> = {
  email: "Email on the payment",
  phone: "Phone on the payment",
  name: "Name on the card",
  picked: "Picked by staff",
  similar: "Similar name",
};
const BRAND: Record<string, string> = { visa: "Visa", mc: "Mastercard", disc: "Discover", amex: "Amex" };

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const num = (n: number) => n.toLocaleString("en-US");
function monthYear(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "America/Chicago" }) : "";
}

function parseSettings(rate: string, cap: string, taxOut: boolean): GrantSettings {
  return { rate: Number(rate), cap: cap.trim() === "" ? null : Number(cap), taxOut };
}

function live(members: MemberTotal[], s: GrantSettings, withWaiting: boolean) {
  const list = members
    .map((m) => {
      const dollars = Math.round((m.approvedDollars + (withWaiting ? m.waitingDollars : 0)) * 100) / 100;
      return { ...m, dollars, points: cappedPoints(dollars, s, m.alreadyGranted) };
    })
    .filter((m) => m.dollars > 0)
    .sort((a, b) => b.points - a.points || b.dollars - a.dollars);
  return {
    list,
    members: list.filter((m) => m.points > 0).length,
    points: list.reduce((n, m) => n + m.points, 0),
    dollars: list.reduce((n, m) => n + m.dollars, 0),
  };
}

export default function BackfillReview({ data, tab, query, pageSize }: { data: BackfillData; tab: BackfillTab; query: string; pageSize: number }) {
  const router = useRouter();
  const { summary } = data;
  const [rate, setRate] = useState(String(DEFAULT_GRANT_SETTINGS.rate));
  const [cap, setCap] = useState("");
  const [taxOut, setTaxOut] = useState(DEFAULT_GRANT_SETTINGS.taxOut);
  const settings = parseSettings(rate, cap, taxOut);
  const ok = validSettings(settings);
  const [search, setSearch] = useState(query);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => {
      const params = new URLSearchParams({ tab });
      if (search.trim()) params.set("q", search.trim());
      router.push(`${PAGE}?${params.toString()}`);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const href = (t: BackfillTab, p = 1) => {
    const params = new URLSearchParams({ tab: t });
    if (t === tab && search.trim()) params.set("q", search.trim());
    if (p > 1) params.set("page", String(p));
    return `${PAGE}?${params.toString()}`;
  };

  if (summary.cards === 0) {
    return (
      <div className="space-y-4">
        <Header />
        <div className="notice notice-warn">
          No cards are loaded yet. Run <code>node scripts/load-fortis-cards.mjs &lt;export.csv&gt; --apply</code> with the Fortis export.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header />
      <Summary data={data} />
      <GrantPanel members={data.members} settings={settings} ok={ok} rate={rate} cap={cap} taxOut={taxOut} setRate={setRate} setCap={setCap} setTaxOut={setTaxOut} />
      <BulkActions exactWaiting={summary.exactWaiting} />

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link
            key={t}
            href={href(t)}
            className={`rounded-full border px-3 py-1 text-sm ${t === tab ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]" : "border-[var(--border)] hover:border-[var(--foreground)]"}`}
          >
            {TAB_INFO[t].label} <span className="opacity-70">{num(summary.tabs[t])}</span>
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <p className="max-w-2xl text-sm text-[var(--muted)]">{TAB_INFO[tab].hint}</p>
          <input
            className="input !w-auto min-w-[220px] !py-1"
            placeholder="Search name or last 4…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search cards"
          />
        </div>
        <div className="divide-y divide-[var(--border)]">
          {data.rows.map((r) => (
            <CardRow key={r.id} row={r} settings={ok ? settings : DEFAULT_GRANT_SETTINGS} />
          ))}
          {data.rows.length === 0 && <div className="px-4 py-6 text-sm text-[var(--muted)]">Nothing here{query ? " matches that search" : ""}.</div>}
        </div>
        {data.total > pageSize && (
          <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">
            <span>
              {num((data.page - 1) * pageSize + 1)}–{num(Math.min(data.total, data.page * pageSize))} of {num(data.total)}, biggest spenders first
            </span>
            <div className="flex items-center gap-2">
              {data.page > 1 ? (
                <Link className="rounded border border-[var(--border)] px-2 py-1" href={href(tab, data.page - 1)}>
                  Prev
                </Link>
              ) : (
                <span className="rounded border border-[var(--border)] px-2 py-1 opacity-40">Prev</span>
              )}
              <span>
                Page {data.page} of {totalPages}
              </span>
              {data.page < totalPages ? (
                <Link className="rounded border border-[var(--border)] px-2 py-1" href={href(tab, data.page + 1)}>
                  Next
                </Link>
              ) : (
                <span className="rounded border border-[var(--border)] px-2 py-1 opacity-40">Next</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <PageHeader
      area="guests"
      back={{ href: "/admin/members", label: "Members" }}
      title="Points from past card purchases"
      purpose={
        <>
          Regulars paid by card for years before the new system, then started at 0 points. Each card from the old card machine (Fortis) is matched to a
          member by the email or phone given with the payment, or the name on the card. Approve the matches, choose the rate, then Grant. Nothing is given
          until you press Grant. Members see it in their points history as &ldquo;Points from your past visits&rdquo;.
        </>
      }
    />
  );
}

function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{k}</div>
      <div className="text-xl font-bold tabular-nums">{v}</div>
      {sub && <div className="text-xs text-[var(--muted)]">{sub}</div>}
    </div>
  );
}

function Summary({ data }: { data: BackfillData }) {
  const s = data.summary;
  const k = s.byKind;
  const how = [k.email && `${num(k.email)} by email`, k.phone && `${num(k.phone)} by phone`, k.name && `${num(k.name)} by name`, k.picked && `${num(k.picked)} picked`]
    .filter(Boolean)
    .join(", ");
  const why = [k.pickName && `${num(k.pickName)} same name`, k.pickSimilar && `${num(k.pickSimilar)} similar name`, k.pickOther && `${num(k.pickOther)} email/phone`]
    .filter(Boolean)
    .join(", ");
  return (
    <section className="grid gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-3 lg:grid-cols-6">
      <Stat k="Cards" v={num(s.cards)} sub={s.loadedAt ? `loaded ${new Date(s.loadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })}` : undefined} />
      <Stat k="Matched" v={num(s.matched)} sub={how || undefined} />
      <Stat k="Needs a pick" v={num(s.needsPick)} sub={why || undefined} />
      <Stat k="Unclaimed" v={num(s.unclaimed)} sub="kept for later" />
      <Stat k="Dollars covered" v={money(s.dollars.matched)} sub={`of ${money(s.dollars.all)} on all cards`} />
      <Stat k="Granted so far" v={num(s.granted.points)} sub={`points to ${num(s.granted.members)} member${s.granted.members === 1 ? "" : "s"}`} />
    </section>
  );
}

function GrantPanel({
  members,
  settings,
  ok,
  rate,
  cap,
  taxOut,
  setRate,
  setCap,
  setTaxOut,
}: {
  members: MemberTotal[];
  settings: GrantSettings;
  ok: boolean;
  rate: string;
  cap: string;
  taxOut: boolean;
  setRate: (v: string) => void;
  setCap: (v: string) => void;
  setTaxOut: (v: boolean) => void;
}) {
  const [pending, run] = useRefreshingAction();
  const [confirming, setConfirming] = useState<{ settings: GrantSettings; members: number; points: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = ok ? settings : DEFAULT_GRANT_SETTINGS;
  const now = live(members, s, false);
  const all = live(members, s, true);
  const top = all.list.slice(0, 10);

  return (
    <section className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--muted)]">Points per $1</span>
          <input
            className="input !w-24"
            type="number"
            min="0.25"
            max="10"
            step="0.25"
            value={rate}
            onChange={(e) => {
              setRate(e.target.value);
              setConfirming(null);
            }}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--muted)]">Most per member</span>
          <input
            className="input !w-28"
            type="number"
            min="0"
            step="50"
            placeholder="No cap"
            value={cap}
            onChange={(e) => {
              setCap(e.target.value);
              setConfirming(null);
            }}
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={taxOut}
            onChange={(e) => {
              setTaxOut(e.target.checked);
              setConfirming(null);
            }}
          />
          Count before sales tax ({SALES_TAX_PERCENT}%), like points today
        </label>
        {!ok && <span className="pb-2 text-sm text-[var(--danger-text)]">The rate has to be between 0.25 and 10, and the cap 0 or more.</span>}
      </div>
      <p className="text-xs text-[var(--muted)]">
        Today a purchase earns 1 point per $1 before tax. The old card machine only kept what each card was charged (tax in, and tips if they were run on
        the card), so &ldquo;before sales tax&rdquo; takes the tax back out. Refunds are already taken off.
      </p>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Approved, ready to grant</div>
            <div className="text-2xl font-bold tabular-nums">{num(now.points)} points</div>
            <div className="text-sm text-[var(--muted)]">
              to {num(now.members)} member{now.members === 1 ? "" : "s"} for {money(now.dollars)} of purchases
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">If every match were approved</div>
            <div className="text-base font-semibold tabular-nums">
              {num(all.points)} points to {num(all.members)} members
            </div>
          </div>
          {result && <div className="notice notice-success text-sm">{result}</div>}
          {error && <div className="text-sm text-[var(--danger-text)]">{error}</div>}
          {confirming ? (
            <div className="space-y-2 rounded-lg border-2 border-[var(--foreground)] p-3 text-sm">
              <p>
                Grant <strong>{num(confirming.points)} points</strong> to <strong>{num(confirming.members)} members</strong>? Each gets one line in their points
                history, &ldquo;Points from your past visits&rdquo;. Approved cards are paid once and can&apos;t be granted again.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn-primary !px-4 !py-2 text-sm"
                  disabled={pending}
                  onClick={() => {
                    const c = confirming;
                    setError(null);
                    setResult(null);
                    run(
                      async () => {
                        const r = await grantBackfillPoints(c.settings, { members: c.members, points: c.points });
                        setConfirming(null);
                        if (!r.ok) {
                          setError(r.error);
                          return r;
                        }
                        setResult(`Granted ${num(r.points)} points to ${num(r.members)} members.`);
                        return r;
                      },
                      { quiet: true },
                    );
                  }}
                >
                  {pending ? "Granting…" : `Yes, grant ${num(confirming.points)} points`}
                </button>
                <button className="btn-secondary !px-4 !py-2 text-sm" disabled={pending} onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn-primary !px-4 !py-2 text-sm"
              disabled={pending || !ok || now.points === 0}
              onClick={() => {
                setResult(null);
                setError(null);
                setConfirming({ settings: s, members: now.members, points: now.points });
              }}
            >
              Grant points…
            </button>
          )}
        </div>

        <div className="min-w-0">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">Top members at these settings</div>
          {top.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No matches yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-1 font-normal">Member</th>
                    <th className="pb-1 text-right font-normal">Cards</th>
                    <th className="pb-1 text-right font-normal">Spent</th>
                    <th className="pb-1 text-right font-normal">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((m) => (
                    <tr key={m.memberId} className="border-t border-[var(--border)]">
                      <td className="py-1">
                        <Link href={`/admin/members/${m.memberId}`} className="hover:underline">
                          {m.name}
                        </Link>
                        {m.waitingDollars > 0 && <span className="ml-1.5 text-[11px] text-[var(--warn-text)]">not all approved</span>}
                        {m.alreadyGranted > 0 && <span className="ml-1.5 text-[11px] text-[var(--muted)]">+{num(m.alreadyGranted)} before</span>}
                      </td>
                      <td className="py-1 text-right">{m.cards}</td>
                      <td className="py-1 text-right">{money(m.dollars)}</td>
                      <td className="py-1 text-right font-semibold">{num(m.points)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function BulkActions({ exactWaiting }: { exactWaiting: number }) {
  const [pending, run] = useRefreshingAction();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        className="btn-secondary !px-4 !py-2 text-sm"
        disabled={pending || exactWaiting === 0}
        onClick={() => {
          if (!confirm(`Approve ${exactWaiting} exact match${exactWaiting === 1 ? "" : "es"}? (Email, phone, or the same name all the way through.) Nothing is granted yet.`)) return;
          setNote(null);
          run(async () => {
            const r = await approveExactMatches();
            if (r.ok) setNote(`Approved ${num(r.approved)}.`);
            return r;
          });
        }}
      >
        Approve all exact matches{exactWaiting ? ` (${num(exactWaiting)})` : ""}
      </button>
      <button
        className="btn-secondary !px-4 !py-2 text-sm"
        disabled={pending}
        onClick={() => {
          setNote(null);
          run(async () => {
            const r = await recheckMatches();
            if (r.ok) setNote(r.changed ? `${num(r.changed)} card${r.changed === 1 ? "" : "s"} matched differently now.` : "No changes: matches are up to date.");
            return r;
          });
        }}
      >
        {pending ? "Working…" : "Re-check matches"}
      </button>
      <span className="text-xs text-[var(--muted)]">Re-check after new members join. It only changes cards nobody has decided.</span>
      {note && <span className="text-sm text-[var(--success-text)]">{note}</span>}
    </div>
  );
}

function CardRow({ row, settings }: { row: BackfillRow; settings: GrantSettings }) {
  const [pending, run, error] = useRefreshingAction();
  const [picking, setPicking] = useState(false);
  const granted = !!row.grantedAt;
  const points = granted ? (row.grantedPoints ?? 0) : pointsForDollars(row.netTotal, settings);

  const decide = (d: "approved" | "skipped" | "pending") => run(() => decideCard(row.id, d), { quiet: true });
  const pick = (memberId: string) => run(() => pickCardMember(row.id, memberId), { quiet: true });

  return (
    <div className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[1.3fr_1.3fr_0.7fr_auto] md:items-center">
      <div className="min-w-0">
        {row.member ? (
          <Link href={`/admin/members/${row.member.id}`} className="font-medium hover:underline">
            {row.member.name}
          </Link>
        ) : row.status === "needs_pick" ? (
          <span className="font-medium text-[var(--warn-text)]">
            {row.kind === "similar" ? "Could be…" : row.candidates.length > 1 ? `${row.candidates.length} members fit` : "Needs a pick"}
          </span>
        ) : (
          <span className="text-[var(--muted)]">No member</span>
        )}
        <div className="mt-0.5 flex flex-wrap gap-1 text-[11px]">
          {row.kind && <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--muted)]">{KIND[row.kind] ?? row.kind}</span>}
          {row.confidence === "high" && <span className="rounded border border-[var(--success-text)] px-1.5 py-0.5 text-[var(--success-text)]">exact</span>}
          {row.confidence === "medium" && <span className="rounded border border-[var(--warn-text)] px-1.5 py-0.5 text-[var(--warn-text)]">check it</span>}
        </div>
        {row.status === "needs_pick" && !granted && row.decision !== "skipped" && row.candidates.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {row.candidates.map((c) => (
              <button key={c.id} disabled={pending} onClick={() => pick(c.id)} className="rounded border border-[var(--border)] px-2 py-0.5 text-xs hover:border-[var(--foreground)]">
                It&apos;s {c.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-w-0 text-xs">
        <div className="truncate">
          {BRAND[row.brand ?? ""] ?? "Card"} ••{row.lastFour}
          {row.holderName ? <> · {row.holderName}</> : <span className="text-[var(--muted)]"> · no name on card</span>}
        </div>
        <div className="text-[var(--muted)]">
          {num(row.saleCount)} purchase{row.saleCount === 1 ? "" : "s"} on {num(row.days)} day{row.days === 1 ? "" : "s"} · {monthYear(row.firstAt)}
          {monthYear(row.lastAt) !== monthYear(row.firstAt) && <>–{monthYear(row.lastAt)}</>}
          {row.refundCount > 0 && <> · {row.refundCount} refund{row.refundCount === 1 ? "" : "s"} taken off</>}
        </div>
      </div>
      <div className="tabular-nums md:text-right">
        <div className="font-semibold">{money(row.netTotal)}</div>
        <div className="text-xs text-[var(--muted)]">
          {num(points)} pts{granted ? " given" : ""}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
        {granted ? (
          <span className="text-xs font-semibold text-[var(--success-text)]">Granted ✓</span>
        ) : (
          <>
            {row.member && row.decision !== "approved" && (
              <button disabled={pending} onClick={() => decide("approved")} className="rounded border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--foreground)]">
                Approve
              </button>
            )}
            {row.decision !== "skipped" && (
              <button disabled={pending} onClick={() => decide("skipped")} className="rounded border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--danger-text)]">
                Skip
              </button>
            )}
            {row.decision !== "pending" && (
              <button disabled={pending} onClick={() => decide("pending")} className="rounded border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)] hover:border-[var(--foreground)]">
                Undo
              </button>
            )}
            <button disabled={pending} onClick={() => setPicking((v) => !v)} className="rounded border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)] hover:border-[var(--foreground)]">
              {picking ? "Close" : "Someone else…"}
            </button>
          </>
        )}
        {error && <span className="w-full text-xs text-[var(--danger-text)] md:text-right">{error}</span>}
      </div>
      {picking && !granted && (
        <div className="md:col-span-4">
          <MemberPicker
            disabled={pending}
            onPick={(id) => {
              setPicking(false);
              pick(id);
            }}
          />
        </div>
      )}
    </div>
  );
}

function MemberPicker({ onPick, disabled }: { onPick: (memberId: string) => void; disabled: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; hint: string }[]>([]);
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      startSearch(async () => {
        const r = await searchMembersToPick(q);
        setResults(r.ok ? r.members : []);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const shown = q.trim().length < 2 ? [] : results;
  return (
    <div className="rounded-lg border border-[var(--border)] p-2">
      <input className="input !py-1" autoFocus placeholder="Find a member by name, email or phone…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a member" />
      <div className="mt-1 flex flex-col">
        {shown.map((m) => (
          <button key={m.id} disabled={disabled} onClick={() => onPick(m.id)} className="flex items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-[var(--background)]">
            <span>{m.name}</span>
            <span className="text-xs text-[var(--muted)]">{m.hint}</span>
          </button>
        ))}
        {q.trim().length >= 2 && !searching && shown.length === 0 && <span className="px-2 py-1 text-xs text-[var(--muted)]">No members found.</span>}
      </div>
    </div>
  );
}
