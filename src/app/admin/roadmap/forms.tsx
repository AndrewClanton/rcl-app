"use client";

import { useRef, useState, useTransition } from "react";
import { NOTES_MAX, ROADMAP_STATUSES, STATUS_LABEL, SUMMARY_MAX, TITLE_MAX, type RoadmapStatus } from "@/lib/roadmap";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { logRoadmapRequest, searchRoadmapRequesters, type Result, type RoadmapItemInput } from "./actions";

// The forms behind Back office → Roadmap: add or edit an item, log
// someone's request, and who asked. They open in a side sheet, so they're
// one column.

export const STATUS_HINT: Record<RoadmapStatus, string> = {
  idea: "Considering it",
  queued: "A yes: in line",
  building: "Being built",
  reviewing: "Built, final checks",
  live: "Shipped",
  not_doing: "Decided against",
};

// ---------- who asked ----------

export interface Requester {
  memberId: string | null;
  memberLabel: string | null;
  name: string | null;
}

function RequesterPicker({ value, onChange }: { value: Requester; onChange: (r: Requester) => void }) {
  const [mode, setMode] = useState<"none" | "member" | "name">(value.memberId ? "member" : value.name ? "name" : "none");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; hint: string }[]>([]);
  const [searching, startSearch] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  function search(q: string) {
    setQuery(q);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      startSearch(async () => {
        const r = await searchRoadmapRequesters(q).catch(() => ({ ok: false as const, error: "Search didn't work. Try again." }));
        if (r.ok) {
          setResults(r.members);
          setError(null);
        } else setError(r.error);
      });
    }, 250);
  }

  const tab = (m: typeof mode, label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(m);
        if (m === "none") onChange({ memberId: null, memberLabel: null, name: null });
        if (m === "name") onChange({ memberId: null, memberLabel: null, name: value.name });
        if (m === "member") onChange({ memberId: value.memberId, memberLabel: value.memberLabel, name: null });
      }}
      className={`min-h-11 rounded-lg border px-3 text-sm ${mode === m ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--surface)]" : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--foreground)]"}`}
      aria-pressed={mode === m}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {tab("none", "Nobody (our idea)")}
        {tab("member", "A member")}
        {tab("name", "Type a name")}
      </div>
      {mode === "member" &&
        (value.memberId ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-lg bg-[var(--surface-hover)] px-3 py-2 font-semibold">{value.memberLabel ?? "A member"}</span>
            <button type="button" onClick={() => onChange({ memberId: null, memberLabel: null, name: null })} className="min-h-11 rounded-lg px-2 text-[var(--muted)] underline">
              Change
            </button>
          </div>
        ) : (
          <div>
            <input className="input" value={query} onChange={(e) => search(e.target.value)} placeholder="Name, email or phone" autoComplete="off" />
            {error && <p className="mt-1 text-xs text-[var(--danger-text)]">{error}</p>}
            {query.trim().length >= 2 && (
              <ul className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                {results.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange({ memberId: m.id, memberLabel: m.name, name: null });
                        setQuery("");
                        setResults([]);
                      }}
                      className="flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 px-3 py-1.5 text-left text-sm hover:bg-[var(--surface-hover)]"
                    >
                      <span className="font-semibold">{m.name}</span>
                      <span className="font-mono text-xs text-[var(--muted)]">{m.hint}</span>
                    </button>
                  </li>
                ))}
                {!results.length && <li className="px-3 py-2 text-sm text-[var(--muted)]">{searching ? "Searching..." : "No members match."}</li>}
              </ul>
            )}
          </div>
        ))}
      {mode === "name" && (
        <input className="input" value={value.name ?? ""} onChange={(e) => onChange({ memberId: null, memberLabel: null, name: e.target.value })} maxLength={60} placeholder="e.g. Jake Brown" />
      )}
    </div>
  );
}

// ---------- add / edit ----------

export function ItemForm({
  initial,
  requesterLabel,
  submitLabel,
  onSave,
  onDone,
}: {
  initial: RoadmapItemInput;
  requesterLabel: string | null;
  submitLabel: string;
  onSave: (input: RoadmapItemInput) => Promise<Result>;
  onDone: () => void;
}) {
  const [v, setV] = useState<RoadmapItemInput>(initial);
  const [requester, setRequester] = useState<Requester>({ memberId: initial.requesterMemberId, memberLabel: requesterLabel, name: initial.requesterName });
  const [pending, run, error] = useRefreshingAction();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await onSave({ ...v, requesterMemberId: requester.memberId, requesterName: requester.memberId ? null : requester.name });
          if (r.ok) onDone();
          return r;
        }, { quiet: true });
      }}
      className="space-y-4"
    >
      <label className="block">
        <span className="label-xs block">Title</span>
        <input className="input" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} maxLength={TITLE_MAX} required placeholder="Latte flavors and free alt milks" />
      </label>
      <label className="block">
        <span className="label-xs block">Summary: what it is, in a line or two</span>
        <textarea className="input min-h-24" value={v.summary} onChange={(e) => setV({ ...v, summary: e.target.value })} maxLength={SUMMARY_MAX} placeholder="Vanilla, caramel or mocha in any latte, and oat or almond milk at no charge." />
      </label>
      <label className="block">
        <span className="label-xs block">Internal notes</span>
        <textarea className="input min-h-20" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} maxLength={NOTES_MAX} />
      </label>
      <label className="block">
        <span className="label-xs block">Status</span>
        <select className="input min-h-11" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as RoadmapStatus })}>
          {ROADMAP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]} ({STATUS_HINT[s]})
            </option>
          ))}
        </select>
      </label>
      <div>
        <span className="label-xs block">Who asked for it</span>
        <RequesterPicker value={requester} onChange={setRequester} />
      </div>
      {error && (
        <p className="notice notice-warn" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending || !v.title.trim()} className="btn-primary min-h-11">
          {pending ? "Saving..." : submitLabel}
        </button>
        <button type="button" onClick={onDone} className="btn-secondary min-h-11">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------- log a request (managers) ----------

export function LogRequestForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [requester, setRequester] = useState<Requester>({ memberId: null, memberLabel: null, name: null });
  const [pending, run, error] = useRefreshingAction();
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="space-y-3">
        <p className="font-semibold">Logged. It&apos;s on the list under Ideas for an owner or admin to look at.</p>
        <button type="button" onClick={onDone} className="btn-secondary min-h-11">
          Done
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await logRoadmapRequest({ title, details, requesterMemberId: requester.memberId, requesterName: requester.memberId ? null : requester.name });
          if (r.ok) setSent(true);
          return r;
        }, { quiet: true });
      }}
      className="space-y-4"
    >
      <label className="block">
        <span className="label-xs block">What did they ask for?</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TITLE_MAX} required placeholder="A Studio Ghibli marathon on a Sunday afternoon" />
      </label>
      <label className="block">
        <span className="label-xs block">Anything else they said (optional)</span>
        <textarea className="input min-h-24" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={NOTES_MAX} />
      </label>
      <div>
        <span className="label-xs block">Who asked</span>
        <RequesterPicker value={requester} onChange={setRequester} />
      </div>
      {error && (
        <p className="notice notice-warn" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending || !title.trim()} className="btn-primary min-h-11">
        {pending ? "Saving..." : "Add to Ideas"}
      </button>
    </form>
  );
}
