"use client";

import { useEffect, useRef, useState } from "react";
import MemberAvatar from "@/components/MemberAvatar";
import { getRegulars, searchPosMembers, type PosMember, type Regular } from "./member-actions";
import { memberSignal } from "./member-signal";

// "Find by face", the bottom of the register's Customers tab. Opens on the
// regulars (most visits in the last 90 days first), and searching turns the
// grid into matches -- tap a face to put that member on the order. It used
// to be a full-screen window of its own; it lives in the tab now, next to
// who's checked in, so all the faces are in one place.
export default function MemberFinder({
  current,
  onPick,
  loadRegulars = getRegulars,
  search = searchPosMembers,
}: {
  current: PosMember | null;
  onPick: (m: PosMember) => void;
  loadRegulars?: () => Promise<Regular[]>;
  search?: (q: string, limit: number) => Promise<PosMember[]>;
}) {
  const [regulars, setRegulars] = useState<Regular[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    loadRegulars()
      .then(setRegulars)
      .catch(() => {
        setRegulars([]);
        setError("Couldn't load members. Check the connection.");
      });
  }, [loadRegulars]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const ticket = ++latest.current;
    const t = setTimeout(async () => {
      const found = await search(q, 24).catch(() => null);
      if (ticket !== latest.current) return;
      setResults(found ?? []);
      setError(found ? null : "Couldn't search. Check the connection.");
    }, 200);
    return () => clearTimeout(t);
  }, [query, search]);

  const searching = query.trim().length >= 2;
  const cards: { member: PosMember; note: string }[] = searching
    ? (results ?? []).map((m) => ({ member: m, note: m.tier }))
    : (regulars ?? []).map((r) => ({ member: r.member, note: r.visits ? `${r.visits} visit${r.visits === 1 ? "" : "s"}` : r.member.tier }));

  return (
    <section aria-labelledby="customers-find">
      <h2 id="customers-find" className="eyebrow mb-2">
        Find a customer
      </h2>
      <input
        type="search"
        className="input !py-3 !text-base"
        placeholder="Search by name, email or phone"
        aria-label="Search members by name, email or phone"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value.trim().length < 2) setResults(null);
        }}
      />
      <div className="mb-2 mt-3 text-xs font-bold" style={{ color: "var(--muted)" }}>
        {searching ? "Matches" : "Regulars · most visits in the last 90 days"}
      </div>
      {error && (
        <div className="mb-3 text-sm" style={{ color: "var(--danger-text)" }}>
          {error}
        </div>
      )}
      {(searching ? results === null : regulars === null) ? (
        <div className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>
          Loading…
        </div>
      ) : cards.length === 0 ? (
        <div className="py-8 text-center text-sm" style={{ color: "var(--muted)" }}>
          {searching ? "No member matches that." : "No visit history yet. Search above, or ask members to add a photo on their account."}
        </div>
      ) : (
        // As many columns as the panel has room for, whichever way the iPad is held.
        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(6.5rem,1fr))]">
          {cards.map(({ member, note }) => {
            const on = current?.id === member.id;
            return (
              <button
                key={member.id}
                className="flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-colors hover:border-[var(--foreground)] hover:bg-[var(--surface-hover)]"
                style={{ borderColor: on ? "var(--success-border)" : "var(--border)" }}
                onClick={() => onPick(member)}
              >
                <MemberAvatar name={member.name} url={member.avatar_url} size={72} plus={memberSignal(member) === "plus"} />
                <span className="line-clamp-2 text-sm font-bold leading-tight">{member.name}</span>
                <span className="text-[11px]" style={{ color: on ? "var(--success-text)" : "var(--muted)" }}>
                  {on ? "✓ On order" : note}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
