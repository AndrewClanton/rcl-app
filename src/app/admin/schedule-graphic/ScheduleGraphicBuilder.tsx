"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCalendarNote, deleteCalendarNote } from "./actions";

const CENTRAL_TZ = "America/Chicago";

interface ScreeningLite {
  id: string;
  title: string;
  startsAt: string;
  room: string;
}
interface EventLite {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD, already a plain date (not a timestamp)
  time: string; // HH:MM:SS wall-clock
  hours: number;
  room: string;
}
interface NoteLite {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string | null; // HH:MM:SS wall-clock, null = all-day
  endTime: string | null;
  label: string;
}

// YYYY-MM-DD in Central time regardless of the visitor's own timezone or
// the server's -- en-CA happens to format dates this way by default.
function centralDateKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: CENTRAL_TZ });
}

function todayCentral() {
  return new Date().toLocaleDateString("en-CA", { timeZone: CENTRAL_TZ });
}

function addDays(dateKey: string, days: number) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayHeading(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  return date.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
}

function screeningTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: CENTRAL_TZ, hour: "numeric", minute: "2-digit" });
}

function fmtWallClock(time: string) {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function eventTimeRange(time: string, hours: number) {
  const [h, m] = time.split(":").map(Number);
  const startMinutes = h * 60 + m;
  const endMinutes = startMinutes + Math.round(hours * 60);
  const fmt = (total: number) => {
    const hh = Math.floor(total / 60) % 24;
    const mm = total % 60;
    const period = hh >= 12 ? "PM" : "AM";
    const hour12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${hour12}:${String(mm).padStart(2, "0")} ${period}`;
  };
  return `${fmt(startMinutes)}–${fmt(endMinutes)}`;
}

export default function ScheduleGraphicBuilder({
  screenings,
  events,
  notes,
}: {
  screenings: ScreeningLite[];
  events: EventLite[];
  notes: NoteLite[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [startDate, setStartDate] = useState(todayCentral());
  const [days, setDays] = useState(7);
  const [format, setFormat] = useState<"grid" | "banner">("grid");
  const [planAheadNote, setPlanAheadNote] = useState("");
  const [excludedScreeningIds, setExcludedScreeningIds] = useState<Set<string>>(new Set());
  const [excludedEventIds, setExcludedEventIds] = useState<Set<string>>(new Set());
  const [excludedNoteIds, setExcludedNoteIds] = useState<Set<string>>(new Set());

  const [newNoteDate, setNewNoteDate] = useState(todayCentral());
  const [newNoteAllDay, setNewNoteAllDay] = useState(false);
  const [newNoteStart, setNewNoteStart] = useState("18:00");
  const [newNoteEnd, setNewNoteEnd] = useState("21:00");
  const [newNoteLabel, setNewNoteLabel] = useState("");

  const endDate = addDays(startDate, days - 1);

  const screeningsInRange = useMemo(
    () => screenings.filter((s) => {
      const key = centralDateKey(s.startsAt);
      return key >= startDate && key <= endDate;
    }),
    [screenings, startDate, endDate]
  );
  const eventsInRange = useMemo(
    () => events.filter((e) => e.date >= startDate && e.date <= endDate),
    [events, startDate, endDate]
  );
  const notesInRange = useMemo(
    () => notes.filter((n) => n.date >= startDate && n.date <= endDate),
    [notes, startDate, endDate]
  );

  const groupedDays = useMemo(() => {
    const byDay = new Map<string, { screenings: ScreeningLite[]; events: EventLite[]; notes: NoteLite[] }>();
    function ensure(key: string) {
      let g = byDay.get(key);
      if (!g) {
        g = { screenings: [], events: [], notes: [] };
        byDay.set(key, g);
      }
      return g;
    }
    for (const s of screeningsInRange) ensure(centralDateKey(s.startsAt)).screenings.push(s);
    for (const e of eventsInRange) ensure(e.date).events.push(e);
    for (const n of notesInRange) ensure(n.date).notes.push(n);
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [screeningsInRange, eventsInRange, notesInRange]);

  function toggleScreening(id: string) {
    setExcludedScreeningIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleEvent(id: string) {
    setExcludedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleNote(id: string) {
    setExcludedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submitNewNote() {
    if (!newNoteLabel.trim()) return;
    startTransition(async () => {
      await addCalendarNote({
        noteDate: newNoteDate,
        startTime: newNoteAllDay ? null : newNoteStart,
        endTime: newNoteAllDay ? null : newNoteEnd,
        label: newNoteLabel.trim(),
      });
      setNewNoteLabel("");
      router.refresh();
    });
  }

  function removeNote(id: string) {
    startTransition(async () => {
      await deleteCalendarNote(id);
      router.refresh();
    });
  }

  const includedScreeningIds = screeningsInRange.filter((s) => !excludedScreeningIds.has(s.id)).map((s) => s.id);
  const includedEventIds = eventsInRange.filter((e) => !excludedEventIds.has(e.id)).map((e) => e.id);
  const includedNoteIds = notesInRange.filter((n) => !excludedNoteIds.has(n.id)).map((n) => n.id);
  const totalIncluded = includedScreeningIds.length + includedEventIds.length + includedNoteIds.length;
  const totalInRange = screeningsInRange.length + eventsInRange.length + notesInRange.length;
  const rangeLabel = `${dayHeading(startDate)} – ${dayHeading(endDate)}`;
  const imageUrl = `/admin/schedule-graphic/image?format=${format}&label=${encodeURIComponent(rangeLabel)}&note=${encodeURIComponent(planAheadNote)}&start=${startDate}&days=${days}&screeningIds=${includedScreeningIds.join(",")}&eventIds=${includedEventIds.join(",")}&noteIds=${includedNoteIds.join(",")}`;

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 ">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--muted)]">Starting</label>
              <input
                type="date"
                className="w-full rounded border border-[var(--border)] px-2 py-1 text-sm "
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--muted)]">For how many days</label>
              <input
                type="number"
                min={1}
                max={14}
                className="w-full rounded border border-[var(--border)] px-2 py-1 text-sm "
                value={days}
                onChange={(e) => setDays(Math.max(1, Math.min(14, parseInt(e.target.value) || 1)))}
              />
            </div>
          </div>

          <div className="mt-3">
            <label className="mb-1 block text-xs text-[var(--muted)]">Shape</label>
            <div className="flex gap-2">
              <button
                className={`flex-1 rounded border px-2 py-1.5 text-sm ${format === "grid" ? "border-[var(--foreground)] bg-[var(--accent)] text-white " : "border-[var(--border)] "}`}
                onClick={() => setFormat("grid")}
              >
                Full-page grid (1920×1080)
              </button>
              <button
                className={`flex-1 rounded border px-2 py-1.5 text-sm ${format === "banner" ? "border-[var(--foreground)] bg-[var(--accent)] text-white " : "border-[var(--border)] "}`}
                onClick={() => setFormat("banner")}
              >
                Banner (1200×628)
              </button>
            </div>
          </div>

          {format === "grid" && (
            <div className="mt-3">
              <label className="mb-1 block text-xs text-[var(--muted)]">&quot;Plan ahead&quot; note (optional)</label>
              <input
                type="text"
                placeholder="e.g. Halloween double feature next Fri"
                className="w-full rounded border border-[var(--border)] px-2 py-1 text-sm "
                value={planAheadNote}
                onChange={(e) => setPlanAheadNote(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 ">
          <h2 className="mb-2 text-sm font-semibold">Add a custom note</h2>
          <p className="mb-2 text-xs text-[var(--muted)]">
            For anything that isn&apos;t a real screening or a billed booking -- e.g. &quot;closed for a private
            party&quot; at a specific hour, or closed all day.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--muted)]">Date</label>
              <input
                type="date"
                className="w-full rounded border border-[var(--border)] px-2 py-1 text-sm "
                value={newNoteDate}
                onChange={(e) => setNewNoteDate(e.target.value)}
              />
            </div>
            <div className="flex items-end pb-1.5">
              <label className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                <input type="checkbox" checked={newNoteAllDay} onChange={(e) => setNewNoteAllDay(e.target.checked)} />
                All day
              </label>
            </div>
          </div>
          {!newNoteAllDay && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-[var(--muted)]">From</label>
                <input
                  type="time"
                  className="w-full rounded border border-[var(--border)] px-2 py-1 text-sm "
                  value={newNoteStart}
                  onChange={(e) => setNewNoteStart(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--muted)]">To</label>
                <input
                  type="time"
                  className="w-full rounded border border-[var(--border)] px-2 py-1 text-sm "
                  value={newNoteEnd}
                  onChange={(e) => setNewNoteEnd(e.target.value)}
                />
              </div>
            </div>
          )}
          <div className="mt-2">
            <label className="mb-1 block text-xs text-[var(--muted)]">Label</label>
            <input
              type="text"
              placeholder="e.g. Closed -- private event"
              className="w-full rounded border border-[var(--border)] px-2 py-1 text-sm "
              value={newNoteLabel}
              onChange={(e) => setNewNoteLabel(e.target.value)}
            />
          </div>
          <button
            onClick={submitNewNote}
            disabled={isPending || !newNoteLabel.trim()}
            className="mt-3 w-full rounded border border-[var(--border)] py-1.5 text-sm font-medium disabled:opacity-40 "
          >
            {isPending ? "Saving…" : "Add note"}
          </button>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 ">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Included</h2>
            <span className="text-xs text-[var(--muted)]">
              {totalIncluded} of {totalInRange}
            </span>
          </div>
          {groupedDays.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Nothing scheduled or booked in this range.</p>
          ) : (
            <div className="max-h-[420px] space-y-3 overflow-y-auto">
              {groupedDays.map(([day, list]) => (
                <div key={day}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">{dayHeading(day)}</div>
                  <div className="space-y-1">
                    {list.notes.map((n) => (
                      <div key={n.id} className="flex items-start gap-2 text-sm">
                        <input type="checkbox" checked={!excludedNoteIds.has(n.id)} onChange={() => toggleNote(n.id)} className="mt-0.5" />
                        <span className={`flex-1 ${excludedNoteIds.has(n.id) ? "text-[var(--muted)] line-through" : "text-[var(--muted)] "}`}>
                          {n.startTime ? `${fmtWallClock(n.startTime)}${n.endTime ? `–${fmtWallClock(n.endTime)}` : ""}` : "All day"} — {n.label}
                        </span>
                        <button onClick={() => removeNote(n.id)} className="text-xs text-[var(--muted)] hover:text-[var(--danger-text)]" title="Delete note">
                          ✕
                        </button>
                      </div>
                    ))}
                    {list.events.map((e) => (
                      <label key={e.id} className="flex items-start gap-2 text-sm">
                        <input type="checkbox" checked={!excludedEventIds.has(e.id)} onChange={() => toggleEvent(e.id)} className="mt-0.5" />
                        <span className={excludedEventIds.has(e.id) ? "text-[var(--muted)] line-through" : "text-[var(--warn-text)] "}>
                          {eventTimeRange(e.time, e.hours)} — {e.name}{" "}
                          <span className="text-xs text-[var(--muted)]">({e.room})</span>
                        </span>
                      </label>
                    ))}
                    {list.screenings.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={!excludedScreeningIds.has(s.id)} onChange={() => toggleScreening(s.id)} />
                        <span className={excludedScreeningIds.has(s.id) ? "text-[var(--muted)] line-through" : s.room.toLowerCase().includes("outdoor") ? "text-[var(--success-text)] " : ""}>
                          {screeningTime(s.startsAt)} — {s.title}
                          {s.room.toLowerCase().includes("outdoor") && !excludedScreeningIds.has(s.id) ? " (outdoor)" : ""}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <a
          href={imageUrl}
          download={`royale-cinema-schedule-${startDate}.png`}
          className="block rounded-lg bg-[var(--accent)] py-2.5 text-center text-sm font-semibold text-white disabled:opacity-40 "
        >
          Download PNG
        </a>
      </div>

      <div className="flex items-start justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-hover)] p-6 ">
        {/* eslint-disable-next-line @next/next/no-img-element -- server-generated PNG, not a static asset next/image can optimize */}
        <img
          key={imageUrl}
          src={imageUrl}
          alt="Schedule graphic preview"
          className="max-w-full rounded-lg shadow-lg"
          style={{ maxHeight: "80vh" }}
        />
      </div>
    </div>
  );
}
