"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { MAX_PURCHASES, MAX_SHOWN, POSTING_DAYS, type LookupForm } from "@/lib/fortis-lookup";
import type { RewindCard, RewindPreview, RewindResult } from "@/lib/data/fortis-lookup";
import { rewindAssign, rewindFind, rewindGetPreview, rewindGive, rewindSearchMembers } from "./rewind-actions";

// Rewind: a regular who only ever tapped their card (no name on it) opens
// their bank app at the bar; the last 4 of the card and the date and amount
// of a purchase or two find it, and they get the points for visits they
// didn't know counted. Managers and up.

const BRAND: Record<string, string> = { visa: "Visa", mc: "Mastercard", disc: "Discover", amex: "Amex" };
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const num = (n: number) => n.toLocaleString("en-US");
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
function monthShort(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "America/Chicago" }) : "";
}
function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

type Row = { date: string; amount: string };
const EMPTY_ROW: Row = { date: "", amount: "" };

// VHS-label stripes.
function Stripes({ className = "" }: { className?: string }) {
  return (
    <div className={`flex h-1.5 overflow-hidden rounded-full ${className}`} aria-hidden="true">
      <span className="flex-1 bg-[#ed1c24]" />
      <span className="flex-1 bg-[#f58220]" />
      <span className="flex-1 bg-[#ffc72c]" />
      <span className="flex-1 bg-[#14110c]" />
    </div>
  );
}

export default function Rewind({ isAdmin }: { isAdmin: boolean }) {
  const [lastFour, setLastFour] = useState("");
  const [rows, setRows] = useState<Row[]>([{ ...EMPTY_ROW }]);
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<{ result: RewindResult; posting: boolean; lastFour: boolean; key: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finding, startFind] = useTransition();

  function find(withPosting = posting) {
    setError(null);
    const form: LookupForm = { lastFour, purchases: rows, postingDates: withPosting };
    startFind(async () => {
      try {
        const r = await rewindFind(form);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setResult({ result: r.result, posting: withPosting, lastFour: !!lastFour.trim(), key: Date.now() });
      } catch {
        setError("The lookup didn't work. Check the connection and try again.");
      }
    });
  }

  function startOver() {
    setLastFour("");
    setRows([{ ...EMPTY_ROW }]);
    setPosting(false);
    setResult(null);
    setError(null);
  }

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <section className="overflow-hidden rounded-xl border-2 border-[var(--foreground)] bg-[var(--surface)]">
      <div className="bg-[var(--foreground)] px-4 py-3 text-[var(--background)]">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-display text-2xl tracking-wide">
            <span aria-hidden="true">◀◀ </span>Rewind
          </h2>
          <p className="text-sm opacity-85">Find a regular&apos;s visits from before our new system and surprise them with the points they didn&apos;t know they had.</p>
        </div>
        <Stripes className="mt-2 max-w-xs" />
      </div>

      <div className="space-y-4 p-4">
        <p className="text-sm text-[var(--muted)]">
          Ask them to open their bank app and find a Royale Cinema purchase from before mid-September 2026. Type the last 4 of that card and the purchase&apos;s
          date and amount: the total charged, to the cent.
        </p>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            find();
          }}
        >
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--muted)]">Last 4 of the card</span>
              <input
                className="input !w-28 font-mono tracking-[0.3em]"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                placeholder="1234"
                value={lastFour}
                onChange={(e) => setLastFour(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </label>
            <span className="pb-2 text-xs text-[var(--muted)]">Strongly recommended: with it, one purchase is almost always enough.</span>
          </div>

          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-end gap-3">
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--muted)]">{rows.length > 1 ? `Purchase ${i + 1} date` : "Purchase date"}</span>
                  <input className="input !w-44" type="date" max={today()} value={r.date} onChange={(e) => setRow(i, { date: e.target.value })} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-[var(--muted)]">Amount</span>
                  <span className="relative block">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)]">$</span>
                    <input
                      className="input !w-32 !pl-6 tabular-nums"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="23.45"
                      value={r.amount}
                      onChange={(e) => setRow(i, { amount: e.target.value.replace(/[^\d.,$]/g, "").slice(0, 12) })}
                    />
                  </span>
                </label>
                {rows.length > 1 && (
                  <button
                    type="button"
                    className="mb-1 rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] hover:border-[var(--foreground)]"
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                    aria-label={`Remove purchase ${i + 1}`}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            {rows.length < MAX_PURCHASES && (
              <button type="button" className="text-sm font-medium underline-offset-2 hover:underline" onClick={() => setRows((rs) => [...rs, { ...EMPTY_ROW }])}>
                + Add another purchase
              </button>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={posting} onChange={(e) => setPosting(e.target.checked)} />
            <span>
              Their bank shows posting dates
              <span className="block text-xs text-[var(--muted)]">The purchase can be on that day or up to {POSTING_DAYS} days before it.</span>
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary !px-5 !py-2 text-sm" disabled={finding}>
              {finding ? "Rewinding…" : "◀◀ Rewind"}
            </button>
            {(result || error) && (
              <button type="button" className="btn-secondary !px-4 !py-2 text-sm" onClick={startOver} disabled={finding}>
                Start over
              </button>
            )}
            {error && <span className="text-sm text-[var(--danger-text)]">{error}</span>}
          </div>
        </form>

        {result && (
          <Results
            key={result.key}
            result={result.result}
            askedPosting={result.posting}
            askedLastFour={result.lastFour}
            isAdmin={isAdmin}
            onTryPosting={() => {
              setPosting(true);
              find(true);
            }}
            onStartOver={startOver}
          />
        )}
      </div>
    </section>
  );
}

function Results({
  result,
  askedPosting,
  askedLastFour,
  isAdmin,
  onTryPosting,
  onStartOver,
}: {
  result: RewindResult;
  askedPosting: boolean;
  askedLastFour: boolean;
  isAdmin: boolean;
  onTryPosting: () => void;
  onStartOver: () => void;
}) {
  if (result.verdict === "none" || !result.cards.length) {
    return (
      <div className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] p-4 text-sm">
        <p className="font-semibold">No card fits that.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {!askedPosting && (
            <li>
              Banks often show the day a purchase cleared, a day or two after the visit.{" "}
              <button type="button" className="font-semibold underline" onClick={onTryPosting}>
                Try again with posting dates
              </button>
            </li>
          )}
          <li>Check the amount: the total charged, with tax (and any tip), to the cent.</li>
          {askedLastFour && <li>Check the last 4. A card that was replaced since has new digits.</li>}
          <li>Try a different purchase. The old card machine was used until mid-September 2026.</li>
        </ul>
      </div>
    );
  }
  if (result.verdict === "several") {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] p-3 text-sm">
          <p>
            <strong>{num(result.total)} cards fit.</strong> Add another purchase{askedLastFour ? "" : " or the last 4"} to narrow it down.
          </p>
        </div>
        <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {result.cards.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <CardLine card={c} />
              <StatusChip card={c} />
            </div>
          ))}
          {result.total > MAX_SHOWN && <div className="px-3 py-2 text-xs text-[var(--muted)]">and {num(result.total - MAX_SHOWN)} more</div>}
        </div>
      </div>
    );
  }
  return <Found initial={result.cards[0]} isAdmin={isAdmin} onStartOver={onStartOver} />;
}

