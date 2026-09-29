"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { HouseEvent } from "@/lib/data/house-events";
import { addHouseEvent, deleteHouseEvent } from "./actions";

const QUICK = ["Trivia Night", "Comedy Night", "Book Swap", "Open Mic Night"];

function when(e: HouseEvent) {
  const opts = { timeZone: "America/Chicago" } as const;
  const day = new Date(e.starts_at).toLocaleDateString("en-US", { ...opts, weekday: "short", month: "short", day: "numeric" });
  const t = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { ...opts, hour: "numeric", minute: "2-digit" });
  return `${day} · ${t(e.starts_at)}${e.ends_at ? `–${t(e.ends_at)}` : ""}`;
}

// Trivia, comedy, the book swap: they show on the ramp TV's countdown next
// to the films. Not on the public website.
export default function HouseEvents({ events }: { events: HouseEvent[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("19:00");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    const r = await addHouseEvent({ title, note, date, start, end }).catch(() => ({ ok: false as const, error: "Couldn't save that event. Try again." }));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setTitle("");
    setNote("");
    setEnd("");
    router.refresh();
  }

  return (
    <section className="mt-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold">House events</h2>
      <p className="mb-4 text-sm text-[var(--muted)]">Trivia, comedy, the book swap and the like. They count down on the ramp TV with the films.</p>

      {events.length > 0 && (
        <div className="mb-4 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
          {events.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <span className="w-56 shrink-0 text-[var(--muted)]">{when(e)}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{e.title}</span>
                {e.note && <span className="text-[var(--muted)]"> · {e.note}</span>}
              </span>
              <button
                className="text-xs text-[var(--danger-text)] hover:underline"
                onClick={async () => {
                  await deleteHouseEvent(e.id);
                  router.refresh();
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mb-2 flex flex-wrap gap-1.5">
        {QUICK.map((q) => (
          <button key={q} className={`chip ${title === q ? "chip-selected" : ""}`} onClick={() => setTitle(q)}>
            {q}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-[var(--muted)]">
          Name
          <input className="mt-1 block rounded border border-[var(--border)] px-2 py-1 text-sm text-[var(--foreground)]" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Trivia Night" />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Date
          <input type="date" className="mt-1 block rounded border border-[var(--border)] px-2 py-1 text-sm text-[var(--foreground)]" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Starts
          <input type="time" className="mt-1 block rounded border border-[var(--border)] px-2 py-1 text-sm text-[var(--foreground)]" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Ends (optional)
          <input type="time" className="mt-1 block rounded border border-[var(--border)] px-2 py-1 text-sm text-[var(--foreground)]" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="min-w-[12rem] flex-1 text-xs text-[var(--muted)]">
          Note (optional)
          <input className="mt-1 block w-full rounded border border-[var(--border)] px-2 py-1 text-sm text-[var(--foreground)]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Halloween & horror theme" />
        </label>
        <button className="btn-primary !px-4 !py-1.5 text-sm" disabled={busy || !title.trim() || !date} onClick={add}>
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-[var(--danger-text)]">{error}</p>}
    </section>
  );
}
