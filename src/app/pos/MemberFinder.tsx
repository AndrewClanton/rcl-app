"use client";

import { useEffect, useRef, useState } from "react";
import MemberAvatar from "@/components/MemberAvatar";
import { createPhoneMember, getRegulars, searchPosMembers, type PosMember, type Regular } from "./member-actions";
import { memberSignal } from "./member-signal";
import { formatPhone, isFullPhone, phoneDigits } from "@/lib/checkin";

// A search that's a phone number (only digits and phone punctuation), for
// filling in the new account's number.
function searchDigits(q: string): string {
  return /^[\d\s().+-]+$/.test(q.trim()) ? phoneDigits(q).slice(0, 10) : "";
}

// "Find by face", the bottom of the register's Customers tab. Opens on the
// regulars (most visits in the last 90 days first), and searching turns the
// grid into matches -- tap a face to put that member on the order. It used
// to be a full-screen window of its own; it lives in the tab now, next to
// who's checked in, so all the faces are in one place.
// allowNew: "New phone account" (lib/member-name.ts) for a guest standing
// there: their number, maybe a first name, and they're on the order.
export default function MemberFinder({
  current,
  onPick,
  loadRegulars = getRegulars,
  search = searchPosMembers,
  allowNew = false,
  makePhoneAccount = createPhoneMember,
}: {
  current: PosMember | null;
  onPick: (m: PosMember) => void;
  loadRegulars?: () => Promise<Regular[]>;
  search?: (q: string, limit: number) => Promise<PosMember[]>;
  allowNew?: boolean;
  makePhoneAccount?: typeof createPhoneMember;
}) {
  const [regulars, setRegulars] = useState<Regular[] | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The "New phone account" form, open with the number so far.
  const [making, setMaking] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);
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
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="customers-find" className="eyebrow">
          Find a customer
        </h2>
        {allowNew && making === null && (
          <button
            className="btn-secondary min-h-10 shrink-0 !px-3 !py-1.5 text-sm"
            onClick={() => {
              setMade(null);
              setMaking(searchDigits(query));
            }}
          >
            📞 New phone account
          </button>
        )}
      </div>
      {made && (
        <div className="notice notice-success mb-2 p-2 text-sm" role="status">
          {made}
        </div>
      )}
      {allowNew && making !== null && (
        <NewPhoneAccount
          start={making}
          make={makePhoneAccount}
          onCancel={() => setMaking(null)}
          onDone={(m, message) => {
            setMaking(null);
            setMade(message);
            setQuery("");
            setResults(null);
            onPick(m);
          }}
        />
      )}
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
          {searching && allowNew && making === null && isFullPhone(searchDigits(query)) && (
            <div className="mt-3">
              <button
                className="btn-primary min-h-11 !px-4 !py-2 text-sm"
                onClick={() => {
                  setMade(null);
                  setMaking(searchDigits(query));
                }}
              >
                Make a phone account for {formatPhone(searchDigits(query))}
              </button>
            </div>
          )}
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

// Their number and, if they like, a first name. A number that's on an
// account already puts that account on the order instead.
function NewPhoneAccount({
  start,
  make,
  onCancel,
  onDone,
}: {
  start: string;
  make: typeof createPhoneMember;
  onCancel: () => void;
  onDone: (m: PosMember, message: string) => void;
}) {
  const [phone, setPhone] = useState(start ? formatPhone(start) : "");
  const [first, setFirst] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const digits = phoneDigits(phone);
  const ready = isFullPhone(digits);

  async function save() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const r = await make({ phone: digits, firstName: first }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Couldn't reach the server. Check the connection and try again.");
    if (!r.ok) return setError(r.error);
    onDone(r.member, r.message);
  }

  return (
    <form
      className="mb-3 rounded-lg border-2 p-3"
      style={{ borderColor: "var(--foreground)" }}
      aria-label="New phone account"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="font-bold">New phone account</div>
      <p className="mb-2 text-xs" style={{ color: "var(--muted)" }}>
        Just their phone number: no email, no password. They type it at check-in to earn points.
      </p>
      <div className="grid gap-2 sm:grid-cols-[3fr_2fr]">
        <label className="text-xs font-bold">
          Phone number
          <input
            className="input mt-1 !py-2.5 !text-base"
            type="tel"
            inputMode="tel"
            autoFocus={!start}
            maxLength={20}
            placeholder="(417) 555-0199"
            value={phone}
            onChange={(e) => {
              setError(null);
              const d = phoneDigits(e.target.value).slice(0, 10);
              setPhone(d ? formatPhone(d) : "");
            }}
          />
        </label>
        <label className="text-xs font-bold">
          First name <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional)</span>
          <input
            className="input mt-1 !py-2.5 !text-base"
            autoCapitalize="words"
            autoFocus={!!start}
            maxLength={40}
            value={first}
            onChange={(e) => {
              setError(null);
              setFirst(e.target.value);
            }}
          />
        </label>
      </div>
      {error && (
        <div className="mt-2 text-sm" style={{ color: "var(--danger-text)" }}>
          {error}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button type="submit" className="btn-primary min-h-11 flex-1 !py-2" disabled={!ready || busy}>
          {busy ? "Making it…" : "Make it & add to order"}
        </button>
        <button type="button" className="btn-secondary min-h-11 !px-4 !py-2" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
