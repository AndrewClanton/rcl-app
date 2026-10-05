"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PointsHistoryRow } from "@/lib/data/points-history";
import { BADGES } from "@/lib/visits";
import { MAX_POINTS_CHANGE, adjustmentNote, formatPoints, pointsReasonProblem, rewardOff } from "@/lib/points-history";
import InfoTip from "@/components/help/InfoTip";
import { changeMemberPoints, loadPointsHistory } from "../actions";

// A member's points work like a bank account: the balance only moves by a
// line in their points history, and every line says why. Staff add or take
// away an amount with a reason; nobody types a new balance over the old one.

// ---------- the balance, and "Add or take away points" ----------

// canChange: managers and up (changeMemberPoints refuses anyone else). A
// cashier sees the balance and the history, and a note instead.
export function PointsBalance({ memberId, balance, canChange }: { memberId: string; balance: number; canChange: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"add" | "take">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  // A second click before React re-renders the button as disabled.
  const sending = useRef(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const n = /^\d+$/.test(amount) ? Number(amount) : NaN;
  const delta = Number.isFinite(n) ? (mode === "add" ? n : -n) : NaN;
  const after = balance + delta;
  const most = Math.max(0, Math.floor(balance));
  const problem = !amount
    ? "Enter how many points."
    : !Number.isFinite(n) || n === 0
      ? "Enter a whole number of points, like 50."
      : n > MAX_POINTS_CHANGE
        ? `One change can move at most ${formatPoints(MAX_POINTS_CHANGE)} points.`
        : delta < 0 && after < 0
          ? `They have ${formatPoints(balance)} points, so you can take away at most ${formatPoints(most)}.`
          : pointsReasonProblem(reason);

  function typeAmount(value: string) {
    // A minus sign typed in front means take away; a plus, add.
    const v = value.trim();
    if (v.startsWith("-") || v.startsWith("−")) setMode("take");
    else if (v.startsWith("+")) setMode("add");
    setAmount(v.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 7));
    setConfirming(false);
  }

  function reset() {
    setMode("add");
    setAmount("");
    setReason("");
    setConfirming(false);
  }

  function confirm() {
    if (problem || sending.current) return;
    sending.current = true;
    setResult(null);
    const change = { amount: delta, reason: reason.trim(), expectedBalance: balance };
    startTransition(async () => {
      const r = await changeMemberPoints(memberId, change).catch(() => null);
      sending.current = false;
      if (!r) {
        // Pressing Confirm again is safe: the same change isn't added twice.
        setResult({ ok: false, text: "Couldn't reach the server. Check the history below, then confirm again if it isn't there." });
        router.refresh();
        return;
      }
      if (r.ok) {
        reset();
        setOpen(false);
        setResult({ ok: true, text: r.message });
      } else {
        setResult({ ok: false, text: r.error });
      }
      router.refresh();
    });
  }

  return (
    <div>
      <div className="mb-1 text-xs text-[var(--muted)]">
        Points
        <InfoTip topic="points-history" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-2xl font-semibold tabular-nums">{formatPoints(balance)}</span>
        <span className="text-sm text-[var(--muted)]">points</span>
        {!canChange && <span className="text-xs text-[var(--muted)]">A manager can add or take away points.</span>}
        {canChange && !open && (
          <button
            type="button"
            className="rounded border border-[var(--border)] px-3 py-1.5 text-sm hover:border-[var(--foreground)]"
            onClick={() => {
              reset();
              setResult(null);
              setOpen(true);
            }}
          >
            Add or take away points
          </button>
        )}
        {result && !open && (
          <span className={`text-sm ${result.ok ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}`} role={result.ok ? "status" : "alert"}>
            {result.text}
          </span>
        )}
      </div>

      {canChange && open && (
        <div className="mt-3 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-hover)] p-3">
          {!confirming ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!problem) setConfirming(true);
              }}
            >
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex gap-1" role="group" aria-label="Add or take away">
                  <button type="button" className={`chip ${mode === "add" ? "chip-selected" : ""}`} aria-pressed={mode === "add"} onClick={() => setMode("add")}>
                    + Add
                  </button>
                  <button type="button" className={`chip ${mode === "take" ? "chip-selected" : ""}`} aria-pressed={mode === "take"} onClick={() => setMode("take")}>
                    − Take away
                  </button>
                </div>
                <label className="text-xs text-[var(--muted)]">
                  How many points
                  <input
                    inputMode="numeric"
                    autoComplete="off"
                    className="mt-1 block w-32 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm tabular-nums text-[var(--foreground)]"
                    placeholder="e.g. 50"
                    value={amount}
                    onChange={(e) => typeAmount(e.target.value)}
                    autoFocus
                  />
                </label>
              </div>
              <label className="block text-xs text-[var(--muted)]">
                Why (required)
                <input
                  className="mt-1 block w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--foreground)]"
                  placeholder="e.g. Birthday party credit, Points from old card purchases, Fixed a double charge"
                  maxLength={200}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setConfirming(false);
                  }}
                />
                <span className="mt-1 block">
                  The member sees this on their account as &ldquo;From the RCL crew: &hellip;&rdquo;. Your name is kept for the back office only.
                </span>
              </label>
              {(amount || reason) && problem && <p className="text-sm text-[var(--danger-text)]">{problem}</p>}
              {result && !result.ok && (
                <p className="text-sm text-[var(--danger-text)]" role="alert">
                  {result.text}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40" disabled={!!problem}>
                  Review
                </button>
                <button type="button" className="text-sm text-[var(--muted)] hover:underline" onClick={() => setOpen(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-sm">
                <strong>
                  {delta > 0 ? "Add" : "Take away"} {formatPoints(Math.abs(delta))} point{Math.abs(delta) === 1 ? "" : "s"}
                </strong>
                : {reason.trim()}
              </p>
              <p className="text-base">
                Balance goes from <strong className="tabular-nums">{formatPoints(balance)}</strong> to{" "}
                <strong className="tabular-nums">{Number.isFinite(after) ? formatPoints(after) : "?"}</strong>.
              </p>
              {problem && <p className="text-sm text-[var(--danger-text)]">{problem}</p>}
              {result && !result.ok && (
                <p className="text-sm text-[var(--danger-text)]" role="alert">
                  {result.text}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={pending || !!problem} onClick={confirm}>
                  {pending ? "Saving..." : "Confirm"}
                </button>
                <button type="button" className="text-sm text-[var(--muted)] hover:underline disabled:opacity-40" disabled={pending} onClick={() => setConfirming(false)}>
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- the points history: a bank statement ----------

const BADGE_EMOJI = new Map(BADGES.map((b) => [b.label, b.emoji]));

// Who made the change: staff for a manual one, the system for the rest.
const MANUAL = new Set(["adjustment", "merge", "backfill"]);

function orderLink(r: PointsHistoryRow) {
  return r.orderNumber !== null ? (
    <Link href={`/admin/reports?order=${r.orderNumber}`} className="text-[var(--accent)] hover:underline">
      order #{r.orderNumber}
    </Link>
  ) : null;
}

function WhatHappened({ r }: { r: PointsHistoryRow }) {
  const detail = (text: string | null | undefined) => (text ? <div className="text-xs text-[var(--muted)]">{text}</div> : null);
  const order = orderLink(r);
  switch (r.reason) {
    case "visit":
      return <>Check-in</>;
    case "badge": {
      const emoji = r.note ? BADGE_EMOJI.get(r.note) : undefined;
      return <>Badge: {emoji ? `${emoji} ` : ""}{r.note ?? "earned"}</>;
    }
    case "purchase":
      if (order) return <>Purchase, {order}</>;
      if (r.bookingId || r.movie) {
        return (
          <>
            Tickets bought online
            {detail([r.movie, r.note].filter(Boolean).join(" · "))}
          </>
        );
      }
      return (
        <>
          Purchase
          {detail(r.note)}
        </>
      );
    case "redeem":
      return (
        <>
          Redeemed for {rewardOff(r.note, r.delta)}
          {order ? <>, {order}</> : null}
        </>
      );
    case "refund":
      return (
        <>
          {order ? <>Refund, {order}</> : r.bookingId || r.movie ? "Ticket refund" : "Refund"}
          {detail([r.movie, r.note].filter(Boolean).join(" · "))}
        </>
      );
    case "welcome_bonus":
      return <>{r.note ?? "Welcome bonus"}</>;
    case "adjustment": {
      const note = adjustmentNote(r.note);
      return note ? (
        <>
          Adjustment: <span className="font-medium">{note}</span>
        </>
      ) : (
        <>
          Adjustment <span className="text-[var(--muted)]">(no reason recorded)</span>
        </>
      );
    }
    case "opening_balance":
      return (
        <>
          Opening balance
          {detail(r.note)}
        </>
      );
    case "merge":
      return (
        <>
          Merged from a duplicate account
          {detail(r.note && r.note !== "Merged from a duplicate account" ? r.note : null)}
        </>
      );
    case "backfill":
      // Granted from Members > Points from past card purchases.
      return (
        <>
          Past card purchases
          {detail("From the old card machine, before the new system")}
        </>
      );
    default:
      return (
        <>
          {r.reason}
          {detail(r.note)}
        </>
      );
  }
}

export function PointsHistoryCard({ memberId, initial }: { memberId: string; initial: { rows: PointsHistoryRow[]; total: number } }) {
  const [rows, setRows] = useState(initial.rows);
  const [total, setTotal] = useState(initial.total);
  const [seen, setSeen] = useState(initial);
  const [loading, startLoading] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // A refresh (after an adjustment, say) brings the newest page again: put
  // it on top and keep the older rows already shown.
  if (seen !== initial) {
    setSeen(initial);
    const fresh = new Set(initial.rows.map((r) => r.id));
    setRows([...initial.rows, ...rows.filter((r) => !fresh.has(r.id))]);
    setTotal(initial.total);
  }

  function showMore() {
    setError(null);
    startLoading(async () => {
      const more = await loadPointsHistory(memberId, rows.length).catch(() => null);
      if (!more) return setError("Couldn't load more. Try again.");
      setRows((cur) => {
        const have = new Set(cur.map((r) => r.id));
        return [...cur, ...more.rows.filter((r) => !have.has(r.id))];
      });
      setTotal(more.total);
    });
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="mb-1 text-lg font-semibold">
        Points history
        <InfoTip topic="points-history" />
      </h2>
      <p className="mb-3 text-sm text-[var(--muted)]">Every change to their points, newest first. The member sees the same list on their account, without staff names.</p>
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No points activity yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
                <th className="py-2 pr-3 font-medium">When (Central)</th>
                <th className="py-2 pr-3 font-medium">What happened</th>
                <th className="py-2 pr-3 text-right font-medium">Points</th>
                <th className="py-2 pr-3 text-right font-medium">Balance</th>
                <th className="py-2 font-medium">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap py-2 pr-3 text-[var(--muted)]">{r.when}</td>
                  <td className="py-2 pr-3">
                    <WhatHappened r={r} />
                  </td>
                  <td className={`whitespace-nowrap py-2 pr-3 text-right font-semibold tabular-nums ${r.delta < 0 ? "text-[var(--danger-text)]" : "text-[var(--success-text)]"}`}>
                    {r.delta < 0 ? "−" : "+"}
                    {formatPoints(Math.abs(r.delta))}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{formatPoints(r.balance)}</td>
                  <td className="whitespace-nowrap py-2 text-[var(--muted)]">{MANUAL.has(r.reason) ? (r.staffName ?? "Staff") : "Automatic"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length < total && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className="rounded border border-[var(--border)] px-3 py-1.5 text-sm hover:border-[var(--foreground)] disabled:opacity-40" disabled={loading} onClick={showMore}>
            {loading ? "Loading..." : `Show more (${(total - rows.length).toLocaleString("en-US")} older)`}
          </button>
          {error && <span className="text-sm text-[var(--danger-text)]">{error}</span>}
        </div>
      )}
    </div>
  );
}
