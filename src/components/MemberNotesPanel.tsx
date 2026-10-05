"use client";

import { useId, useState } from "react";
import InfoTip from "@/components/help/InfoTip";
import { flagTime } from "@/lib/member-flags";
import { NOTE_MAX, ORG_MAX, type MemberNote } from "@/lib/member-notes";

// Account notes and the "Group / organization" chip (lib/member-notes.ts),
// staff only. The register's press-and-hold panel (pos/MemberGlance.tsx)
// and the member's Back office page (admin/members/[id]/NotesBox.tsx) both
// use it, each with its own staff-checked server actions. `shown`: how many
// notes to list (the register keeps it short; Back office lists them all).

type Result<T> = { ok: true } & T;
type Fail = { ok: false; error: string };

export default function MemberNotesPanel({
  notes: initialNotes,
  organization: initialOrg,
  suggestions,
  addNote,
  setOrganization,
  onOrganization,
  shown,
  moreHref,
}: {
  notes: MemberNote[];
  organization: string | null;
  suggestions: string[];
  addNote: (text: string) => Promise<Result<{ note: MemberNote }> | Fail>;
  setOrganization: (value: string) => Promise<Result<{ organization: string | null }> | Fail>;
  onOrganization?: (organization: string | null) => void;
  shown?: number;
  moreHref?: string;
}) {
  const listId = useId();
  const [notes, setNotes] = useState(initialNotes);
  const [org, setOrg] = useState(initialOrg);
  const [editingOrg, setEditingOrg] = useState(false);
  const [orgDraft, setOrgDraft] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"note" | "org" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveNote() {
    if (busy || !draft.trim()) return;
    setBusy("note");
    setError(null);
    const r = await addNote(draft).catch(() => null);
    setBusy(null);
    if (!r) return setError("Couldn't reach the server. Try again.");
    if (!r.ok) return setError(r.error);
    setNotes((n) => [r.note, ...n]);
    setDraft("");
  }

  async function saveOrg(value: string) {
    if (busy) return;
    setBusy("org");
    setError(null);
    const r = await setOrganization(value).catch(() => null);
    setBusy(null);
    if (!r) return setError("Couldn't reach the server. Try again.");
    if (!r.ok) return setError(r.error);
    setOrg(r.organization);
    setEditingOrg(false);
    onOrganization?.(r.organization);
  }

  const list = shown ? notes.slice(0, shown) : notes;
  const picks = suggestions.filter((s) => s.toLowerCase() !== (org ?? "").toLowerCase()).slice(0, 4);

  return (
    <div className="space-y-2 text-sm">
      {editingOrg ? (
        <form
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void saveOrg(orgDraft);
          }}
        >
          <div className="flex gap-2">
            <input
              className="input min-h-11 min-w-0 flex-1 !py-1.5 text-sm"
              placeholder="Group / organization, e.g. Easter Seals"
              aria-label="Group / organization"
              list={listId}
              maxLength={ORG_MAX}
              autoFocus
              value={orgDraft}
              onChange={(e) => setOrgDraft(e.target.value)}
            />
            <datalist id={listId}>
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <button type="submit" className="btn-primary min-h-11 !px-3 !py-1.5 text-sm" disabled={!!busy}>
              {busy === "org" ? "…" : "Save"}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {picks.map((s) => (
              <button key={s} type="button" className="min-h-9 rounded-full border px-2.5 text-xs font-semibold" style={{ borderColor: "var(--border)" }} disabled={!!busy} onClick={() => void saveOrg(s)}>
                {s}
              </button>
            ))}
            {org && (
              <button type="button" className="min-h-9 px-2 text-xs underline" style={{ color: "var(--muted)" }} disabled={!!busy} onClick={() => void saveOrg("")}>
                Remove
              </button>
            )}
            <button type="button" className="min-h-9 px-2 text-xs underline" style={{ color: "var(--muted)" }} disabled={!!busy} onClick={() => setEditingOrg(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="inline-flex min-h-9 max-w-full items-center gap-1 rounded-full border px-3 text-xs font-bold"
          style={org ? { borderColor: "var(--foreground)" } : { borderColor: "var(--border)", color: "var(--muted)", borderStyle: "dashed" }}
          title="Group / organization (staff only)"
          onClick={() => {
            setOrgDraft(org ?? "");
            setEditingOrg(true);
          }}
        >
          <span className="truncate">{org ? `🏷 ${org}` : "+ Group / organization"}</span>
        </button>
      )}

      <div>
        <div className="eyebrow mb-1 flex items-center">
          Notes · staff only
          <InfoTip topic="member-notes" />
        </div>
        {list.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            No notes yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {list.map((n) => (
              <li key={n.id} className="rounded-md border px-2.5 py-1.5" style={{ borderColor: "var(--border)" }}>
                <div className="whitespace-pre-wrap break-words">{n.note}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {n.by ?? "Staff"} · {flagTime(n.at)}
                </div>
              </li>
            ))}
          </ul>
        )}
        {shown && notes.length > shown && (
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            {moreHref ? (
              <a href={moreHref} target="_blank" rel="noopener noreferrer" className="underline">
                Older notes in Back office
              </a>
            ) : (
              "Older notes in Back office"
            )}
          </p>
        )}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void saveNote();
        }}
      >
        <input
          className="input min-h-11 min-w-0 flex-1 !py-1.5 text-sm"
          placeholder="Add a note"
          aria-label="Add a note"
          maxLength={NOTE_MAX}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn-primary min-h-11 !px-3 !py-1.5 text-sm" disabled={!!busy || !draft.trim()}>
          {busy === "note" ? "Saving…" : "Save"}
        </button>
      </form>
      {error && (
        <div className="text-xs" style={{ color: "var(--danger-text)" }} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
