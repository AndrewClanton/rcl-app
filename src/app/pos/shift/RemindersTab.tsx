"use client";

import { useEffect, useState } from "react";
import { useOpsApi } from "./api";
import { DAY_LETTERS, daysLabel, type OnShift, type ReminderKind, type ReminderRow } from "@/lib/ops/shared";

const KIND_LABEL: Record<ReminderKind, string> = {
  before_screening: "Before each screening",
  daily: "At a time of day",
  schedule_low: "When the schedule runs low",
};

function describe(r: ReminderRow) {
  if (r.kind === "before_screening") return `${r.minutes} min before every screening`;
  if (r.kind === "schedule_low") return `When fewer than ${r.minutes} days of screenings are scheduled`;
  const [h, m] = (r.time_of_day ?? "00:00").split(":").map(Number);
  return `${new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · ${daysLabel(r.days)}`;
}

export default function RemindersTab({ me, staff, onChanged }: { me: OnShift | null; staff: { id: string; name: string }[]; onChanged: () => void }) {
  const api = useOpsApi();
  const [rows, setRows] = useState<ReminderRow[] | null>(null);
  const [form, setForm] = useState<Partial<ReminderRow> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.getTaskRows()
      .then((d) => alive && setRows(d.reminders))
      .catch(() => alive && setError("Couldn't load reminders. Check the connection."));
    return () => {
      alive = false;
    };
  }, [api]);
  const reload = async () => {
    const d = await api.getTaskRows().catch(() => null);
    if (d) setRows(d.reminders);
    onChanged();
  };
  const nameOf = (id: string | null) => staff.find((s) => s.id === id)?.name ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">Reminders</h2>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            They pop up in a bar above the register until someone taps Done.
          </p>
        </div>
        <button className="btn-primary !px-4 !py-2 text-sm" onClick={() => setForm({ kind: "before_screening", minutes: 5, message: "", assignee_id: null })}>
          Add a reminder
        </button>
      </div>
      {error && <p className="text-sm" style={{ color: "var(--danger-text)" }}>{error}</p>}
      {form && (
        <ReminderForm
          initial={form}
          staff={staff}
          onCancel={() => setForm(null)}
          onSave={async (v) => {
            const r = await api.saveReminder(v, me?.employeeId ?? null).catch(() => null);
            if (!r || !r.ok) return r && !r.ok ? r.error : "Couldn't save. Check the connection.";
            setForm(null);
            reload();
            return null;
          }}
        />
      )}
      {!rows ? (
        <p style={{ color: "var(--muted)" }}>Loading…</p>
      ) : (
        <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          {rows.length === 0 && <p className="px-4 py-3 text-sm" style={{ color: "var(--muted)" }}>No reminders yet.</p>}
          {rows.map((r, i) => (
            <div key={r.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${i ? "border-t" : ""} ${r.active ? "" : "opacity-50"}`} style={{ borderColor: "var(--border)" }}>
              <div className="min-w-0 flex-1">
                <div className="font-bold">
                  {nameOf(r.assignee_id) ? `${nameOf(r.assignee_id)}: ` : ""}
                  {r.message}
                </div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {describe(r)}
                  {!r.active && " · off"}
                </div>
              </div>
              {r.active && (
                <button className="chip !px-3 !py-1.5" onClick={() => setForm(r)}>
                  Edit
                </button>
              )}
              <button
                className="chip !px-3 !py-1.5"
                onClick={async () => {
                  await api.setReminderActive(r.id, !r.active, me?.employeeId ?? null).catch(() => null);
                  reload();
                }}
              >
                {r.active ? "Turn off" : "Turn on"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReminderForm({
  initial,
  staff,
  onSave,
  onCancel,
}: {
  initial: Partial<ReminderRow>;
  staff: { id: string; name: string }[];
  onSave: (v: { id?: string; kind: ReminderKind; message: string; minutes: number | null; time_of_day: string | null; days: number[] | null; assignee_id: string | null }) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<ReminderKind>(initial.kind ?? "before_screening");
  const [message, setMessage] = useState(initial.message ?? "");
  const [minutes, setMinutes] = useState(String(initial.minutes ?? (initial.kind === "schedule_low" ? 7 : 5)));
  const [time, setTime] = useState((initial.time_of_day ?? "15:00").slice(0, 5));
  const [days, setDays] = useState<number[]>(initial.days ?? []);
  const [assignee, setAssignee] = useState(initial.assignee_id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="card space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const err = await onSave({
          id: initial.id,
          kind,
          message,
          minutes: kind === "daily" ? null : Number(minutes),
          time_of_day: kind === "daily" ? time : null,
          days: kind === "daily" && days.length ? days : null,
          assignee_id: assignee || null,
        });
        setBusy(false);
        setError(err);
      }}
    >
      <div>
        <div className="label-xs">When it pops up</div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(KIND_LABEL) as ReminderKind[]).map((k) => (
            <button
              type="button"
              key={k}
              className={`chip !px-4 !py-2 !text-sm ${kind === k ? "chip-selected" : ""}`}
              onClick={() => {
                setKind(k);
                if (k === "schedule_low" && !initial.id) setMinutes("7");
                if (k === "before_screening" && !initial.id) setMinutes("5");
              }}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <div className="label-xs">Reminder</div>
        <input
          id="reminder-message"
          className="input !py-3 !text-base"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={kind === "before_screening" ? "e.g. Check the movie" : kind === "daily" ? "e.g. Thaw tomorrow's dough" : "e.g. Update the schedule"}
          autoFocus
        />
      </label>
      {kind === "before_screening" && (
        <label className="block">
          <div className="label-xs">Minutes before showtime</div>
          <input id="reminder-minutes" className="input w-32" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </label>
      )}
      {kind === "schedule_low" && (
        <label className="block">
          <div className="label-xs">Remind when fewer than this many days are scheduled</div>
          <input id="reminder-days-ahead" className="input w-32" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </label>
      )}
      {kind === "daily" && (
        <>
          <label className="block">
            <div className="label-xs">Time</div>
            <input id="reminder-time" type="time" className="input w-40" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <div>
            <div className="label-xs">Days (none picked = every day)</div>
            <div className="flex flex-wrap gap-1.5">
              {DAY_LETTERS.map((d, i) => (
                <button
                  type="button"
                  key={i}
                  className={`chip h-10 w-10 !p-0 !text-sm ${days.includes(i) ? "chip-selected" : ""}`}
                  onClick={() => setDays((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))}
                  aria-pressed={days.includes(i)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <label className="block">
        <div className="label-xs">For</div>
        <select id="reminder-assignee" className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Whoever&apos;s on shift</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-sm" style={{ color: "var(--danger-text)" }}>{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !message.trim()}>
          {busy ? "Saving…" : initial.id ? "Save reminder" : "Add reminder"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
