"use client";

import { useState } from "react";
import Link from "next/link";
import type { Line, Picks, SyncPlan } from "@/lib/calendar-sync";
import { applyCalendarSync, previewCalendarSync, type ApplyResult } from "./actions";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayHead = (d: string) => `${DAY[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Kind = "add" | "change" | "remove";
const KIND: Record<Kind, { label: string; cls: string }> = {
  add: { label: "Add", cls: "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300" },
  change: { label: "Change", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  remove: { label: "Remove", cls: "bg-red-600/15 text-red-700 dark:text-red-300" },
};

function where(l: Line) {
  return l.where === "outdoor" ? " · outdoor" : "";
}

function SmallList({ items, empty }: { items: Line[]; empty?: string }) {
  if (!items.length) return empty ? <p className="text-sm text-[var(--muted)]">{empty}</p> : null;
  return (
    <ul className="space-y-1 text-sm">
      {items.map((l, i) => (
        <li key={i}>
          <span className="font-medium">
            {dayHead(l.date)} {l.clock}
          </span>{" "}
          {l.title}
          {where(l)}
          {l.detail && <span className="text-[var(--muted)]"> — {l.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

export default function CalendarSync() {
  const [file, setFile] = useState<File | null>(null);
  const [picks, setPicks] = useState<Picks>({});
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "apply">("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<Extract<ApplyResult, { ok: true }> | null>(null);
  const [sure, setSure] = useState(false);

  function form(f: File, p: Picks) {
    const fd = new FormData();
    fd.set("file", f);
    fd.set("picks", JSON.stringify(p));
    return fd;
  }

  async function preview(f: File, p: Picks) {
    setBusy("preview");
    setError("");
    setDone(null);
    try {
      const r = await previewCalendarSync(form(f, p));
      if (r.ok) setPlan(r.plan);
      else {
        setPlan(null);
        setError(r.error);
      }
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      setBusy("");
    }
  }

  async function apply() {
    if (!file || !plan) return;
    setBusy("apply");
    setError("");
    try {
      const fd = form(file, picks);
      fd.set("signature", plan.signature);
      const r = await applyCalendarSync(fd);
      if (r.ok) {
        setDone(r);
        setPlan(null);
        setFile(null);
        setPicks({});
        setSure(false);
      } else {
        setError(r.error);
        if (r.plan) setPlan(r.plan);
      }
    } catch {
      setError("Couldn't reach the server. Nothing may have been saved: open Showtimes to check before trying again.");
    } finally {
      setBusy("");
    }
  }

  function pick(key: string, value: string) {
    const next = { ...picks, [key]: value };
    setPicks(next);
    if (file) void preview(file, next);
  }

  const days = new Map<string, { kind: Kind; l: Line }[]>();
  if (plan) {
    for (const [kind, list] of [["add", plan.add], ["change", plan.change], ["remove", plan.remove]] as [Kind, Line[]][]) {
      for (const l of list) days.set(l.date, [...(days.get(l.date) ?? []), { kind, l }]);
    }
  }
  const dayList = [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
  // Uploading an old copy of the calendar would empty the schedule: a
  // sync that mostly removes asks once more.
  const bigRemoval = !!plan && plan.remove.length >= 10 && plan.remove.length > plan.add.length + plan.change.length;
  const nothing = !!plan && !plan.add.length && !plan.change.length && !plan.remove.length;
  const unpicked = plan?.looks.filter((l) => !l.picked || l.picked === "skip").length ?? 0;
  const needs = plan ? plan.looks.length + plan.flagged.length + plan.odd.length : 0;

  return (
    <div className="space-y-6">
      <section className="card space-y-3">
        <label className="block">
          <span className="mb-1 block font-medium">The calendar file (.xlsx)</span>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="block w-full text-base file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-[var(--surface-hover)] file:px-4 file:font-medium"
            disabled={!!busy}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setPicks({});
              setPlan(null);
              setSure(false);
              if (f) void preview(f, {});
            }}
          />
        </label>
        <p className="text-sm text-[var(--muted)]">
          On a phone, tap the box and choose Google Drive (or Files), then the calendar. Nothing changes until you tap Apply.
        </p>
        {busy === "preview" && <p className="text-sm">Reading the calendar…</p>}
      </section>

      {error && <p className="notice notice-warn text-sm">{error}</p>}

      {done && (
        <div className="notice notice-success space-y-1 text-sm">
          <p className="font-medium">Synced.</p>
          <p>
            {plural(done.added, "showing")} added, {plural(done.changed, "showing")} changed, {plural(done.removed, "showing")} removed
            {done.filmsAdded ? `, ${plural(done.filmsAdded, "film")} added to the library from TMDb` : ""}.
            {done.kept ? ` ${plural(done.kept, "showing")} sold tickets in the meantime and ${done.kept === 1 ? "was" : "were"} kept.` : ""}
          </p>
          <p>
            The website picks it up within a minute. <Link href="/admin/screenings" className="underline">Back to Showtimes</Link>
          </p>
        </div>
      )}

      {plan && (
        <>
          <section className="card space-y-2">
            <p className="text-sm text-[var(--muted)]">
              {dayHead(plan.today)} through {dayHead(plan.lastDate)}, from the {plan.tabs.join(", ")} {plan.tabs.length === 1 ? "tab" : "tabs"}.
            </p>
            <div className="flex flex-wrap gap-2 text-sm font-medium">
              <span className={`rounded-full px-3 py-1 ${KIND.add.cls}`}>{plan.add.length} to add</span>
              <span className={`rounded-full px-3 py-1 ${KIND.change.cls}`}>{plan.change.length} to change</span>
              <span className={`rounded-full px-3 py-1 ${KIND.remove.cls}`}>{plan.remove.length} to remove</span>
              <span className="rounded-full bg-[var(--surface-hover)] px-3 py-1">{needs} need a look</span>
            </div>
          </section>

          {(needs > 0 || plan.skipped.length > 0 || plan.kept.length > 0) && (
            <section className="card space-y-4">
              <h2 className="text-lg font-semibold">Needs a look</h2>

              {plan.looks.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-medium">Which film?</h3>
                  {plan.looks.map((l) => (
                    <div key={l.key} className="space-y-1">
                      <p className="text-sm">
                        <span className="font-medium">
                          &ldquo;{l.title}
                          {l.year ? ` ${l.year}` : ""}&rdquo;
                        </span>{" "}
                        <span className="text-[var(--muted)]">
                          {l.kind === "ambiguous" ? "matches several films" : "isn't in the movie library yet"} · {l.when.join(", ")}
                        </span>
                      </p>
                      <select className="input min-h-11 w-full text-base" value={l.picked ?? ""} disabled={!!busy} onChange={(e) => pick(l.key, e.target.value)}>
                        <option value="" disabled>
                          Pick the film…
                        </option>
                        {l.candidates.some((c) => c.source === "library") && (
                          <optgroup label="In the movie library">
                            {l.candidates.filter((c) => c.source === "library").map((c) => (
                              <option key={c.value} value={c.value}>
                                {c.label}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {l.candidates.some((c) => c.source === "tmdb") && (
                          <optgroup label="Add from TMDb">
                            {l.candidates.filter((c) => c.source === "tmdb").map((c) => (
                              <option key={c.value} value={c.value}>
                                {c.label}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <option value="skip">Skip: leave these showings as they are</option>
                      </select>
                    </div>
                  ))}
                  {unpicked > 0 && <p className="text-sm text-[var(--muted)]">Titles not picked are left as they are on the schedule.</p>}
                </div>
              )}

              {plan.flagged.length > 0 && (
                <div className="space-y-1">
                  <h3 className="font-medium">Tickets sold, so not moved or removed</h3>
                  <SmallList items={plan.flagged} />
                </div>
              )}

              {plan.odd.length > 0 && (
                <div className="space-y-1">
                  <h3 className="font-medium">Odd times (check the calendar)</h3>
                  <SmallList items={plan.odd} />
                </div>
              )}

              {plan.kept.length > 0 && (
                <div className="space-y-1">
                  <h3 className="font-medium">Kept on the schedule</h3>
                  <SmallList items={plan.kept} />
                </div>
              )}

              {plan.skipped.length > 0 && (
                <details>
                  <summary className="min-h-11 cursor-pointer py-2 font-medium">Calendar lines skipped as not a movie ({plan.skipped.length})</summary>
                  <SmallList items={plan.skipped} />
                </details>
              )}
            </section>
          )}

          <section className="card space-y-4">
            <h2 className="text-lg font-semibold">By day</h2>
            {nothing && <p className="text-sm">The schedule already matches the calendar.</p>}
            {dayList.map(([date, items]) => (
              <div key={date}>
                <h3 className="mb-1 font-medium">{dayHead(date)}</h3>
                <ul className="space-y-1">
                  {items
                    .sort((a, b) => Date.parse(a.l.startsAt) - Date.parse(b.l.startsAt))
                    .map(({ kind, l }, i) => (
                      <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${KIND[kind].cls}`}>{KIND[kind].label}</span>
                        <span className="font-medium">{l.clock}</span>
                        <span>
                          {l.title}
                          {where(l)}
                        </span>
                        {l.detail && <span className="text-[var(--muted)]">{l.detail}</span>}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </section>

          {!nothing && (
            <section className="card space-y-3">
              {bigRemoval && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1 h-5 w-5" checked={sure} onChange={(e) => setSure(e.target.checked)} />
                  <span>
                    This removes {plural(plan.remove.length, "showing")}. Yes, this is the newest calendar.
                  </span>
                </label>
              )}
              <button type="button" className="btn-primary min-h-11 w-full text-base sm:w-auto" disabled={!!busy || (bigRemoval && !sure)} onClick={apply}>
                {busy === "apply" ? "Applying…" : `Apply: ${plan.add.length} add, ${plan.change.length} change, ${plan.remove.length} remove`}
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