function CardLine({ card }: { card: RewindCard }) {
  return (
    <div className="min-w-0">
      <div className="truncate">
        <span className="font-mono">
          {BRAND[card.brand ?? ""] ?? "Card"} ••{card.lastFour}
        </span>
        {card.holderName ? <> · {card.holderName}</> : <span className="text-[var(--muted)]"> · no name on the card</span>}
      </div>
      <div className="text-xs text-[var(--muted)]">
        {num(card.visits)} visit{card.visits === 1 ? "" : "s"} · {money(card.netTotal)} · {monthShort(card.firstAt)}
        {monthShort(card.lastAt) !== monthShort(card.firstAt) && <>–{monthShort(card.lastAt)}</>}
      </div>
    </div>
  );
}

function StatusChip({ card }: { card: RewindCard }) {
  const [text, tone] =
    card.status === "granted"
      ? [`Already given${card.member ? ` to ${card.member.name}` : ""}`, "success"]
      : card.status === "matched"
        ? [`${card.approved ? "Approved for" : "Matched to"} ${card.member?.name ?? "a member"}`, "plain"]
        : card.status === "needs_pick"
          ? ["Needs a pick", "warn"]
          : card.status === "skipped"
            ? ["Skipped", "plain"]
            : card.status === "removed"
              ? ["Not available", "plain"]
              : ["Unclaimed", "warn"];
  const cls =
    tone === "success"
      ? "border-[var(--success-text)] text-[var(--success-text)]"
      : tone === "warn"
        ? "border-[var(--warn-text)] text-[var(--warn-text)]"
        : "border-[var(--border)] text-[var(--muted)]";
  return <span className={`rounded border px-1.5 py-0.5 text-[11px] ${cls}`}>{text}</span>;
}

