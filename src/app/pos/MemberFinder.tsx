"use client";

import { useEffect, useRef, useState } from "react";
import MemberAvatar from "@/components/MemberAvatar";
import { getRegulars, searchPosMembers, type PosMember, type Regular } from "./member-actions";

// Full-screen "find by face" lookup for the register. Opens on the regulars
// (most visits in the last 90 days first), and searching turns the grid
// into matches -- tap a face to attach that member to the order.
export default function MemberFinder({
  onPick,
  onClose,
  loadRegulars = getRegulars,
  search = searchPosMembers,
}: {
  onPick: (m: PosMember) => void;
  onClose: () => void;
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
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Find a member">
      <div className="card flex max-h-full w-full max-w-4xl flex-col !p-0 shadow-2xl">
        <div className="flex items-center gap-3 border-b p-4" style={{ borderColor: "var(--border)" }}>
          <input
            autoFocus
            className="input flex-1 !py-3 !text-base"
            placeholder="Search by name, email or phone"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value.trim().length < 2) setResults(null);
            }}
          />
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          <div className="eyebrow mb-3">{searching ? "Matches" : "Regulars · most visits in the last 90 days"}</div>
          {error && (
            <div className="mb-3 text-sm" style={{ color: "var(--danger-text)" }}>
              {error}
            </div>
          )}
          {(searching ? results === null : regulars === null) ? (
            <div className="py-10 text-center text-sm" style={{ color: "var(--muted)" }}>
              Loading…
            </div>
          ) : cards.length === 0 ? (
            <div className="py-10 text-center text-sm" style={{ color: "var(--muted)" }}>
              {searching ? "No member matches that." : "No visit history yet. Search above, or ask members to add a photo on their account."}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {cards.map(({ member, note }) => (
                <button
                  key={member.id}
                  className="flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition-colors hover:border-[var(--foreground)] hover:bg-[var(--surface-hover)]"
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => onPick(member)}
                >
                  <MemberAvatar name={member.name} url={member.avatar_url} size={76} />
                  <span className="line-clamp-2 text-sm font-bold leading-tight">{member.name}</span>
                  <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                    {note}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
