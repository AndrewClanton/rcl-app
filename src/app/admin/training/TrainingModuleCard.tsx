"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { StaffRow, TrainingStatus } from "@/lib/training/data";
import { assignTraining, unassignTraining } from "./actions";

type Person = TrainingStatus & { employeeId: string; name: string };

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "America/Chicago" });
const dueDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function StateChip({ p }: { p: Person }) {
  if (p.state === "done")
    return (
      <span className="rounded-full border border-[var(--success-border)] bg-[var(--success-bg)] px-2 py-0.5 text-xs text-[var(--success-text)]">
        ✓ Signed {p.completedAt ? day(p.completedAt) : ""}
        {p.via === "register" ? " · register" : ""}
      </span>
    );
  if (p.state === "update")
    return <span className="rounded-full border border-[var(--warn-border)] bg-[var(--warn-bg)] px-2 py-0.5 text-xs text-[var(--warn-text)]">Updated · needs to sign again</span>;
  if (p.state === "started") return <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs">Opened, not signed</span>;
  return <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">Not started</span>;
}

// One training in Back office → Training: who has it and where they are,
// and a panel to assign it to more people.
export default function TrainingModuleCard({
  module: m,
  people,
  staff,
}: {
  module: { slug: string; title: string; summary: string; category: string; minutes: number; version: number; hasQuiz: boolean };
  people: Person[];
  staff: StaffRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const involved = people.filter((p) => p.assigned || p.state).sort((a, b) => Number(a.state === "done") - Number(b.state === "done") || a.name.localeCompare(b.name));
  const done = people.filter((p) => p.assigned && p.state === "done").length;
  const assignedCount = people.filter((p) => p.assigned).length;
  // Who can still be assigned: anyone not already assigned.
  const assignable = staff.filter((s) => !people.find((p) => p.employeeId === s.id)?.assigned);

  function assign() {
    setMsg(null);
    startTransition(async () => {
      const r = await assignTraining(m.slug, picked, due || null, note).catch(() => null);
      if (!r || !r.ok) return setMsg({ ok: false, text: r && !r.ok ? r.error : "Couldn't assign it. Try again." });
      setMsg({ ok: true, text: `Assigned to ${r.count} ${r.count === 1 ? "person" : "people"}.` });
      setPicked([]);
      setDue("");
      setNote("");
      setOpen(false);
      router.refresh();
    });
  }

  function remove(p: Person) {
    if (!p.assignmentId) return;
    startTransition(async () => {
      const r = await unassignTraining(p.assignmentId!).catch(() => null);
      if (!r || !r.ok) return setMsg({ ok: false, text: "Couldn't remove it. Try again." });
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{m.title}</h2>
          <p className="mt-0.5 text-sm text-[var(--muted)]">
            {m.category} · {m.minutes} min{m.hasQuiz ? " · Quiz" : ""} · Version {m.version}
          </p>
          <p className="mt-1 text-sm">{m.summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {assignedCount > 0 && (
            <span className="text-sm">
              <b>
                {done}/{assignedCount}
              </b>{" "}
              signed off
            </span>
          )}
          <Link href={`/training/${m.slug}`} className="rounded border border-[var(--border)] px-3 py-1.5 text-sm hover:border-[var(--foreground)]">
            Preview
          </Link>
          <button className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white" onClick={() => setOpen((o) => !o)}>
            {open ? "Cancel" : "Assign"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-3 rounded-lg border border-[var(--border)] p-4">
          {assignable.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Everyone already has this one.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">Who</span>
                <button
                  className="chip !px-3 !py-1 !text-sm"
                  onClick={() => setPicked(picked.length === assignable.length ? [] : assignable.map((s) => s.id))}
                >
                  {picked.length === assignable.length ? "Clear" : "Everyone"}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {assignable.map((s) => {
                  const on = picked.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      className={`chip !px-3 !py-1.5 !text-sm ${on ? "chip-selected font-bold" : ""}`}
                      aria-pressed={on}
                      onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s.id) : [...p, s.id]))}
                    >
                      {on ? "✓ " : ""}
                      {s.name}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
                  Due
                  <input type="date" className="rounded border border-[var(--border)] px-2 py-1" value={due} onChange={(e) => setDue(e.target.value)} />
                </label>
                <span className="text-xs text-[var(--muted)]">Optional</span>
              </div>
              <input
                className="w-full rounded border border-[var(--border)] px-2 py-1.5 text-sm"
                placeholder="Note for them (optional), e.g. 'Before your Friday shift'"
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50" disabled={pending || picked.length === 0} onClick={assign}>
                {pending ? "Assigning..." : `Assign to ${picked.length || "…"}`}
              </button>
            </>
          )}
        </div>
      )}

      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}`}>{msg.text}</p>}

      {involved.length > 0 ? (
        <ul className="mt-4 divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {involved.map((p) => (
            <li key={p.employeeId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="min-w-[120px] flex-1 font-medium">{p.name}</span>
              <StateChip p={p} />
              {p.dueDate && p.state !== "done" && (
                <span className={p.overdue ? "font-semibold text-[var(--danger-text)]" : "text-[var(--muted)]"}>
                  {p.overdue ? "Overdue · " : "Due "}
                  {dueDay(p.dueDate)}
                </span>
              )}
              {!p.assigned && <span className="text-xs text-[var(--muted)]">(took it without being assigned)</span>}
              {p.assigned && p.state !== "done" && (
                <button className="text-xs text-[var(--muted)] hover:underline disabled:opacity-50" disabled={pending} onClick={() => remove(p)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-[var(--muted)]">Not assigned to anyone yet.</p>
      )}
    </div>
  );
}