// One card: the celebration, then who it is and the points.
function Found({ initial, isAdmin, onStartOver }: { initial: RewindCard; isAdmin: boolean; onStartOver: () => void }) {
  const [card, setCard] = useState(initial);
  const [assigned, setAssigned] = useState<{ member: { id: string; name: string }; preview: RewindPreview | null } | null>(null);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);
  const [pending, run, error] = useRefreshingAction();

  function assign(member: { id: string; name: string }) {
    run(
      async () => {
        const r = await rewindAssign(card.id, member.id, card.seen);
        if (r.ok) {
          if (r.card) setCard(r.card);
          setAssigned({ member, preview: r.preview });
          setPicking(false);
        }
        return r;
      },
      { quiet: true },
    );
  }

  const given = card.status === "granted";
  return (
    <div className="overflow-hidden rounded-xl border-2 border-[var(--foreground)]">
      <div className="bg-[var(--gold)] px-5 py-5 text-[var(--gold-foreground)]">
        <div className="font-display text-4xl leading-none sm:text-5xl">Found you!</div>
        <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <div className="font-display text-3xl leading-none tabular-nums">
              {num(card.visits)} visit{card.visits === 1 ? "" : "s"}
            </div>
            {card.since && <div className="mt-1 text-sm font-semibold">since {card.since}</div>}
          </div>
          <div>
            <div className="font-display text-6xl leading-none tabular-nums">{num(card.points)}</div>
            <div className="mt-1 text-sm font-semibold">{given ? "points, already given" : "points they didn't know they had"}</div>
          </div>
        </div>
        <Stripes className="mt-4 max-w-[12rem]" />
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <CardLine card={card} />
          <StatusChip card={card} />
        </div>

        {given ? (
          <p className="text-sm">
            {card.member ? (
              <Link href={`/admin/members/${card.member.id}`} className="font-semibold hover:underline">
                {card.member.name}
              </Link>
            ) : (
              "Someone"
            )}{" "}
            already got {num(card.grantedPoints ?? 0)} points for this card
            {card.grantedAt ? ` on ${new Date(card.grantedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" })}` : ""}. A
            card is only ever paid once.
          </p>
        ) : card.status === "removed" ? (
          <p className="text-sm text-[var(--muted)]">This card&apos;s member asked for their info to be removed, so it can&apos;t be assigned.</p>
        ) : card.assign === "no" ? (
          <p className="text-sm text-[var(--muted)]">An owner or admin skipped this card, so it can&apos;t be assigned here. Ask one of them to look at it.</p>
        ) : assigned ? (
          <Give member={assigned.member} initial={assigned.preview} onStartOver={onStartOver} />
        ) : (
          <div className="space-y-3">
            {card.member && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span>
                  {card.approved ? "Approved for" : "Matched to"} <strong>{card.member.name}</strong>
                  {card.approved ? "" : " (not confirmed yet)"}. Is it them?
                </span>
                <button className="btn-primary !px-4 !py-2 text-sm" disabled={pending} onClick={() => assign(card.member!)}>
                  {pending ? "Saving…" : `Yes, it's ${firstName(card.member.name)}`}
                </button>
                {card.assign === "open" && !picking && (
                  <button className="btn-secondary !px-4 !py-2 text-sm" disabled={pending} onClick={() => setPicking(true)}>
                    Someone else…
                  </button>
                )}
              </div>
            )}
            {(!card.member || picking) && card.assign === "open" && (
              <div className="space-y-2">
                <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Who is it?</div>
                {chosen ? (
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <button className="btn-primary !px-4 !py-2 text-sm" disabled={pending} onClick={() => assign(chosen)}>
                      {pending ? "Saving…" : `Assign to ${chosen.name}`}
                    </button>
                    <button className="text-sm text-[var(--muted)] underline" disabled={pending} onClick={() => setChosen(null)}>
                      Pick someone else
                    </button>
                  </div>
                ) : (
                  <MemberSearch onPick={setChosen} />
                )}
                {card.member && <p className="text-xs text-[var(--muted)]">Assigning it to someone else replaces the match to {card.member.name}.</p>}
              </div>
            )}
            {isAdmin && card.assign === "open" && card.status === "skipped" && <p className="text-xs text-[var(--muted)]">This card was skipped. Assigning it approves it for that member.</p>}
          </div>
        )}
        {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}
      </div>
    </div>
  );
}

