"use client";

import { useEffect, useState } from "react";
import { useOpsApi } from "./api";
import { DAY_LETTERS, TIMING_LABEL, daysLabel, type OnShift, type ShiftStatus, type TaskRow, type Timing } from "@/lib/ops/shared";

const ORDER: Timing[] = ["opening", "anytime", "closing"];
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

export default function ChecklistTab({
  status,
  me,
  staff,
  onChanged,
}: {
  status: ShiftStatus | null;
  me: OnShift | null;
  staff: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const api = useOpsApi();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  if (editing) return <EditTasks me={me} staff={staff} onDone={() => { setEditing(false); onChanged(); }} />;
  if (!status) return <p style={{ color: "var(--muted)" }}>Loading…</p>;

  const done = status.tasks.filter((t) => t.done).length;

  async function toggle(id: string, isDone: boolean) {
    setBusy(id);
    setError(null);
    const r = await api.setTaskDone(id, !isDone, me?.employeeId ?? null, me?.shiftId ?? null).catch(() => null);
    setBusy(null);
    if (!r || !r.ok) setError(r && !r.ok ? r.error : "Couldn't save that. Check the connection.");
    onChanged();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">Today&apos;s checklist</h2>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {done} of {status.tasks.length} done{me ? ` · ticking off as ${me.name}` : " · start a shift so ticks show who did them"}
          </p>
        </div>
        <button className="btn-secondary !px-4 !py-2 text-sm" onClick={() => setEditing(true)}>
          Edit tasks
        </button>
      </div>
      {error && <p className="text-sm" style={{ color: "var(--danger-text)" }}>{error}</p>}
      {status.tasks.length === 0 && <p style={{ color: "var(--muted)" }}>No tasks for today. Add some with Edit tasks.</p>}

      {ORDER.map((timing) => {
        const list = status.tasks.filter((t) => t.timing === timing);
        if (list.length === 0) return null;
        return (
          <section key={timing}>
            <div className="eyebrow mb-2">{TIMING_LABEL[timing]}</div>
            <div className="grid gap-2">
              {list.map((t) => (
                <button
                  key={t.id}
                  disabled={busy === t.id}
                  onClick={() => toggle(t.id, !!t.done)}
                  className="flex w-full items-center gap-4 rounded-xl border-2 px-4 py-4 text-left transition-colors"
                  style={{ borderColor: t.done ? "var(--success-border)" : "var(--border)", background: t.done ? "var(--success-bg)" : "var(--surface)" }}
                  aria-pressed={!!t.done}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 text-lg font-bold"
                    style={{ borderColor: t.done ? "var(--success-text)" : "var(--foreground)", background: t.done ? "var(--success-text)" : "transparent", color: "#fff" }}
                    aria-hidden="true"
                  >
                    {t.done ? "✓" : ""}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-base font-bold ${t.done ? "line-through opacity-70" : ""}`}>{t.title}</span>
                    {t.details && <span className="block text-sm" style={{ color: "var(--muted)" }}>{t.details}</span>}
                  </span>
                  {t.assigneeName && !t.done && <span className="chip shrink-0">{t.assigneeName}</span>}
                  {t.done && (
                    <span className="shrink-0 text-sm" style={{ color: "var(--success-text)" }}>
                      {t.done.byName ?? "Done"} · {time(t.done.at)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </section>
        );
      })}
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Tap a ticked task again to undo it. The day rolls over at 4 a.m., so late closes count toward tonight.
      </p>
    </div>
  );
}

// ---------- editing ----------

function EditTasks({ me, staff, onDone }: { me: OnShift | null; staff: { id: string; name: string }[]; onDone: () => void }) {
  const api = useOpsApi();
  const [rows, setRows] = useState<TaskRow[] | null>(null);
  const [form, setForm] = useState<Partial<TaskRow> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.getTaskRows()
      .then((d) => alive && setRows(d.tasks))
      .catch(() => alive && setError("Couldn't load the tasks."));
    return () => {
      alive = false;
    };
  }, [api]);
  const reload = () => api.getTaskRows().then((d) => setRows(d.tasks));
  const nameOf = (id: string | null) => staff.find((s) => s.id === id)?.name ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl">Edit tasks</h2>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Changes save right away and are logged{me ? ` as ${me.name}` : ""}. Removed tasks can be put back.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary !px-4 !py-2 text-sm" onClick={() => setForm({ timing: "closing", days: null, assignee_id: null, title: "" })}>
            Add a task
          </button>
          <button className="btn-secondary !px-4 !py-2 text-sm" onClick={onDone}>
            Done editing
          </button>
        </div>
      </div>
      {error && <p className="text-sm" style={{ color: "var(--danger-text)" }}>{error}</p>}
      {form && (
        <TaskForm
          initial={form}
          staff={staff}
          onCancel={() => setForm(null)}
          onSave={async (v) => {
            const r = await api.saveTask(v, me?.employeeId ?? null).catch(() => null);
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
          {rows.map((t, i) => (
            <div key={t.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${i ? "border-t" : ""} ${t.active ? "" : "opacity-50"}`} style={{ borderColor: "var(--border)" }}>
              <div className="min-w-0 flex-1">
                <div className="font-bold">{t.title}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>
                  {TIMING_LABEL[t.timing]} · {daysLabel(t.days)} · {nameOf(t.assignee_id) ?? "Whoever's on shift"}
                  {!t.active && " · removed"}
                </div>
              </div>
              {t.active && (
                <button className="chip !px-3 !py-1.5" onClick={() => setForm(t)}>
                  Edit
                </button>
              )}
              <button
                className="chip !px-3 !py-1.5"
                onClick={async () => {
                  await api.setTaskActive(t.id, !t.active, me?.employeeId ?? null).catch(() => null);
                  reload();
                }}
              >
                {t.active ? "Remove" : "Put back"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskForm({
  initial,
  staff,
  onSave,
  onCancel,
}: {
  initial: Partial<TaskRow>;
  staff: { id: string; name: string }[];
  onSave: (v: { id?: string; title: string; details: string | null; timing: Timing; days: number[] | null; assignee_id: string | null }) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title ?? "");
  const [details, setDetails] = useState(initial.details ?? "");
  const [timing, setTiming] = useState<Timing>(initial.timing ?? "closing");
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
        const err = await onSave({ id: initial.id, title, details: details || null, timing, days: days.length ? days : null, assignee_id: assignee || null });
        setBusy(false);
        setError(err);
      }}
    >
      <label className="block">
        <div className="label-xs">Task</div>
        <input id="task-title" className="input !py-3 !text-base" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Thaw pizza dough" autoFocus />
      </label>
      <label className="block">
        <div className="label-xs">Details (optional)</div>
        <input id="task-details" className="input" value={details} onChange={(e) => setDetails(e.target.value)} placeholder="e.g. 2 bags from the freezer to the walk-in" />
      </label>
      <div>
        <div className="label-xs">When</div>
        <div className="flex flex-wrap gap-2">
          {(["opening", "anytime", "closing"] as Timing[]).map((t) => (
            <button type="button" key={t} className={`chip !px-4 !py-2 !text-sm ${timing === t ? "chip-selected" : ""}`} onClick={() => setTiming(t)}>
              {TIMING_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
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
      <label className="block">
        <div className="label-xs">Who</div>
        <select id="task-assignee" className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
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
        <button className="btn-primary" disabled={busy || !title.trim()}>
          {busy ? "Saving…" : initial.id ? "Save task" : "Add task"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
