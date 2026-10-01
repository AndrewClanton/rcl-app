"use client";

import { useRef, useState, useTransition } from "react";
import type { AdminRoadmapItem, AdminSuggestion } from "@/lib/data/roadmap";
import { ROADMAP_STATUSES, STATUS_LABEL, SUMMARY_MAX, TITLE_MAX, creditName, releaseLabel, timeAgo, type RoadmapStatus } from "@/lib/roadmap";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import {
  createRoadmapItem,
  declineRoadmapSuggestion,
  logRoadmapRequest,
  reopenRoadmapSuggestion,
  reorderRoadmap,
  searchRoadmapRequesters,
  setRoadmapPublic,
  setRoadmapStatus,
  updateRoadmapItem,
  type RoadmapItemInput,
} from "./actions";

// Back office → Roadmap. canEdit: owners and admins (add, edit, reorder,
// status, publish, the inbox). Managers see everything and log requests.
// The server checks the role again on every action.

const STATUS_HINT: Record<RoadmapStatus, string> = {
  idea: "Considering it",
  queued: "A yes: in line",
  building: "Being built",
  reviewing: "Built, final checks",
  live: "Shipped",
  not_doing: "Decided against",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

function shareUrl(slug: string) {
  return `${window.location.origin}/whats-new/${slug}`;
}

export default function RoadmapManager({
  items,
  inbox,
  decided,
  canEdit,
  version,
  showVersions,
}: {
  items: AdminRoadmapItem[];
  inbox: AdminSuggestion[];
  decided: AdminSuggestion[];
  canEdit: boolean;
  version: string | null;
  showVersions: boolean;
}) {
  const [adding, setAdding] = useState<null | { suggestion: AdminSuggestion | null }>(null);
  const [logging, setLogging] = useState(false);
  const [showAllLive, setShowAllLive] = useState(false);

  const building = items.filter((i) => i.status === "building" || i.status === "reviewing");
  const queued = items.filter((i) => i.status === "queued");
  const ideas = items.filter((i) => i.status === "idea");
  const live = items.filter((i) => i.status === "live").sort((a, b) => (b.shippedAt ?? b.statusChangedAt).localeCompare(a.shippedAt ?? a.statusChangedAt));
  const notDoing = items.filter((i) => i.status === "not_doing");
  const shownLive = showAllLive ? live : live.slice(0, 15);
  const notes = items.reduce((n, i) => n + i.notes.length, 0);

  return (
    <div className="space-y-8">
      {version && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm">
          <span className="font-semibold">Version</span>
          <span className="font-mono text-[13px]">{version}</span>
          <span className="text-xs text-[var(--muted)]">Owners only. Going live stamps an item with the release it shipped in.</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <button type="button" onClick={() => setAdding({ suggestion: null })} className="btn-primary inline-flex min-h-11 items-center">
            + Add to the list
          </button>
        )}
        <button type="button" onClick={() => setLogging(true)} className={`${canEdit ? "btn-secondary" : "btn-primary"} inline-flex min-h-11 items-center`}>
          + Log someone&apos;s request
        </button>
        <span className="self-center text-sm text-[var(--muted)]">
          {items.filter((i) => i.isPublic).length} public · {items.filter((i) => !i.isPublic).length} private · {notes} member note{notes === 1 ? "" : "s"}
        </span>
      </div>

      {adding && (
        <Panel title={adding.suggestion ? "Say yes: put it on the list" : "Add to the list"} onClose={() => setAdding(null)}>
          {adding.suggestion && (
            <blockquote className="mb-4 rounded-lg border-l-4 border-[var(--foreground)] bg-[var(--background)] px-3 py-2 text-sm whitespace-pre-line">
              <span className="block text-xs font-semibold text-[var(--muted)]">{adding.suggestion.who} asked:</span>
              {adding.suggestion.body}
            </blockquote>
          )}
          <ItemForm
            initial={{
              title: "",
              summary: "",
              notes: adding.suggestion ? `From ${adding.suggestion.who}: ${adding.suggestion.body}` : "",
              status: "queued",
              isPublic: true,
              requesterMemberId: adding.suggestion?.memberId ?? null,
              requesterName: adding.suggestion?.memberId ? null : (adding.suggestion?.typedName ?? null),
              creditOk: adding.suggestion?.creditOk ?? false,
            }}
            requesterLabel={adding.suggestion?.memberId ? adding.suggestion.who : null}
            submitLabel={adding.suggestion ? "Add it and accept" : "Add it"}
            onSave={(input) => createRoadmapItem(input, adding.suggestion?.id ?? null)}
            onDone={() => setAdding(null)}
            afterSave="share"
          />
        </Panel>
      )}

      {logging && (
        <Panel title="Log someone's request" onClose={() => setLogging(false)}>
          <LogRequestForm onDone={() => setLogging(false)} canEdit={canEdit} />
        </Panel>
      )}

      <Inbox inbox={inbox} decided={decided} canEdit={canEdit} onAccept={(s) => setAdding({ suggestion: s })} />

      <Section title="Building now" hint="Being built, or built and in final checks." count={building.length}>
        {building.map((i) => (
          <ItemRow key={i.id} item={i} canEdit={canEdit} showVersions={showVersions} />
        ))}
      </Section>

      <Section title="Up next" hint={canEdit ? "The queue, in order. Drag the handle (or use the arrows) to reorder." : "The queue, in order."} count={queued.length}>
        <QueueList items={queued} canEdit={canEdit} showVersions={showVersions} />
      </Section>

      <Section title="Ideas we're considering" hint="Public ones are listed most-wanted first on What's new." count={ideas.length}>
        {[...ideas]
          .sort((a, b) => b.votes - a.votes || a.rank - b.rank)
          .map((i) => (
            <ItemRow key={i.id} item={i} canEdit={canEdit} showVersions={showVersions} />
          ))}
      </Section>

      <Section title="Shipped" hint="Newest first. Public ones make the Just shipped changelog." count={live.length}>
        {shownLive.map((i) => (
          <ItemRow key={i.id} item={i} canEdit={canEdit} showVersions={showVersions} />
        ))}
        {live.length > shownLive.length && (
          <button type="button" onClick={() => setShowAllLive(true)} className="btn-secondary min-h-11">
            Show all {live.length}
          </button>
        )}
      </Section>

      {notDoing.length > 0 && (
        <Section title="Not doing" hint="Decided against. A public one still shows on its own page (as Not planned), so a shared link doesn't break." count={notDoing.length}>
          {notDoing.map((i) => (
            <ItemRow key={i.id} item={i} canEdit={canEdit} showVersions={showVersions} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border-2 border-[var(--foreground)] bg-[var(--surface)] p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{title}</h2>
        <button type="button" onClick={onClose} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-hover)]" aria-label="Close">
          ✕
        </button>
      </div>
      {children}
    </section>
  );
}

function Section({ title, hint, count, children }: { title: string; hint: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-base font-bold">
          {title} <span className="font-normal text-[var(--muted)]">({count})</span>
        </h2>
        <span className="text-xs text-[var(--muted)]">{hint}</span>
      </div>
      {count === 0 ? <p className="text-sm text-[var(--muted)]">Nothing here.</p> : <div className="space-y-2">{children}</div>}
    </section>
  );
}

// ---------- who asked ----------

interface Requester {
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
      className={`min-h-10 rounded-lg border px-3 text-sm ${mode === m ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--surface)]" : "border-[var(--border)] hover:border-[var(--foreground)]"}`}
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
            <button type="button" onClick={() => onChange({ memberId: null, memberLabel: null, name: null })} className="min-h-10 rounded-lg px-2 text-[var(--muted)] underline">
              Change
            </button>
          </div>
        ) : (
          <div>
            <input className="input" value={query} onChange={(e) => search(e.target.value)} placeholder="Name, email or phone" autoComplete="off" />
            {error && <p className="mt-1 text-xs text-[var(--danger-text)]">{error}</p>}
            {query.trim().length >= 2 && (
              <ul className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-[var(--border)]">
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

function CreditBox({ requester, checked, onChange }: { requester: Requester; checked: boolean; onChange: (v: boolean) => void }) {
  const who = requester.memberId ? requester.memberLabel : requester.name;
  const shown = creditName(who);
  const disabled = !requester.memberId && !requester.name?.trim();
  return (
    <label className={`flex items-start gap-2 text-sm ${disabled ? "opacity-50" : ""}`}>
      <input type="checkbox" className="mt-0.5 h-5 w-5" checked={checked && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b>Credit them publicly</b>
        <span className="block text-xs text-[var(--muted)]">
          {shown ? <>Shows &quot;Suggested by {shown}&quot;, only with their OK. Never a staff member.</> : "First name and last initial, only with their OK."}
        </span>
      </span>
    </label>
  );
}

// ---------- add / edit ----------

type FormValues = Omit<RoadmapItemInput, "confirmNames">;

function ItemForm({
  initial,
  requesterLabel,
  submitLabel,
  onSave,
  onDone,
  afterSave,
}: {
  initial: FormValues;
  requesterLabel: string | null;
  submitLabel: string;
  onSave: (input: RoadmapItemInput) => Promise<{ ok: true; slug?: string } | { ok: false; error: string; confirm?: string[] }>;
  onDone: () => void;
  afterSave?: "share";
}) {
  const [v, setV] = useState<FormValues>(initial);
  const [requester, setRequester] = useState<Requester>({ memberId: initial.requesterMemberId, memberLabel: requesterLabel, name: initial.requesterName });
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, run] = useRefreshingAction();

  function save(confirmNames: boolean) {
    setError(null);
    run(async () => {
      const r = await onSave({ ...v, requesterMemberId: requester.memberId, requesterName: requester.memberId ? null : requester.name, confirmNames });
      if (r.ok) {
        setConfirm(null);
        if (afterSave === "share" && r.slug) setSaved(r.slug);
        else onDone();
      } else {
        setError(r.error);
        setConfirm(r.confirm?.length ? r.confirm : null);
      }
      return null;
    });
  }

  if (saved) {
    return (
      <div className="space-y-3">
        <p className="font-semibold">Added. {v.isPublic ? "Send them the link so they can follow it:" : "It's private for now: the link works once you make it public."}</p>
        <CopyShareLink slug={saved} isPublic={v.isPublic} wide />
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
        save(false);
      }}
      className="grid gap-4 lg:grid-cols-2"
    >
      <div className="space-y-3">
        <label className="block">
          <span className="label-xs block">Title</span>
          <input className="input" value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} maxLength={TITLE_MAX} required placeholder="Latte flavors and free alt milks" />
        </label>
        <label className="block">
          <span className="label-xs block">Public summary: plain words a customer understands</span>
          <textarea className="input min-h-24" value={v.summary} onChange={(e) => setV({ ...v, summary: e.target.value })} maxLength={SUMMARY_MAX} placeholder="Vanilla, caramel or mocha in any latte, and oat or almond milk at no charge." />
        </label>
        <label className="block">
          <span className="label-xs block">Internal notes (staff only, never public)</span>
          <textarea className="input min-h-20" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} maxLength={4000} />
        </label>
      </div>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-4">
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
          <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold">
            <input type="checkbox" className="h-5 w-5" checked={v.isPublic} onChange={(e) => setV({ ...v, isPublic: e.target.checked })} />
            Show on What&apos;s new
          </label>
        </div>
        <div>
          <span className="label-xs block">Who asked for it</span>
          <RequesterPicker value={requester} onChange={setRequester} />
        </div>
        <CreditBox requester={requester} checked={v.creditOk} onChange={(c) => setV({ ...v, creditOk: c })} />
        {error && (
          <div className="notice notice-warn" role="alert">
            {error}
            {confirm && (
              <button type="button" disabled={pending} onClick={() => save(true)} className="mt-2 block font-bold underline">
                It&apos;s a false alarm: save anyway
              </button>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending || !v.title.trim()} className="btn-primary min-h-11">
            {pending ? "Saving..." : submitLabel}
          </button>
          <button type="button" onClick={onDone} className="btn-secondary min-h-11">
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

function LogRequestForm({ onDone, canEdit }: { onDone: () => void; canEdit: boolean }) {
  const [body, setBody] = useState("");
  const [requester, setRequester] = useState<Requester>({ memberId: null, memberLabel: null, name: null });
  const [creditOk, setCreditOk] = useState(false);
  const [pending, run, error] = useRefreshingAction();
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="space-y-3">
        <p className="font-semibold">Logged. It&apos;s in the inbox below{canEdit ? "" : " for an owner or admin to say yes or no"}.</p>
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
          const r = await logRoadmapRequest({ body, requesterMemberId: requester.memberId, requesterName: requester.name, creditOk });
          if (r.ok) setSent(true);
          return r;
        }, { quiet: true });
      }}
      className="grid gap-4 lg:grid-cols-2"
    >
      <label className="block">
        <span className="label-xs block">What did they ask for?</span>
        <textarea className="input min-h-28" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} required placeholder="A Studio Ghibli marathon on a Sunday afternoon" />
      </label>
      <div className="space-y-4">
        <div>
          <span className="label-xs block">Who asked</span>
          <RequesterPicker value={requester} onChange={setRequester} />
        </div>
        <CreditBox requester={requester} checked={creditOk} onChange={setCreditOk} />
        {error && (
          <p className="notice notice-warn" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending || !body.trim()} className="btn-primary min-h-11">
          {pending ? "Saving..." : "Add to the inbox"}
        </button>
      </div>
    </form>
  );
}

// ---------- the inbox ----------

function Inbox({ inbox, decided, canEdit, onAccept }: { inbox: AdminSuggestion[]; decided: AdminSuggestion[]; canEdit: boolean; onAccept: (s: AdminSuggestion) => void }) {
  const [pending, run] = useRefreshingAction();
  const [showDecided, setShowDecided] = useState(false);
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-base font-bold">
          Suggestions inbox <span className="font-normal text-[var(--muted)]">({inbox.length})</span>
        </h2>
        <span className="text-xs text-[var(--muted)]">From members on What&apos;s new, and requests staff logged. Never shown publicly as written.</span>
      </div>
      {inbox.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">All caught up.</p>
      ) : (
        <div className="grid gap-2 xl:grid-cols-2">
          {inbox.map((s) => (
            <div key={s.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                <span className="font-semibold text-[var(--foreground)]">{s.who}</span>
                {s.hint && <span className="font-mono">{s.hint}</span>}
                <span>·</span>
                <span>{fmt(s.createdAt)}</span>
                {s.loggedBy && <span>· logged by {s.loggedBy}</span>}
                {s.creditOk && <span className="bo-badge">Wants credit</span>}
              </div>
              <p className="text-sm whitespace-pre-wrap">{s.body}</p>
              {canEdit && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={pending} onClick={() => onAccept(s)} className="btn-primary min-h-11 !py-1.5">
                    Accept…
                  </button>
                  <button type="button" disabled={pending} onClick={() => run(() => declineRoadmapSuggestion(s.id))} className="btn-secondary min-h-11 !py-1.5">
                    Decline
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {decided.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowDecided(!showDecided)} className="min-h-11 text-sm text-[var(--muted)] underline" aria-expanded={showDecided}>
            {showDecided ? "Hide" : "Show"} recently answered ({decided.length})
          </button>
          {showDecided && (
            <ul className="mt-1 space-y-1 text-sm">
              {decided.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-x-2 rounded-lg px-2 py-1.5 hover:bg-[var(--surface-hover)]">
                  <span className={`bo-badge ${s.status === "declined" ? "bo-badge-warn" : ""}`}>{s.status === "accepted" ? "Accepted" : "Declined"}</span>
                  <span className="font-semibold">{s.who}</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--muted)]">{s.body}</span>
                  {s.itemTitle && <span className="text-xs">→ {s.itemTitle}</span>}
                  {canEdit && s.status === "declined" && (
                    <button type="button" disabled={pending} onClick={() => run(() => reopenRoadmapSuggestion(s.id))} className="text-xs underline">
                      Back to the inbox
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// ---------- one item ----------

function CopyShareLink({ slug, isPublic, wide = false }: { slug: string; isPublic: boolean; wide?: boolean }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() =>
          navigator.clipboard.writeText(shareUrl(slug)).then(
            () => setCopied("yes"),
            () => setCopied("no"),
          )
        }
        className={`${wide ? "btn-primary" : "rounded-lg border border-[var(--border)] px-3 text-sm hover:border-[var(--foreground)]"} min-h-11`}
        title={isPublic ? "Copy the link to its page on What's new" : "Private: the link works once it's public"}
      >
        {copied === "yes" ? "Copied ✓" : "Copy share link"}
      </button>
      {copied === "no" && <span className="font-mono text-xs select-all">/whats-new/{slug}</span>}
      {!isPublic && <span className="text-xs text-[var(--muted)]">(private for now)</span>}
    </span>
  );
}

function ItemRow({ item, canEdit, showVersions, handle, position, onMove }: { item: AdminRoadmapItem; canEdit: boolean; showVersions: boolean; handle?: React.ReactNode; position?: number; onMove?: (dir: -1 | 1) => void }) {
  const [editing, setEditing] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [pending, run] = useRefreshingAction();
  const [confirmPublic, setConfirmPublic] = useState<string | null>(null);
  const requester = item.requester.memberId ? item.requester.memberName : item.requester.name;

  return (
    <div className={`rounded-xl border bg-[var(--surface)] ${item.isPublic ? "border-[var(--border)]" : "border-dashed border-[var(--border)]"}`}>
      <div className="flex items-start gap-2 p-3 sm:p-4">
        {handle}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {position !== undefined && <span className="font-mono text-xs font-bold text-[var(--muted)]">#{position}</span>}
            <span className="font-semibold">{item.title}</span>
            {!item.isPublic && <span className="bo-badge bo-badge-warn">Private</span>}
            {item.status === "reviewing" && <span className="bo-badge">Final checks</span>}
            {showVersions && item.shippedInVersion && <span className="font-mono text-xs text-[var(--muted)]">v{releaseLabel(item.shippedInVersion)}</span>}
          </div>
          {item.summary && <p className="mt-0.5 line-clamp-2 text-sm text-[var(--muted)]">{item.summary}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
            <span title="Members who tapped I want this too">♥ {item.votes} want{item.votes === 1 ? "s" : ""} it</span>
            {item.notes.length > 0 && (
              <button type="button" onClick={() => setShowNotes(!showNotes)} className="font-semibold text-[var(--foreground)] underline" aria-expanded={showNotes}>
                {item.notes.length} private note{item.notes.length === 1 ? "" : "s"}
              </button>
            )}
            {requester && (
              <span>
                Asked by {requester}
                {item.publicCredit ? ` · credited as ${item.publicCredit}` : item.creditOk ? " · credit hidden (staff)" : " · no public credit"}
              </span>
            )}
            {item.fromSuggestion && <span>From the inbox</span>}
            <span>
              {item.status === "live" && item.shippedAt ? `Shipped ${fmt(item.shippedAt)}` : `${STATUS_LABEL[item.status]} since ${timeAgo(item.statusChangedAt)}`}
            </span>
          </div>
          {item.internalNotes && !editing && <p className="mt-1.5 rounded-lg bg-[var(--background)] px-2 py-1 text-xs whitespace-pre-wrap">{item.internalNotes}</p>}
        </div>
        {onMove && canEdit && (
          <div className="flex shrink-0 flex-col">
            <button type="button" onClick={() => onMove(-1)} className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-hover)]" aria-label={`Move ${item.title} up`}>
              ▲
            </button>
            <button type="button" onClick={() => onMove(1)} className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-hover)]" aria-label={`Move ${item.title} down`}>
              ▼
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-3 py-2 sm:px-4">
        {canEdit ? (
          <>
            <select
              className="input !w-auto min-h-11"
              value={item.status}
              disabled={pending}
              onChange={(e) => run(() => setRoadmapStatus(item.id, e.target.value as RoadmapStatus))}
              aria-label={`Status of ${item.title}`}
            >
              {ROADMAP_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <label className="flex min-h-11 items-center gap-2 px-1 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={item.isPublic}
                disabled={pending}
                onChange={(e) => {
                  const on = e.target.checked;
                  setConfirmPublic(null);
                  run(async () => {
                    const r = await setRoadmapPublic(item.id, on);
                    if (!r.ok && r.confirm) {
                      setConfirmPublic(r.error);
                      return null;
                    }
                    return r;
                  });
                }}
              />
              Public
            </label>
            <button type="button" onClick={() => setEditing(!editing)} className="min-h-11 rounded-lg border border-[var(--border)] px-3 text-sm hover:border-[var(--foreground)]" aria-expanded={editing}>
              {editing ? "Close" : "Edit"}
            </button>
          </>
        ) : (
          <span className="text-sm">{STATUS_LABEL[item.status]}</span>
        )}
        <CopyShareLink slug={item.slug} isPublic={item.isPublic} />
        {item.isPublic && (
          <a href={`/whats-new/${item.slug}`} target="_blank" rel="noreferrer" className="text-sm text-[var(--muted)] underline">
            View ↗
          </a>
        )}
      </div>

      {confirmPublic && (
        <div className="notice notice-warn mx-3 mb-3" role="alert">
          {confirmPublic}
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setConfirmPublic(null);
              run(() => setRoadmapPublic(item.id, true, true));
            }}
            className="mt-2 block font-bold underline"
          >
            It&apos;s a false alarm: make it public anyway
          </button>
        </div>
      )}

      {showNotes && item.notes.length > 0 && (
        <ul className="space-y-2 border-t border-[var(--border)] px-3 py-3 sm:px-4">
          {item.notes.map((n) => (
            <li key={n.id} className="text-sm">
              <span className="text-xs text-[var(--muted)]">
                <a href={`/admin/members/${n.memberId}`} className="font-semibold text-[var(--foreground)] underline">
                  {n.memberName}
                </a>{" "}
                · {fmt(n.createdAt)}
              </span>
              <p className="whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ul>
      )}

      {editing && canEdit && (
        <div className="border-t border-[var(--border)] p-3 sm:p-4">
          <ItemForm
            initial={{
              title: item.title,
              summary: item.summary,
              notes: item.internalNotes,
              status: item.status,
              isPublic: item.isPublic,
              requesterMemberId: item.requester.memberId,
              requesterName: item.requester.name,
              creditOk: item.creditOk,
            }}
            requesterLabel={item.requester.memberName}
            submitLabel="Save"
            onSave={(input) => updateRoadmapItem(item.id, input)}
            onDone={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  );
}

// ---------- the queue, drag to reorder ----------

// Pointer events, so a finger on the iPad drags as well as a mouse: press
// the handle, move, let go. The rows part to show where it will land; on
// release only the items whose rank changed are saved. The arrows do the
// same one step at a time (and from a keyboard).
function QueueList({ items, canEdit, showVersions }: { items: AdminRoadmapItem[]; canEdit: boolean; showVersions: boolean }) {
  const key = items.map((i) => `${i.id}:${i.rank}`).join(",");
  const [seenKey, setSeenKey] = useState(key);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  if (seenKey !== key) {
    // Fresh data from the server: it has the saved order now.
    setSeenKey(key);
    setLocalOrder(null);
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const order = (localOrder ?? items.map((i) => i.id)).filter((id) => byId.has(id));
  const rows = useRef(new Map<string, HTMLDivElement>());
  const [drag, setDrag] = useState<{ id: string; pointerId: number; startY: number; dy: number; tops: number[]; heights: number[]; gap: number } | null>(null);
  const [, run] = useRefreshingAction();

  function save(next: string[]) {
    // Keep the ranks the queue already uses, in the new order (so only the
    // moved items change), unless two share a rank: then number them 1, 2, 3.
    const current = order.map((id) => byId.get(id)!.rank);
    const sorted = [...current].sort((a, b) => a - b);
    const distinct = new Set(sorted).size === sorted.length && sorted.every((r) => r > 0);
    const ranks = distinct ? sorted : sorted.map((_, i) => i + 1);
    const changes = next.map((id, i) => ({ id, rank: ranks[i] })).filter((c) => byId.get(c.id)!.rank !== c.rank);
    setLocalOrder(next);
    if (changes.length) run(() => reorderRoadmap(changes));
  }

  function targetIndex(d: NonNullable<typeof drag>): number {
    const from = order.indexOf(d.id);
    const center = d.tops[from] + d.heights[from] / 2 + d.dy;
    let t = 0;
    for (let i = 0; i < order.length; i++) {
      if (i === from) continue;
      if (d.tops[i] + d.heights[i] / 2 < center) t++;
    }
    return t;
  }

  function onPointerDown(e: React.PointerEvent, id: string) {
    if (!canEdit || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const tops: number[] = [];
    const heights: number[] = [];
    for (const rid of order) {
      const r = rows.current.get(rid)?.getBoundingClientRect();
      tops.push((r?.top ?? 0) + window.scrollY);
      heights.push(r?.height ?? 0);
    }
    const gap = order.length > 1 ? Math.max(0, tops[1] - (tops[0] + heights[0])) : 0;
    setDrag({ id, pointerId: e.pointerId, startY: e.clientY + window.scrollY, dy: 0, tops, heights, gap });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    // Near the top or bottom of the screen, scroll so a long queue can be
    // dragged end to end.
    if (e.clientY < 70) window.scrollBy(0, -12);
    else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 12);
    setDrag({ ...drag, dy: e.clientY + window.scrollY - drag.startY });
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const from = order.indexOf(drag.id);
    const to = targetIndex(drag);
    setDrag(null);
    if (from === to || from < 0) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, drag.id);
    save(next);
  }

  function move(id: string, dir: -1 | 1) {
    const from = order.indexOf(id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, id);
    save(next);
  }

  const from = drag ? order.indexOf(drag.id) : -1;
  const to = drag ? targetIndex(drag) : -1;
  const publicPositions = new Map<string, number>();
  for (const id of order) if (byId.get(id)!.isPublic) publicPositions.set(id, publicPositions.size + 1);

  return (
    <div className="space-y-2" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDrag(null)}>
      {order.map((id, i) => {
        const item = byId.get(id)!;
        let shift = 0;
        if (drag && i !== from) {
          const h = drag.heights[from] + drag.gap;
          if (from < to && i > from && i <= to) shift = -h;
          if (from > to && i >= to && i < from) shift = h;
        }
        const dragging = drag?.id === id;
        return (
          <div
            key={id}
            ref={(el) => {
              if (el) rows.current.set(id, el);
              else rows.current.delete(id);
            }}
            style={{
              transform: dragging ? `translateY(${drag.dy}px)` : shift ? `translateY(${shift}px)` : undefined,
              transition: dragging ? "none" : "transform 150ms",
              position: "relative",
              zIndex: dragging ? 20 : undefined,
            }}
            className={dragging ? "shadow-xl" : ""}
          >
            <ItemRow
              item={item}
              canEdit={canEdit}
              showVersions={showVersions}
              position={publicPositions.get(id)}
              onMove={(dir) => move(id, dir)}
              handle={
                canEdit ? (
                  <button
                    type="button"
                    onPointerDown={(e) => onPointerDown(e, id)}
                    className="-ml-1 inline-flex min-h-11 min-w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-lg text-[var(--muted)] select-none hover:bg-[var(--surface-hover)] active:cursor-grabbing"
                    aria-label={`Drag to reorder ${item.title}`}
                    title="Drag to reorder"
                  >
                    ⠿
                  </button>
                ) : undefined
              }
            />
          </div>
        );
      })}
      {order.length > 0 && <p className="text-xs text-[var(--muted)]">#numbers are each public item&apos;s place in line on What&apos;s new (private items don&apos;t count).</p>}
    </div>
  );
}
