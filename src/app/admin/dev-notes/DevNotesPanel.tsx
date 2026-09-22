"use client";

import Link from "next/link";
import type { DevNote } from "@/lib/types";
import { useRefreshingAction } from "@/lib/useRefreshingAction";
import { approveDevNote, dismissDevNote, markDevNoteDone, reopenDevNote, deleteDevNote } from "./actions";

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function DevNotesPanel({ notes }: { notes: DevNote[] }) {
  const newNotes = notes.filter((n) => n.status === "new");
  const approved = notes.filter((n) => n.status === "approved");
  const history = notes.filter((n) => n.status === "done" || n.status === "dismissed");

  if (notes.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No notes yet -- they'll show up here as admins send them from the site.</p>;
  }

  return (
    <div className="space-y-8">
      <Section title="New" hint="Not looked at yet." notes={newNotes} empty="Nothing new." />
      <Section title="Approved" hint="On the backlog -- worth doing." notes={approved} empty="Nothing approved yet." />
      {history.length > 0 && <Section title="History" hint="Done or dismissed." notes={history} empty="" muted />}
    </div>
  );
}

function Section({ title, hint, notes, empty, muted }: { title: string; hint: string; notes: DevNote[]; empty: string; muted?: boolean }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">
          {title} <span className="font-normal text-[var(--muted)]">({notes.length})</span>
        </h2>
        <span className="text-xs text-[var(--muted)]">{hint}</span>
      </div>
      {notes.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">{empty}</p>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} muted={muted} />
          ))}
        </div>
      )}
    </section>
  );
}

function NoteCard({ note, muted }: { note: DevNote; muted?: boolean }) {
  const [pending, run] = useRefreshingAction();

  return (
    <div className={`rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 ${muted ? "opacity-70" : ""}`}>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
        <Link href={note.page_path} className="rounded border border-[var(--border)] px-1.5 py-0.5 font-mono hover:border-[var(--accent)]">
          {note.page_path}
        </Link>
        {note.page_title && <span>{note.page_title}</span>}
        <span>·</span>
        <span>{note.submitted_by?.name ?? "Unknown"}</span>
        <span>·</span>
        <span>{fmt(note.created_at)}</span>
        {note.status === "done" && <span className="stamp-tag stamp-tag-gold ml-auto">Done</span>}
        {note.status === "dismissed" && <span className="ml-auto text-[var(--muted)]">Dismissed</span>}
      </div>
      <p className="mb-3 whitespace-pre-wrap text-sm">{note.message}</p>
      <div className="flex flex-wrap gap-2 text-xs">
        {note.status === "new" && (
          <>
            <button disabled={pending} onClick={() => run(() => approveDevNote(note.id))} className="rounded bg-[var(--accent)] px-2.5 py-1 font-medium text-white disabled:opacity-50">
              Approve
            </button>
            <button disabled={pending} onClick={() => run(() => dismissDevNote(note.id))} className="rounded border border-[var(--border)] px-2.5 py-1 disabled:opacity-50">
              Dismiss
            </button>
          </>
        )}
        {note.status === "approved" && (
          <>
            <button disabled={pending} onClick={() => run(() => markDevNoteDone(note.id))} className="rounded bg-[var(--accent)] px-2.5 py-1 font-medium text-white disabled:opacity-50">
              Mark done
            </button>
            <button disabled={pending} onClick={() => run(() => dismissDevNote(note.id))} className="rounded border border-[var(--border)] px-2.5 py-1 disabled:opacity-50">
              Dismiss
            </button>
          </>
        )}
        {(note.status === "dismissed" || note.status === "done") && (
          <>
            <button disabled={pending} onClick={() => run(() => reopenDevNote(note.id))} className="rounded border border-[var(--border)] px-2.5 py-1 disabled:opacity-50">
              Reopen
            </button>
            <button
              disabled={pending}
              onClick={() => {
                if (confirm("Delete this note for good?")) run(() => deleteDevNote(note.id));
              }}
              className="rounded border border-[var(--danger-text)] px-2.5 py-1 text-[var(--danger-text)] disabled:opacity-50"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
