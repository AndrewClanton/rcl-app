"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { outNoticeText, type OnShift, type ScheduleDay, type ScheduledShiftToday, type ShiftStatus, type ShiftTodo, type ShiftTraining } from "@/lib/ops/shared";
import { useOpsApi } from "./api";
import type { OpsTab } from "./OpsPanel";
import type { StaffView } from "./staff-store";
import { CountBadge } from "./ui";
import MyHours from "./MyHours";
import InfoTip from "@/components/help/InfoTip";
import { SeatOrderingSwitch } from "../SeatOrders";

// The Staff sheet: everything about working a shift, behind the register's
// one Staff button (StaffButton.tsx), so none of it takes room from the
// order or the menu. Grouped by what people are doing: who's on (start and
// end a shift); the tools for during the shift (Ran out, the checklist,
// the schedule, hours); what needs a look (to-dos, training, what's out,
// anyone who hasn't started); the par sheet and shopping list for stock;
// history and reminders. Ran out is always two taps away and in view:
// Staff, then Ran out.

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
const dueLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export default function StaffSheet({
  view,
  status,
  me,
  manager,
  todos,
  training,
  tasksLeft,
  sched,
  error,
  feedback,
  onView,
  onClose,
  onPickMe,
  onStart,
  onEnd,
  onRanOut,
  onPanel,
  onTodoDone,
  onTraining,
}: {
  view: StaffView;
  status: ShiftStatus | null;
  me: OnShift | null;
  manager: boolean;
  todos: ShiftTodo[];
  training: ShiftTraining[];
  tasksLeft: number;
  sched: { upcoming: ScheduledShiftToday[]; late: ScheduledShiftToday[] };
  error: string | null;
  feedback: ReactNode;
  onView: (v: StaffView) => void;
  onClose: () => void;
  onPickMe: (shiftId: string) => void;
  onStart: () => void;
  onEnd: () => void;
  onRanOut: () => void;
  onPanel: (tab: OpsTab) => void;
  onTodoDone: (t: ShiftTodo) => void;
  onTraining: (t: ShiftTraining) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onShift = status?.onShift ?? [];
  const outNotices = status?.outNotices ?? [];
  const scheduleCount = sched.upcoming.length + sched.late.length;
  const needs = todos.length + training.length + outNotices.length + sched.late.length;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label="Staff" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col shadow-2xl"
        style={{ background: "var(--background)", borderLeft: "2px solid var(--foreground)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b-2 px-4 py-3" style={{ borderColor: "var(--foreground)", background: "var(--surface)" }}>
          {view === "schedule" ? (
            <>
              <button className="min-h-11 pr-1 text-sm font-bold underline-offset-2 hover:underline" onClick={() => onView("home")}>
                ← Staff
              </button>
              <h2 className="flex items-center font-display text-xl">
                Schedule
                <InfoTip topic="staff-schedule" />
              </h2>
            </>
          ) : (
            <h2 className="flex items-center font-display text-xl">
              Staff
              <InfoTip topic="staff-button" />
            </h2>
          )}
          <button className="btn-secondary ml-auto min-h-11 !px-4 !py-2" onClick={onClose}>
            Back to register
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-4">
          {error && (
            <p className="notice notice-warn !p-3 text-sm" role="alert">
              {error}
            </p>
          )}

          {view === "schedule" ? (
            <ScheduleView status={status} manager={manager} />
          ) : (
            <>
              <section aria-label="On shift">
                <div className="eyebrow mb-2">On shift</div>
                {onShift.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    Nobody yet.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {onShift.map((o) => (
                      <button
                        key={o.shiftId}
                        className={`chip min-h-11 whitespace-nowrap !px-3 !py-1.5 !text-sm ${o.shiftId === me?.shiftId ? "chip-selected font-bold" : ""}`}
                        onClick={() => onPickMe(o.shiftId)}
                        aria-pressed={o.shiftId === me?.shiftId}
                      >
                        {o.name} <span style={{ color: "var(--muted)" }}>· {time(o.startedAt)}</span>
                        {o.shiftId === me?.shiftId && <span className="ml-1 text-xs">(you)</span>}
                      </button>
                    ))}
                  </div>
                )}
                {onShift.length > 1 && (
                  <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
                    Using this iPad? Tap your name.
                  </p>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="btn-secondary min-h-12 !px-3" onClick={onStart}>
                    Start a shift
                  </button>
                  {me && (
                    <button className="btn-primary min-h-12 !px-3" onClick={onEnd}>
                      End {me.name}&apos;s shift
                    </button>
                  )}
                </div>
              </section>

              {/* The tools people reach for mid-shift come first, so Ran out
                  is always in view: Staff, then Ran out. */}
              <section aria-label="During the shift">
                <div className="eyebrow mb-2">During the shift</div>
                <div className="grid grid-cols-2 gap-2">
                  <Tile title="Ran out" sub="Something ran out" accent onClick={onRanOut} />
                  <Tile title="Checklist" sub={tasksLeft > 0 ? `${tasksLeft} left` : "All done"} badge={tasksLeft} onClick={() => onPanel("checklist")} />
                  <Tile
                    title="Schedule"
                    sub={sched.late.length ? `${sched.late.length} not started` : sched.upcoming.length ? `${sched.upcoming.length} still coming in` : "Today and this week"}
                    badge={scheduleCount}
                    onClick={() => onView("schedule")}
                  />
                  {me ? <MyHours shiftId={me.shiftId} name={me.name} /> : <Tile title="My hours" sub="Start your shift first" disabled />}
                </div>
              </section>

              {(needs > 0 || feedback) && (
                <section aria-label="Needs a look">
                  <div className="eyebrow mb-2 flex items-center gap-2">
                    Needs a look <CountBadge n={needs} />
                  </div>
                  <div className="grid gap-2">
                    {feedback}
                    {sched.late.map((s) => (
                      <Row key={`late:${s.employeeId}:${s.startsAt}`} tag="Schedule" tone="warn">
                        <div className="min-w-0 flex-1">
                          <div className="font-bold">{s.name} hasn&apos;t started</div>
                          <div className="text-sm opacity-80">Due at {time(s.startsAt)}. Running late, or forgot Start shift?</div>
                        </div>
                        <button className="min-h-11 rounded-lg border-2 px-3 text-sm font-bold" style={{ borderColor: "currentColor" }} onClick={onStart}>
                          Start shift
                        </button>
                      </Row>
                    ))}
                    {todos.map((t) => {
                      const overdue = !!t.dueDate && !!status && t.dueDate < status.workDate;
                      const dueToday = !!t.dueDate && !!status && t.dueDate === status.workDate;
                      return (
                        <Row key={t.id} tag={t.forManagers ? "Managers" : "To-do"} tone={overdue ? "warn" : "plain"}>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold">
                              {t.assigneeName ? `${t.assigneeName}: ` : ""}
                              {t.title}
                            </div>
                            <div className="text-sm opacity-80">
                              {[t.fromName && `From ${t.fromName}`, overdue ? "Overdue" : dueToday ? "Due today" : t.dueDate && `Due ${dueLabel(t.dueDate)}`, t.details].filter(Boolean).join(" · ")}
                            </div>
                          </div>
                          <button className="min-h-11 rounded-lg border-2 px-4 text-sm font-bold" style={{ borderColor: "currentColor" }} onClick={() => onTodoDone(t)}>
                            Done
                          </button>
                        </Row>
                      );
                    })}
                    {training.map((t) => (
                      <Row key={`${t.employeeId}:${t.slug}`} tag="Training" tone={t.overdue ? "warn" : "plain"}>
                        <div className="min-w-0 flex-1">
                          <div className="font-bold">
                            {t.name}: {t.title}
                          </div>
                          <div className="text-sm opacity-80">
                            {[t.updated && "Updated, sign again", t.overdue ? "Overdue" : t.dueDate && `Due ${dueLabel(t.dueDate)}`, "Open it when things are slow"].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <button className="min-h-11 rounded-lg border-2 px-4 text-sm font-bold" style={{ borderColor: "currentColor" }} onClick={() => onTraining(t)}>
                          Open
                        </button>
                      </Row>
                    ))}
                    {/* Information, not a job: the buyers were emailed, and
                        marking it back in stock in Back office clears it. */}
                    {outNotices.map((n) => (
                      <Row key={n.id} tag="Out" tone="plain">
                        <div className="min-w-0 flex-1 text-sm">{outNoticeText(n)}</div>
                      </Row>
                    ))}
                  </div>
                </section>
              )}

              <SeatOrderingSwitch />

              <section aria-label="Stock">
                <div className="eyebrow mb-2">Stock</div>
                <div className="grid grid-cols-2 gap-2">
                  <Tile
                    title="Par sheet"
                    sub={status?.lastCount ? `Last count: ${[status.lastCount.byName, status.lastCount.today ? "today" : "before today"].filter(Boolean).join(", ")}` : "Count the shelves"}
                    onClick={() => onPanel("par")}
                  />
                  <Tile
                    title="Shopping list"
                    sub={
                      <>
                        {status?.lastCount ? `${status.lastCount.below} under par` : "From the last count"}
                        {manager && !!status?.ranOut && <span style={{ color: "var(--accent)" }}> · {status.ranOut} out</span>}
                      </>
                    }
                    accent={manager && !!status?.ranOut}
                    onClick={() => onPanel("shopping")}
                  />
                </div>
              </section>

              <section aria-label="More">
                <div className="eyebrow mb-2">More</div>
                <div className="grid grid-cols-2 gap-2">
                  <Tile title="History" sub="The last 7 days" onClick={() => onPanel("history")} />
                  <Tile title="Reminders" sub="Set them up" onClick={() => onPanel("reminders")} />
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// One line under "Needs a look": a tag, what it is, and its button.
function Row({ tag, tone, children }: { tag: string; tone: "plain" | "warn"; children: ReactNode }) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border-2 px-3 py-2.5"
      style={tone === "warn" ? { background: "var(--warn-bg)", borderColor: "var(--warn-border)", color: "var(--warn-text)" } : { background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <span className="w-full text-[11px] font-black uppercase tracking-wide opacity-70">{tag}</span>
      {children}
    </div>
  );
}

export function Tile({
  title,
  sub,
  badge = 0,
  accent = false,
  disabled = false,
  onClick,
}: {
  title: string;
  sub: ReactNode;
  badge?: number;
  accent?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className="relative flex min-h-16 flex-col items-start justify-center rounded-lg border-2 px-3 py-2 text-left transition-colors disabled:opacity-50"
      style={{ borderColor: accent ? "var(--accent)" : "var(--foreground)", background: "var(--surface)" }}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="font-bold" style={accent ? { color: "var(--accent)" } : undefined}>
        {title}
      </span>
      <span className="text-xs" style={{ color: "var(--muted)" }}>
        {sub}
      </span>
      <CountBadge n={badge} className="absolute -right-1.5 -top-1.5" />
    </button>
  );
}

// Who's working today (and whether they've started), then the coming days,
// from the staff schedule a manager keeps in Back office → Team.
function ScheduleView({ status, manager }: { status: ShiftStatus | null; manager: boolean }) {
  const api = useOpsApi();
  const [days, setDays] = useState<ScheduleDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    api
      .getRegisterSchedule(7)
      .then((r) => {
        if (!live) return;
        if (r.ok) setDays(r.days);
        else setError(r.error);
      })
      .catch(() => live && setError("Couldn't load the schedule. Check the connection."));
    return () => {
      live = false;
    };
  }, [api]);

  const today = status?.schedule ?? [];
  const onShift = status?.onShift ?? [];
  return (
    <>
      <section aria-label="Today">
        <div className="eyebrow mb-2">Today</div>
        {today.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Nobody&apos;s on today&apos;s schedule.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border-2" style={{ borderColor: "var(--foreground)", background: "var(--surface)" }}>
            {today.map((s) => {
              const on = onShift.find((o) => o.employeeId === s.employeeId);
              const start = new Date(s.startsAt).getTime();
              const end = new Date(s.endsAt).getTime();
              const [label, color] = on
                ? [`On since ${time(on.startedAt)}`, "var(--success-text)"]
                : end <= now
                  ? ["Shift's over", "var(--muted)"]
                  : start <= now
                    ? ["Not started yet", "var(--warn-text)"]
                    : [`Due at ${time(s.startsAt)}`, "var(--muted)"];
              return (
                <li key={`${s.employeeId}:${s.startsAt}`} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2.5" style={{ borderColor: "var(--border)" }}>
                  <span className="w-20 shrink-0 font-bold">{s.name}</span>
                  <span className="flex-1 text-sm tabular-nums">
                    {time(s.startsAt)}–{time(s.endsAt)}
                  </span>
                  <span className="text-sm font-semibold" style={{ color }}>
                    {label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="Coming up">
        <div className="eyebrow mb-2">Coming up</div>
        {error ? (
          <p className="text-sm" style={{ color: "var(--danger-text)" }}>
            {error}
          </p>
        ) : !days ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Loading the schedule…
          </p>
        ) : days.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Nothing scheduled for the next 7 days yet.
          </p>
        ) : (
          <div className="space-y-3">
            {days.map((d) => (
              <div key={d.date}>
                <div className="mb-1 text-sm font-bold">{d.label}</div>
                <ul className="divide-y rounded-lg border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                  {d.shifts.map((s, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2 text-sm" style={{ borderColor: "var(--border)" }}>
                      <span className="w-20 shrink-0 font-semibold">{s.name}</span>
                      <span className="tabular-nums">{s.time}</span>
                      {s.note && <span style={{ color: "var(--muted)" }}>{s.note}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {manager && (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          To change the schedule:{" "}
          <Link href="/admin/team" className="font-bold underline">
            Back office → Team
          </Link>
        </p>
      )}
    </>
  );
}
