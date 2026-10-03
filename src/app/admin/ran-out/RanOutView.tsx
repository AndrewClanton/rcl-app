"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { OpenRanOut, RanOutBoard } from "@/lib/data/ran-out";
import { namesList, raiseParText, type OutageResolution } from "@/lib/ops/shared";
import { closeRanOut, saveRanOutAlertTo } from "./actions";

const TZ = "America/Chicago";
// "Fri 8:09 PM"
const dayTime = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: TZ });
const dayName = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

const DONE: Record<OutageResolution, string> = { bought: "Back in stock", found: "Found more", mistake: "False alarm" };
const HEAD = "mb-2 text-sm font-bold uppercase tracking-[0.12em] text-[var(--muted)]";

export default function RanOutView({ board, focusId, canEditAlerts }: { board: RanOutBoard; focusId: string | null; canEditAlerts: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const focused = focusId ? board.open.find((o) => o.id === focusId) : undefined;

  // The email's link: bring that one into view.
  useEffect(() => {
    if (focused) document.getElementById(`out-${focused.id}`)?.scrollIntoView({ block: "center" });
  }, [focused]);

  async function close(o: OpenRanOut, resolution: OutageResolution) {
    setBusyId(o.id);
    setError(null);
    const r = await closeRanOut(o.id, resolution).catch(() => null);
    setBusyId(null);
    if (!r || !r.ok) return setError(r && !r.ok ? r.error : "That didn't save. Check the connection and try again.");
    setMessage(`${DONE[resolution]}: ${o.name}. It's off the register.${r.back.length ? ` Back on sale: ${r.back.join(", ")}.` : ""}`);
    router.refresh();
  }

  return (
    <div className="space-y-8">
      {message && (
        <div className="notice notice-success flex items-center gap-3" role="status">
          <span className="flex-1">{message}</span>
          <button className="min-h-11 px-2 font-bold underline" onClick={() => setMessage(null)}>
            OK
          </button>
        </div>
      )}
      {error && (
        <p className="text-sm font-bold" style={{ color: "var(--danger-text)" }}>
          {error}
        </p>
      )}

      <section>
        <h2 className={HEAD}>Out now</h2>
        {focusId && !focused && !message && <div className="notice notice-success mb-3">That one has already been marked back in stock (or cleared). Nothing to do.</div>}
        {board.open.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nothing is reported out.</p>
        ) : (
          <ul className="grid gap-3">
            {board.open.map((o) => (
              <li
                key={o.id}
                id={`out-${o.id}`}
                className="rounded-lg border-2 bg-[var(--surface)] p-4"
                style={{ borderColor: o.id === focusId ? "var(--accent)" : "var(--border)" }}
              >
                <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-bold">
                      {o.name} {o.area && <span className="text-xs font-normal text-[var(--muted)]">{o.area}</span>}
                    </div>
                    <div className="text-sm">
                      Ran out {dayTime(o.reportedAt)}
                      {o.byName ? `, reported by ${o.byName}` : ""}. {o.onSheet ? (o.par ? `Par is ${o.par}.` : "No par set.") : "Not on the par sheet."}
                      {o.source ? ` Bought at ${o.source}.` : ""}
                    </div>
                    {o.note && <div className="text-sm text-[var(--muted)]">&ldquo;{o.note}&rdquo;</div>}
                    {o.stopped.length > 0 && (
                      <div className="text-sm font-bold" style={{ color: "var(--danger-text)" }}>
                        Not selling: {o.stopped.join(", ")}
                      </div>
                    )}
                    <div className="text-xs text-[var(--muted)]">{o.emailed.length ? `Emailed ${namesList(o.emailed)}.` : "No email went out for this one."}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className="btn-secondary min-h-11 !px-3 !py-2 text-sm" disabled={busyId === o.id} onClick={() => close(o, "mistake")}>
                      False alarm
                    </button>
                    <button className="btn-secondary min-h-11 !px-3 !py-2 text-sm" disabled={busyId === o.id} onClick={() => close(o, "found")}>
                      Found some
                    </button>
                    <button className="btn-primary min-h-11 !px-5 !py-2" disabled={busyId === o.id} onClick={() => close(o, "bought")}>
                      {busyId === o.id ? "Saving…" : "Back in stock"}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className={HEAD}>Ran out this week</h2>
        <p className="mb-2 text-sm text-[var(--muted)]">
          Since {dayName(board.week.start)}: {board.week.reports} report{board.week.reports === 1 ? "" : "s"}, false alarms left out. Running out before the week is over is the thing to fix: the week&apos;s shopping wasn&apos;t enough.
        </p>
        {board.week.lines.length > 0 && (
          <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            {board.week.lines.map((l) => (
              <li key={l.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 font-bold">{l.name}</span>
                {l.times > 1 && <span className="bo-badge bo-badge-warn">{l.times} times</span>}
                {l.stillOut && <span className="bo-badge bo-badge-warn">Still out</span>}
                <span className="text-[var(--muted)]">
                  {l.par ? `Par ${l.par} · ` : ""}last {dayTime(l.lastAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {board.oftenOut.length > 0 && (
          <div className="notice notice-warn mt-3">
            <ul className="space-y-1 text-sm">
              {board.oftenOut.map((o) => (
                <li key={o.parItemId}>{raiseParText(o)}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs">To change a par: on the register, Par sheet → Edit the list. Nothing changes by itself.</p>
          </div>
        )}
      </section>

      <AlertsTo board={board} canEdit={canEditAlerts} />
    </div>
  );
}

function AlertsTo({ board, canEdit }: { board: RanOutBoard; canEdit: boolean }) {
  const router = useRouter();
  const { ids, staff } = board.alerts;
  const [picked, setPicked] = useState<Set<string>>(new Set(ids));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = picked.size !== ids.length || ids.some((id) => !picked.has(id));
  const current = ids.map((id) => staff.find((s) => s.id === id)).filter((s): s is (typeof staff)[number] => !!s);
  const noEmail = staff.filter((s) => picked.has(s.id) && !s.hasEmail);

  async function save() {
    setBusy(true);
    setNote(null);
    // Keeps the order they were picked in (it's the order the register names them).
    const order = [...ids.filter((id) => picked.has(id)), ...staff.filter((s) => picked.has(s.id) && !ids.includes(s.id)).map((s) => s.id)];
    const r = await saveRanOutAlertTo(order).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) return setNote({ ok: false, text: r && !r.ok ? r.error : "That didn't save. Check the connection and try again." });
    setNote({ ok: true, text: "Saved. The next ran-out email goes to them." });
    router.refresh();
  }

  return (
    <section>
      <h2 className={HEAD}>Ran-out alerts go to</h2>
      <p className="mb-3 text-sm text-[var(--muted)]">
        The people who buy for the week. They get an email the moment anything&apos;s reported out, and the register tells staff they&apos;ve been emailed.
        {current.length ? ` Right now: ${namesList(current.map((s) => s.name))}.` : " Nobody is picked, so no email goes out."}
      </p>
      {canEdit ? (
        <>
          <div className="flex flex-wrap gap-2">
            {staff.map((s) => {
              const on = picked.has(s.id);
              return (
                <button
                  key={s.id}
                  className={`chip min-h-11 !px-3 !text-sm ${on ? "chip-selected font-bold" : ""}`}
                  aria-pressed={on}
                  onClick={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      return next;
                    })
                  }
                >
                  {on ? "✓ " : ""}
                  {s.name}
                </button>
              );
            })}
          </div>
          {noEmail.length > 0 && (
            <p className="mt-2 text-sm" style={{ color: "var(--danger-text)" }}>
              {namesList(noEmail.map((s) => s.name))} {noEmail.length === 1 ? "has" : "have"} no sign-in email, so the email can&apos;t reach them. Add one under Staff logins &amp; access.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn-primary min-h-11" disabled={busy || !changed} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
            {note && (
              <span className="text-sm font-bold" style={{ color: note.ok ? "var(--success-text)" : "var(--danger-text)" }}>
                {note.text}
              </span>
            )}
          </div>
        </>
      ) : (
        <p className="text-xs text-[var(--muted)]">An owner or admin can change who gets it.</p>
      )}
    </section>
  );
}
