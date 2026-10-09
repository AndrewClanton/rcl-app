"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renderArt, type ArtSpec } from "@/lib/badges/art";
import { approveBadgeDraft, refreshBadgeDrafts, skipBadgeDraft } from "./actions";

// Back office -> Badges -> Drafts to review: badges suggested from the
// calendar (upcoming house events and tagged showings in the next two
// weeks, and a "came to N" badge per series). Change the name, the line or
// the points, then Approve (it becomes a badge and goes to everyone who
// came, and anyone who comes later) or Skip. Nothing is awarded before.

export interface DraftView {
  id: string;
  sourceLabel: string;
  kind: "screening" | "house_event" | "series";
  name: string;
  flavor: string;
  points: number;
  spec: ArtSpec;
}

const KIND: Record<DraftView["kind"], string> = { screening: "Showing", house_event: "House event", series: "Series" };

function DraftRow({ d }: { d: DraftView }) {
  const router = useRouter();
  const [name, setName] = useState(d.name);
  const [flavor, setFlavor] = useState(d.flavor);
  const [points, setPoints] = useState(String(d.points));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = "mt-1 w-full rounded-[8px] border border-[var(--border)] bg-[var(--background)] px-3 py-2";
  return (
    <li className="flex flex-wrap items-start gap-4 border-t border-[var(--border)] px-4 py-3 first:border-t-0">
      <span className="badge-svg block w-16 shrink-0" aria-hidden="true" dangerouslySetInnerHTML={{ __html: renderArt(d.spec) }} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="text-xs tracking-wide text-[var(--muted)] uppercase">
          {KIND[d.kind]} · {d.sourceLabel}
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_6rem]">
          <label className="text-xs font-bold">
            Name
            <input className={input} maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="text-xs font-bold">
            Line
            <input className={input} maxLength={80} value={flavor} onChange={(e) => setFlavor(e.target.value)} />
          </label>
          <label className="text-xs font-bold">
            Points
            <input className={input} type="number" min={0} max={1000} value={points} onChange={(e) => setPoints(e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary px-3 py-2 disabled:opacity-50"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setMsg(null);
                const r = await approveBadgeDraft(d.id, { name, flavor, points: Number(points) });
                if (!r.ok) return setMsg(r.error);
                router.push(`/admin/badges/${r.defId}`);
              })
            }
          >
            Approve
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-2 disabled:opacity-50"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setMsg(null);
                const r = await skipBadgeDraft(d.id);
                if (!r.ok) return setMsg(r.error);
                router.refresh();
              })
            }
          >
            Skip
          </button>
          {msg && (
            <span className="text-sm font-bold text-[var(--accent)]" role="alert">
              {msg}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

export default function Drafts({ drafts }: { drafts: DraftView[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <section className="rounded-[8px] border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-3">
        <h2 className="font-bold">Drafts to review</h2>
        <span className="text-sm text-[var(--muted)]">From the next two weeks of house events and tagged showings. Nothing is awarded until you approve one.</span>
        <button
          type="button"
          className="btn-secondary ml-auto px-3 py-1.5 text-sm disabled:opacity-50"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await refreshBadgeDrafts();
              setMsg(r.ok ? (r.added ? `${r.added} new draft${r.added === 1 ? "" : "s"}.` : "Nothing new on the calendar.") : r.error);
              router.refresh();
            })
          }
        >
          {pending ? "Reading the calendar…" : "Check the calendar"}
        </button>
        {msg && <span className="basis-full text-sm">{msg}</span>}
      </div>
      {drafts.length ? (
        <ul>
          {drafts.map((d) => (
            <DraftRow key={d.id} d={d} />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-4 text-sm text-[var(--muted)]">No drafts waiting. They&apos;re made each morning, or when you check the calendar.</p>
      )}
    </section>
  );
}
