"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ScheduledShift, TeamMember } from "@/lib/data/team";
import { addScheduledShift, copyWeekForward, deleteScheduledShift, restoreScheduledShift } from "./actions";

type Shift = ScheduledShift & { time: string; date: string };

// The week on one screen: a row per person, a column per day. Tap a day
// cell to put someone on; tap a shift to remove it (asks first, can be undone).
export default function ScheduleWeek({ week, days, team, shifts }: { week: string; days: { date: string; label: string }[]; team: TeamMember[]; shifts: Shift[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState<{ employeeId: string; date: string } | null>(null);
  const [start, setStart] = useState("16:00");
  const [end, setEnd] = useState("22:00");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Shift | null>(null);
  const [undo, setUndo] = useState<{ id: string; label: string } | null>(null);
  const nameOf = (id: string) => team.find((t) => t.id === id)?.name ?? "Someone";
  const dayOf = (date: string) => days.find((d) => d.date === date)?.label ?? date;

  async function save() {
    if (!adding) return;
    setBusy(true);
    setError(null);
    const r = await addScheduledShift({ employeeId: adding.employeeId, date: adding.date, start, end, note }).catch(() => ({ ok: false as const, error: "Couldn't save that shift." }));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setAdding(null);
    setNote("");
    router.refresh();
  }

  const hours = (s: Shift) => (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 3_600_000;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-32 border-b border-[var(--border)] p-2 text-left text-xs font-medium text-[var(--muted)]">Person</th>
              {days.map((d) => (
                <th key={d.date} className="border-b border-l border-[var(--border)] p-2 text-left text-xs font-medium text-[var(--muted)]">
                  {d.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {team.map((m) => {
              const total = shifts.filter((s) => s.employeeId === m.id).reduce((n, s) => n + hours(s), 0);
              return (
                <tr key={m.id} className="align-top">
                  <td className="border-t border-[var(--border)] p-2">
                    <Link href={`/admin/team/${m.id}`} className="font-medium underline-offset-2 hover:underline">
                      {m.name}
                    </Link>
                    <div className="text-xs text-[var(--muted)]">{total ? `${total.toFixed(1)} h` : "—"}</div>
                  </td>
                  {days.map((d) => {
                    const mine = shifts.filter((s) => s.employeeId === m.id && s.date === d.date);
                    return (
                      <td key={d.date} className="border-l border-t border-[var(--border)] p-1.5">
                        <div className="flex flex-col gap-1">
                          {mine.map((s) => (
                            <button
                              key={s.id}
                              className="rounded bg-[var(--foreground)] px-1.5 py-1 text-left text-xs text-[var(--background)]"
                              title="Remove this shift"
                              onClick={() => {
                                setConfirm(s);
                                setAdding(null);
                              }}
                            >
                              {s.time}
                              {s.note && <span className="block opacity-75">{s.note}</span>}
                            </button>
                          ))}
                          <button
                            className="rounded border border-dashed border-[var(--border)] px-1.5 py-0.5 text-xs text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                            onClick={() => {
                              setAdding({ employeeId: m.id, date: d.date });
                              setError(null);
                            }}
                          >
                            +
                          </button>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {confirm && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--danger-text)] bg-[var(--surface)] p-3 text-sm">
          <span className="flex-1">
            Remove <strong>{nameOf(confirm.employeeId)}</strong> · {dayOf(confirm.date)} {confirm.time}?
          </span>
          <button
            className="btn-primary !px-4 !py-1.5 text-sm"
            onClick={async () => {
              const s = confirm;
              setConfirm(null);
              const r = await deleteScheduledShift(s.id).catch(() => ({ ok: false as const, error: "Couldn't remove that shift. Check the connection and try again." }));
              // Only offer Undo for a shift that actually came off.
              if (!r.ok) setInfo(r.error);
              else {
                setUndo({ id: s.id, label: `${nameOf(s.employeeId)} · ${dayOf(s.date)} ${s.time}` });
                setTimeout(() => setUndo((u) => (u?.id === s.id ? null : u)), 8000);
              }
              router.refresh();
            }}
          >
            Remove
          </button>
          <button className="text-sm text-[var(--muted)] hover:underline" onClick={() => setConfirm(null)}>
            Keep it
          </button>
        </div>
      )}

      {undo && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-[var(--foreground)] px-3 py-2 text-sm text-[var(--background)]">
          <span className="flex-1">Removed {undo.label}.</span>
          <button
            className="font-bold underline"
            onClick={async () => {
              const r = await restoreScheduledShift(undo.id);
              setUndo(null);
              if (!r.ok) setInfo(r.error);
              router.refresh();
            }}
          >
            Undo
          </button>
        </div>
      )}

      {adding && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--accent)] bg-[var(--surface)] p-3">
          <div className="text-sm font-semibold">
            {team.find((t) => t.id === adding.employeeId)?.name} · {days.find((d) => d.date === adding.date)?.label}
          </div>
          <label className="text-xs text-[var(--muted)]">
            Starts
            <input type="time" className="mt-1 block rounded border border-[var(--border)] px-2 py-1 text-sm text-[var(--foreground)]" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--muted)]">
            Ends
            <input type="time" className="mt-1 block rounded border border-[var(--border)] px-2 py-1 text-sm text-[var(--foreground)]" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <label className="min-w-[10rem] flex-1 text-xs text-[var(--muted)]">
            Note (optional)
            <input className="mt-1 block w-full rounded border border-[var(--border)] px-2 py-1 text-sm text-[var(--foreground)]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Bar, box office, closing…" />
          </label>
          <button className="btn-primary !px-4 !py-1.5 text-sm" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Add shift"}
          </button>
          <button className="text-sm text-[var(--muted)] hover:underline" onClick={() => setAdding(null)}>
            Cancel
          </button>
          {error && <p className="w-full text-sm text-[var(--danger-text)]">{error}</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          className="btn-secondary !px-3 !py-1.5 text-sm"
          onClick={async () => {
            setInfo(null);
            const r = await copyWeekForward(week).catch(() => ({ ok: false as const, error: "Couldn't copy the week." }));
            setInfo(r.ok ? `Copied ${r.copied ?? 0} shift${r.copied === 1 ? "" : "s"} onto next week${r.skipped ? ` · ${r.skipped} already there` : ""}.` : r.error);
            router.refresh();
          }}
        >
          Copy this week to next week
        </button>
        {info && <span className="text-[var(--muted)]">{info}</span>}
        <span className="text-xs text-[var(--muted)]">Tap + to add a shift, tap a shift to remove it. Shifts ending after midnight count on the day they start. Copying never doubles a shift that&apos;s already there.</span>
      </div>
    </div>
  );
}
