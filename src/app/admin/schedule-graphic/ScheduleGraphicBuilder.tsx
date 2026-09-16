"use client";

import { useMemo, useState } from "react";

const CENTRAL_TZ = "America/Chicago";

interface ScreeningLite {
  id: string;
  title: string;
  startsAt: string;
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

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: CENTRAL_TZ, hour: "numeric", minute: "2-digit" });
}

export default function ScheduleGraphicBuilder({ screenings }: { screenings: ScreeningLite[] }) {
  const [startDate, setStartDate] = useState(todayCentral());
  const [days, setDays] = useState(7);
  const [format, setFormat] = useState<"poster" | "banner">("poster");
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  const endDate = addDays(startDate, days - 1);

  const inRange = useMemo(
    () => screenings.filter((s) => {
      const key = centralDateKey(s.startsAt);
      return key >= startDate && key <= endDate;
    }),
    [screenings, startDate, endDate]
  );

  const grouped = useMemo(() => {
    const byDay = new Map<string, ScreeningLite[]>();
    for (const s of inRange) {
      const key = centralDateKey(s.startsAt);
      const list = byDay.get(key) ?? [];
      list.push(s);
      byDay.set(key, list);
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [inRange]);

  function toggle(id: string) {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const includedIds = inRange.filter((s) => !excludedIds.has(s.id)).map((s) => s.id);
  const rangeLabel = `${dayHeading(startDate)} – ${dayHeading(endDate)}`;
  const imageUrl = `/admin/schedule-graphic/image?format=${format}&label=${encodeURIComponent(rangeLabel)}&ids=${includedIds.join(",")}`;

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
            <h2 className="text-sm font-semibold">Included screenings</h2>
            <span className="text-xs text-neutral-500">
              {includedIds.length} of {inRange.length}
            </span>
          </div>
          {grouped.length === 0 ? (
            <p className="text-sm text-neutral-500">No screenings scheduled in this range.</p>
          ) : (
            <div className="max-h-[420px] space-y-3 overflow-y-auto">
              {grouped.map(([day, list]) => (
                <div key={day}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{dayHeading(day)}</div>
                  <div className="space-y-1">
                    {list.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={!excludedIds.has(s.id)} onChange={() => toggle(s.id)} />
                        <span className={excludedIds.has(s.id) ? "text-neutral-400 line-through" : ""}>
                          {s.title} — {timeLabel(s.startsAt)}
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
