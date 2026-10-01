"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TeamMember, Todo } from "@/lib/data/team";
import { announceActionError } from "@/lib/useRefreshingAction";
import { addTodo, deleteTodo, setTodoDoneFromOffice } from "./actions";

// A failed mark-done or remove used to leave the list as it was with no word
// why; now it says so in the back office's error bar.
async function saved(p: Promise<{ ok: true } | { ok: false; error: string }>) {
  const r = await p.catch(() => ({ ok: false as const, error: "That didn't save. Check the connection and try again." }));
  if (!r.ok) announceActionError(r.error);
}

const due = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const stamp = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
const CLOSED_AS = { bought: "bought", found: "found some", mistake: "false alarm" } as const;

// One-off jobs: "Caleb: update the Now Playing movies by Friday". They show
// on the register for that person (or for whoever's on shift) until done.
// "Ran out" on the register adds restock ones for the managers ("Buy Hot
// dog buns at Walmart"): Bought it closes the report and puts what it
// stopped back on sale.
export default function TodoManager({ team, todos }: { team: TeamMember[]; todos: Todo[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  // null: not picked yet ("" means anyone on shift). Picking is required, so
  // Caleb's job can't land on whoever happens to be on by accident.
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = todos.filter((t) => !t.doneAt);
  const done = todos.filter((t) => t.doneAt);

  async function add() {
    setBusy(true);
    setError(null);
    const r = await addTodo({ title, details, assigneeId: assigneeId ?? "", dueDate }).catch(() => ({ ok: false as const, error: "Couldn't save that." }));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setTitle("");
    setDetails("");
    setDueDate("");
    setAssigneeId(null);
    router.refresh();
  }

  return (
    // On a computer the form sits on the left and stays put; the lists
    // take the rest of the width.
    <div className="space-y-5 xl:grid xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] xl:items-start xl:gap-6 xl:space-y-0">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 xl:sticky xl:top-4">
        <h2 className="mb-1 text-sm font-semibold">Give someone a to-do</h2>
        <p className="mb-3 text-xs text-[var(--muted)]">It pops up on the register for them when they&apos;re on shift, until they tap Done.</p>
        <div className="mb-3">
          <div className="mb-1 text-xs text-[var(--muted)]">Who&apos;s it for?</div>
          <div className="flex flex-wrap gap-2">
            {team.map((m) => (
              <button key={m.id} className={`chip !px-3 !py-1.5 !text-sm ${assigneeId === m.id ? "chip-selected font-bold" : ""}`} onClick={() => setAssigneeId(m.id)}>
                {m.name}
              </button>
            ))}
            <button className={`chip !px-3 !py-1.5 !text-sm ${assigneeId === "" ? "chip-selected font-bold" : ""}`} onClick={() => setAssigneeId("")}>
              Anyone on shift
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[14rem] flex-[2] text-xs text-[var(--muted)]">
            What needs doing
            <input className="mt-1 block w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm text-[var(--foreground)]" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Update the Now Playing movies" />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Due (optional)
            <input type="date" className="mt-1 block rounded border border-[var(--border)] px-2 py-1.5 text-sm text-[var(--foreground)]" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
          <label className="min-w-[14rem] flex-[2] text-xs text-[var(--muted)]">
            Details (optional)
            <input className="mt-1 block w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm text-[var(--foreground)]" value={details} onChange={(e) => setDetails(e.target.value)} placeholder="The new posters are in the office" />
          </label>
          <button className="btn-primary !px-4 !py-1.5 text-sm" disabled={busy || !title.trim() || assigneeId === null} onClick={add}>
            {busy ? "Adding…" : assigneeId === null ? "Pick who it's for" : "Add"}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-[var(--danger-text)]">{error}</p>}
      </section>

      <div className="space-y-5">
        <section>
          <h2 className="mb-2 text-sm font-semibold">
            Open <span className="font-normal text-[var(--muted)]">· {open.length}</span>
          </h2>
          {open.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Nothing waiting.</p>
          ) : (
            <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              {open.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {t.outageId && <span className="bo-badge bo-badge-warn mr-1.5 align-middle">Ran out</span>}
                      {t.title}
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      {t.forManagers ? "For the managers" : `For ${t.assigneeName ?? "whoever's on shift"}`}
                      {t.dueDate && ` · due ${due(t.dueDate)}`}
                      {t.createdByName && !t.outageId && ` · from ${t.createdByName}`}
                      {t.details && ` · ${t.details}`}
                    </div>
                  </div>
                  <button
                    className={t.outageId ? "btn-primary min-h-11 !px-3 !py-1 text-xs" : "rounded border border-[var(--border)] px-2 py-1 text-xs"}
                    title={t.outageId ? "Closes the Ran out report and puts what it stopped back on sale" : undefined}
                    onClick={async () => {
                      await saved(setTodoDoneFromOffice(t.id, true));
                      router.refresh();
                    }}
                  >
                    {t.outageId ? "Bought it" : "Mark done"}
                  </button>
                  {!t.outageId && (
                    <button
                      className="text-xs text-[var(--danger-text)] hover:underline"
                      onClick={async () => {
                        await saved(deleteTodo(t.id));
                        router.refresh();
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {done.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold">
              Done lately <span className="font-normal text-[var(--muted)]">· last two weeks</span>
            </h2>
            <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm">
              {done.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-[var(--muted)]">
                  <span className="min-w-0 flex-1">
                    <span className="line-through">{t.title}</span>
                    {t.closedAs && ` (${CLOSED_AS[t.closedAs]})`} · {t.doneByName ?? "someone"}, {t.doneAt ? stamp(t.doneAt) : ""}
                  </span>
                  {/* A restock to-do closed with its report; if it's out again, it gets reported again. */}
                  {!t.outageId && (
                    <button
                      className="text-xs hover:underline"
                      onClick={async () => {
                        await saved(setTodoDoneFromOffice(t.id, false));
                        router.refresh();
                      }}
                    >
                      Reopen
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
