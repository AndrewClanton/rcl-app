"use client";

import { useMemo, useState } from "react";

const CENTRAL_TZ = "America/Chicago";

interface ScreeningLite {
  id: string;
  title: string;
  startsAt: string;
}
interface EventLite {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD, already a plain date (not a timestamp)
  time: string; // HH:MM:SS wall-clock
  hours: number;
  room: string;
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

export default function ScheduleGraphicBuilder({ screenings, events }: { screenings: ScreeningLite[]; events: EventLite[] }) {
  const [startDate, setStartDate] = useState(todayCentral());
  const [days, setDays] = useState(7);
  const [format, setFormat] = useState<"poster" | "banner">("poster");
  const [excludedScreeningIds, setExcludedScreeningIds] = useState<Set<string>>(new Set());
  const [excludedEventIds, setExcludedEventIds] = useState<Set<string>>(new Set());

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

  const groupedDays = useMemo(() => {
    const byDay = new Map<string, { screenings: ScreeningLite[]; events: EventLite[] }>();
    function ensure(key: string) {
      let g = byDay.get(key);
      if (!g) {
        g = { screenings: [], events: [] };
        byDay.set(key, g);
      }
      return g;
    }
    for (const s of screeningsInRange) ensure(centralDateKey(s.startsAt)).screenings.push(s);
    for (const e of eventsInRange) ensure(e.date).events.push(e);
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [screeningsInRange, eventsInRange]);

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

  const includedScreeningIds = screeningsInRange.filter((s) => !excludedScreeningIds.has(s.id)).map((s) => s.id);
  const includedEventIds = eventsInRange.filter((e) => !excludedEventIds.has(e.id)).map((e) => e.id);
  const totalIncluded = includedScreeningIds.length + includedEventIds.length;
  const totalInRange = screeningsInRange.length + eventsInRange.length;
  const rangeLabel = `${dayHeading(startDate)} – ${dayHeading(endDate)}`;
  const imageUrl = `/admin/schedule-graphic/image?format=${format}&label=${encodeURIComponent(rangeLabel)}&screeningIds=${includedScreeningIds.join(",")}&eventIds=${includedEventIds.join(",")}`;

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <div className="space-y-4">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Starting</label>
              <input
                type="date"
                className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-500">For how many days</label>
              <input
                type="number"
                min={1}
                max={14}
                className="w-full rounded border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                value={days}
                onChange={(e) => setDays(Math.max(1, Math.min(14, parseInt(e.target.value) || 1)))}
              />
            </div>
          </div>

          <div className="mt-3">
            <label className="mb-1 block text-xs text-neutral-500">Shape</label>
            <div className="flex gap-2">
              <button
                className={`flex-1 rounded border px-2 py-1.5 text-sm ${format === "poster" ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900" : "border-neutral-300 dark:border-neutral-700"}`}
                onClick={() => setFormat("poster")}
              >
                Poster (1080×1350)
              </button>
              <button
                className={`flex-1 rounded border px-2 py-1.5 text-sm ${format === "banner" ? "border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900" : "border-neutral-300 dark:border-neutral-700"}`}
                onClick={() => setFormat("banner")}
              >
                Banner (1200×628)
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Included</h2>
            <span className="text-xs text-neutral-500">
              {totalIncluded} of {totalInRange}
            </span>
          </div>
          {groupedDays.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing scheduled or booked in this range.</p>
          ) : (
            <div className="max-h-[420px] space-y-3 overflow-y-auto">
              {groupedDays.map(([day, list]) => (
                <div key={day}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{dayHeading(day)}</div>
                  <div className="space-y-1">
                    {list.events.map((e) => (
                      <label key={e.id} className="flex items-start gap-2 text-sm">
                        <input type="checkbox" checked={!excludedEventIds.has(e.id)} onChange={() => toggleEvent(e.id)} className="mt-0.5" />
                        <span className={excludedEventIds.has(e.id) ? "text-neutral-400 line-through" : "text-amber-700 dark:text-amber-500"}>
                          {eventTimeRange(e.time, e.hours)} — {e.name}{" "}
                          <span className="text-xs text-neutral-500">({e.room})</span>
                        </span>
                      </label>
                    ))}
                    {list.screenings.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={!excludedScreeningIds.has(s.id)} onChange={() => toggleScreening(s.id)} />
                        <span className={excludedScreeningIds.has(s.id) ? "text-neutral-400 line-through" : ""}>
                          {screeningTime(s.startsAt)} — {s.title}
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
          className="block rounded-lg bg-neutral-900 py-2.5 text-center text-sm font-semibold text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        >
          Download PNG
        </a>
      </div>

      <div className="flex items-start justify-center rounded-xl border border-neutral-200 bg-neutral-50 p-6 dark:border-neutral-800 dark:bg-neutral-900">
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