function MemberSearch({ onPick }: { onPick: (m: { id: string; name: string }) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; hint: string }[]>([]);
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => {
      startSearch(async () => {
        const r = await rewindSearchMembers(q).catch(() => null);
        setResults(r?.ok ? r.members : []);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const shown = q.trim().length < 2 ? [] : results;
  return (
    <div className="rounded-lg border border-[var(--border)] p-2">
      <input className="input !py-1" autoFocus placeholder="Find the member by name, email or phone…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a member" />
      <div className="mt-1 flex flex-col">
        {shown.map((m) => (
          <button key={m.id} type="button" onClick={() => onPick({ id: m.id, name: m.name })} className="flex items-center justify-between gap-3 rounded px-2 py-1 text-left text-sm hover:bg-[var(--background)]">
            <span>{m.name}</span>
            <span className="text-xs text-[var(--muted)]">{m.hint}</span>
          </button>
        ))}
        {q.trim().length >= 2 && !searching && shown.length === 0 && <span className="px-2 py-1 text-xs text-[var(--muted)]">No members found. They may need to join first.</span>}
      </div>
    </div>
  );
}

// "Give <first name> these points now", with a confirm step.
function Give({ member, initial, onStartOver }: { member: { id: string; name: string }; initial: RewindPreview | null; onStartOver: () => void }) {
  const [preview, setPreview] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [celebrate, setCelebrate] = useState(true);
  const [done, setDone] = useState<{ points: number; balance: number; already: boolean; tablet: "sent" | "off" | "missed" } | null>(null);
  const [pending, run, error] = useRefreshingAction();
  // A second click before React re-renders the button as disabled.
  const sending = useRef(false);
  const first = firstName(member.name);

  function give() {
    if (!preview || sending.current) return;
    sending.current = true;
    const p = preview;
    run(
      async () => {
        try {
          const r = await rewindGive(member.id, p.cards.map((c) => c.id), p.points, celebrate);
          if (r.ok) {
            setDone({ points: r.points, balance: r.balance, already: r.already, tablet: r.tablet });
            setConfirming(false);
          } else {
            // Show the numbers as they are now.
            const fresh = await rewindGetPreview(member.id).catch(() => null);
            if (fresh?.ok) setPreview(fresh.preview);
          }
          return r;
        } finally {
          sending.current = false;
        }
      },
      { quiet: true },
    );
  }

  const assignedLine = (
    <p className="text-sm">
      <span className="font-semibold text-[var(--success-text)]">✓</span> This card is now{" "}
      <Link href={`/admin/members/${member.id}`} className="font-semibold hover:underline">
        {member.name}
      </Link>
      &apos;s.
    </p>
  );

  if (done) {
    return (
      <div className="space-y-3">
        {assignedLine}
        <div className="rounded-lg border-2 border-[var(--foreground)] bg-[var(--gold)] p-4 text-[var(--gold-foreground)]">
          <div className="font-display text-2xl">{done.already ? `${first} already has these points.` : `+${num(done.points)} points for ${first}!`}</div>
          <div className="mt-1 text-sm font-semibold">Balance now {num(Math.floor(done.balance))} points.</div>
          {done.tablet === "sent" && <div className="mt-1 text-sm">Celebrating on the bar tablet now.</div>}
          {done.tablet === "missed" && <div className="mt-1 text-sm">The bar tablet didn&apos;t answer, but the points are in.</div>}
        </div>
        <button className="btn-secondary !px-4 !py-2 text-sm" onClick={onStartOver}>
          ◀◀ Rewind someone else
        </button>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="space-y-2">
        {assignedLine}
        <p className="text-sm text-[var(--muted)]">Nothing is waiting to be given for {first}.</p>
        {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {assignedLine}
      {preview.points === 0 ? (
        <p className="text-sm text-[var(--muted)]">No points to give: refunds cancel out the purchases, or {first} has reached the most anyone gets from this.</p>
      ) : confirming ? (
        <div className="space-y-3 rounded-lg border-2 border-[var(--foreground)] p-4">
          <div className="font-display text-3xl tabular-nums">+{num(preview.points)} points</div>
          <div className="text-sm tabular-nums">
            Balance {num(Math.floor(preview.balance))} → <strong>{num(Math.floor(preview.after))}</strong>
          </div>
          <div className="text-xs text-[var(--muted)]">
            {num(preview.visits)} visit{preview.visits === 1 ? "" : "s"}
            {preview.since ? ` since ${preview.since}` : ""} · card{preview.cards.length === 1 ? "" : "s"} ending {preview.cards.map((c) => c.lastFour).join(", ")} · {preview.settings}. It
            shows in their points history as &ldquo;Points from your past visits&rdquo;.
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={celebrate} onChange={(e) => setCelebrate(e.target.checked)} />
            Celebrate on the bar tablet (their first name and points)
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary !px-4 !py-2 text-sm" disabled={pending} onClick={give}>
              {pending ? "Giving…" : `Yes, give ${num(preview.points)} points`}
            </button>
            <button className="btn-secondary !px-4 !py-2 text-sm" disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary !px-5 !py-2.5 text-base" onClick={() => setConfirming(true)}>
            Give {first} these points now
          </button>
          <span className="text-xs text-[var(--muted)]">Or leave it: it&apos;s approved, and the next Grant pays it.</span>
        </div>
      )}
      {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}
    </div>
  );
}
