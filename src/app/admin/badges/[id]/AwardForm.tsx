"use client";

import { useState, useTransition } from "react";
import { awardBadge, searchMembersForBadge } from "../actions";

// Award by hand: find a member, add what it's for (optional, shows on the
// back of their card), give it. Their points come with it, and their
// signed copy is minted on the spot.
export default function AwardForm({ defId, name, active }: { defId: string; name: string; active: boolean }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ id: string; name: string; hint: string }[]>([]);
  const [pick, setPick] = useState<{ id: string; name: string } | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; code?: string | null } | null>(null);
  const [pending, start] = useTransition();

  function search(q: string) {
    setQuery(q);
    setPick(null);
    if (q.trim().length < 2) return setFound([]);
    start(async () => {
      const r = await searchMembersForBadge(q);
      if (r.ok) setFound(r.members);
    });
  }

  function give() {
    if (!pick) return;
    start(async () => {
      const r = await awardBadge(defId, pick.id, note);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setMsg({ ok: true, text: `${pick.name} has ${name} now.`, code: r.code });
      setPick(null);
      setQuery("");
      setFound([]);
      setNote("");
    });
  }

  if (!active) return <p className="text-sm text-[var(--muted)]">This badge is switched off, so it can&apos;t be given.</p>;

  return (
    <div className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="font-bold">Award by hand</h2>
      <label className="mt-2 block text-sm font-bold" htmlFor="award-member">
        Member
      </label>
      <input
        id="award-member"
        className="mt-1 w-full rounded-[8px] border border-[var(--border)] bg-[var(--background)] px-3 py-2"
        placeholder="Name, email or phone"
        value={pick ? pick.name : query}
        onChange={(e) => search(e.target.value)}
        autoComplete="off"
      />
      {!pick && found.length > 0 && (
        <ul className="mt-1 divide-y divide-[var(--border)] rounded-[8px] border border-[var(--border)]">
          {found.map((m) => (
            <li key={m.id}>
              <button type="button" className="w-full px-3 py-2 text-left hover:bg-[var(--surface-hover)]" onClick={() => setPick({ id: m.id, name: m.name })}>
                <span className="font-bold">{m.name}</span> <span className="text-sm text-[var(--muted)]">{m.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="mt-3 block text-sm font-bold" htmlFor="award-note">
        For (optional, on the back of the card)
      </label>
      <input
        id="award-note"
        className="mt-1 w-full rounded-[8px] border border-[var(--border)] bg-[var(--background)] px-3 py-2"
        maxLength={40}
        placeholder="Trivia night, Oct 2"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button type="button" className="btn-primary mt-3 px-4 py-2 disabled:opacity-50" disabled={!pick || pending} onClick={give}>
        {pending ? "Working…" : pick ? `Give it to ${pick.name}` : "Give it"}
      </button>
      {msg && (
        <p className={`mt-2 text-sm ${msg.ok ? "" : "text-[var(--accent)]"}`} role="status">
          {msg.text}
          {msg.code && (
            <>
              {" "}
              <a href={`/b/${msg.code}`} target="_blank" rel="noreferrer" className="font-bold text-[var(--accent)] hover:underline">
                See the card
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
