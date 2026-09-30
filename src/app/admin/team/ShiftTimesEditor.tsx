"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { centralLocal, formatHours } from "@/lib/hours";
import { editShiftTimes } from "./actions";

const HINT = {
  schedule: "Filled in with their scheduled end.",
  close: "Filled in with when the bar closed that night (the closing End shift).",
  day_end: "Filled in with 4:00 AM, the end of the business day. Change it to when they actually left.",
} as const;

// "Set clock-out" on a forgotten End shift, "Edit times" on any other clock-in.
// Opens a small window with the two times and a required reason.
export default function ShiftTimesEditor({
  shiftId,
  name,
  day,
  clockedIn,
  clockedOut,
  forgotten,
  stillOn,
  suggestedOut,
  suggestedFrom,
}: {
  shiftId: string;
  name: string;
  day: string;
  clockedIn: string;
  clockedOut: string | null;
  forgotten: boolean;
  stillOn: boolean;
  suggestedOut: string | null;
  suggestedFrom: keyof typeof HINT | null;
}) {
  const router = useRouter();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [clockIn, setClockIn] = useState(() => centralLocal(clockedIn));
  const [clockOut, setClockOut] = useState(() => (clockedOut ? centralLocal(clockedOut) : suggestedOut ? centralLocal(suggestedOut) : ""));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [max, setMax] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function start() {
    setClockIn(centralLocal(clockedIn));
    setClockOut(clockedOut ? centralLocal(clockedOut) : suggestedOut ? centralLocal(suggestedOut) : "");
    setNote("");
    setError(null);
    setMax(centralLocal(new Date().toISOString()));
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const r = await editShiftTimes({ shiftId, clockIn, clockOut, note }).catch(() => ({ ok: false as const, error: "That didn't save. Check the connection and try again." }));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  }

  // A preview only (wall-clock difference); the server works out the real one.
  const length = clockIn && clockOut ? (Date.parse(`${clockOut}:00Z`) - Date.parse(`${clockIn}:00Z`)) / 3_600_000 : null;
  const input = "mt-1 block w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-base text-[var(--foreground)] sm:text-sm";

  return (
    <>
      {forgotten ? (
        <button className="btn-primary whitespace-nowrap !px-3 !py-1 text-xs" onClick={start}>
          Set clock-out
        </button>
      ) : (
        <button className="whitespace-nowrap py-0.5 text-xs text-[var(--muted)] underline underline-offset-2 hover:text-[var(--foreground)]" onClick={start}>
          Edit times
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-10" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="card w-full max-w-md text-left text-[var(--foreground)] shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 id={titleId} className="text-base font-semibold">
                {forgotten ? "Set clock-out" : "Edit times"} · {name}
                <span className="block text-sm font-normal text-[var(--muted)]">{day}</span>
              </h2>
              <button className="text-sm text-[var(--muted)] hover:underline" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-[var(--muted)]">
                Clocked in
                <input type="datetime-local" className={input} value={clockIn} max={max} onChange={(e) => setClockIn(e.target.value)} />
              </label>
              <label className="text-xs text-[var(--muted)]">
                Clocked out
                <input type="datetime-local" className={input} value={clockOut} max={max} min={clockIn || undefined} onChange={(e) => setClockOut(e.target.value)} />
              </label>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              {forgotten && suggestedFrom ? `${HINT[suggestedFrom]} ` : ""}
              {stillOn && "Leave Clocked out empty if they're still here. "}
              {length !== null && length > 0 && <strong className="text-[var(--foreground)]">{formatHours(length)}</strong>}
            </p>
            <label className="mt-3 block text-xs text-[var(--muted)]">
              Why (required, kept with the shift)
              <input className={input} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={forgotten ? "Forgot to End shift; left at close" : "Clocked in late on the iPad"} />
            </label>
            {error && <p className="mt-2 text-sm text-[var(--danger-text)]">{error}</p>}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button className="btn-primary !px-4 !py-2 text-sm" disabled={busy || note.trim().length < 3 || (!clockOut && !stillOn)} onClick={save}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
