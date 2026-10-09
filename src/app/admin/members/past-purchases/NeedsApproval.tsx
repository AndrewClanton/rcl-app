"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { QueueCard } from "@/lib/data/fortis-claim";
import { QUEUE_REASON_TEXT } from "@/lib/fortis-claim";
import { approveQueuedCard, rejectQueuedCard } from "./queue-actions";
import { rewindSearchMembers } from "./rewind-actions";

// Needs approval: old-register cards that aren't paid on their own (over
// 1,000 points, a close-but-not-exact name, more than one member fits, or
// claimed at the register for more than 1,000). One tap pays the card to
// the member shown, rejects it, or reassigns it. Managers and up.

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const num = (n: number) => n.toLocaleString("en-US");
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" }) : "?");

export default function NeedsApproval({ cards }: { cards: QueueCard[] }) {
  const total = cards.reduce((s, c) => s + c.points, 0);
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Needs approval</h2>
        <span className="text-sm text-[var(--muted)]">
          {cards.length ? `${num(cards.length)} card${cards.length === 1 ? "" : "s"} · ${num(total)} points` : "Nothing waiting"}
        </span>
      </div>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Cards from the old register that aren&apos;t paid on their own: over 1,000 points, a name that&apos;s close but not exact, more than one member who
        fits, or a big claim from the register. 1 point per $1 spent. Approve gives the points now; Reject leaves the card unpaid.
      </p>
      {cards.length > 0 && (
        <ul className="mt-3 divide-y divide-[var(--border)]">
          {cards.map((c) => (
            <QueueRow key={c.id} card={c} />
          ))}
        </ul>
      )}
    </section>
  );
}

function QueueRow({ card }: { card: QueueCard }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reassign, setReassign] = useState(false);

  const run = (fn: () => Promise<{ ok: true; points?: number } | { ok: false; error: string }>, done: (points?: number) => string) =>
    start(async () => {
      const r = await fn().catch(() => ({ ok: false as const, error: "Couldn't reach the server. Try again." }));
      setMsg(r.ok ? { ok: true, text: done(r.points) } : { ok: false, text: r.error });
      if (r.ok) router.refresh();
    });
  const approve = (m: { id: string; name: string }) =>
    run(() => approveQueuedCard(card.id, m.id), (p) => `${num(p ?? card.points)} points to ${m.name}.`);

  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono">····{card.lastFour}</span>
        <span>{card.brand}</span>
        {card.holderName && <span className="font-semibold">{card.holderName}</span>}
        <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">{QUEUE_REASON_TEXT[card.reason]}</span>
      </div>
      <div className="mt-0.5 text-xs text-[var(--muted)]">
        {num(card.visits)} visit{card.visits === 1 ? "" : "s"} · {day(card.firstAt)} to {day(card.lastAt)} · {money(card.netTotal)} · {num(card.points)} points
      </div>
      {msg ? (
        <div className={`mt-2 notice ${msg.ok ? "notice-success" : "notice-warn"} !p-2 text-xs`}>{msg.text}</div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {card.member && (
            <button className="btn-primary !px-3 !py-1 text-xs" disabled={busy} onClick={() => approve(card.member!)}>
              Approve for {card.member.name}
            </button>
          )}
          {card.member && (
            <Link href={`/admin/members/${card.member.id}`} className="text-xs underline text-[var(--muted)]">
              Their page
            </Link>
          )}
          {!card.member &&
            card.candidates.map((m) => (
              <button key={m.id} className="btn-secondary !px-3 !py-1 text-xs" disabled={busy} onClick={() => approve(m)}>
                Give to {m.name}
              </button>
            ))}
          <button className="btn-secondary !px-3 !py-1 text-xs" disabled={busy} onClick={() => setReassign((v) => !v)}>
            {card.member ? "Reassign" : "Someone else"}
          </button>
          <button className="btn-secondary !px-3 !py-1 text-xs" style={{ color: "var(--danger-text)" }} disabled={busy} onClick={() => run(() => rejectQueuedCard(card.id), () => "Rejected. No points given.")}>
            Reject
          </button>
        </div>
      )}
      {reassign && !msg && (
        <div className="mt-2 max-w-md">
          <MemberSearch onPick={(m) => { setReassign(false); approve(m); }} />
        </div>
      )}
    </li>
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
        {q.trim().length >= 2 && !searching && shown.length === 0 && <span className="px-2 py-1 text-xs text-[var(--muted)]">No members found.</span>}
      </div>
    </div>
  );
}
