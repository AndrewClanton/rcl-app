import Link from "next/link";
import { formatHours } from "@/lib/hours";
import type { TimesheetPerson, TimesheetShift } from "@/lib/data/team";
import ShiftTimesEditor from "./ShiftTimesEditor";

// Team → Timesheets, laid out: forgotten clock-outs, totals for payroll, and
// each person's week with the fix-it controls. The page loads the data.

const TZ = "America/Chicago";
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const stamp = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ });

// Everyone who clocked in on an earlier day and never clocked out, from any
// week: their hours count as 0 until someone sets the clock-out here.
export function ForgottenList({ forgotten }: { forgotten: (TimesheetShift & { name: string })[] }) {
  if (!forgotten.length) return null;
  return (
    <section className="notice notice-warn">
      <h2 className="mb-1 text-sm font-bold">{forgotten.length === 1 ? "1 shift was never clocked out" : `${forgotten.length} shifts were never clocked out`}</h2>
      <p className="mb-2 text-xs">Those count as 0 hours until you set when they left. The register also still shows them as on shift.</p>
      <ul className="divide-y divide-[var(--warn-border)]">
        {forgotten.map((s) => (
          <li key={s.shiftId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
            <span className="min-w-0 flex-1">
              <strong>{s.name}</strong> · {dayLabel(s.date)}, clocked in {s.clockedIn ? clock(s.clockedIn) : "?"}
              {s.scheduled && <span className="text-[var(--muted)]"> · scheduled {s.scheduled}</span>}
            </span>
            {s.shiftId && s.clockedIn && (
              <ShiftTimesEditor
                shiftId={s.shiftId}
                name={s.name}
                day={dayLabel(s.date)}
                clockedIn={s.clockedIn}
                clockedOut={null}
                forgotten
                stillOn={false}
                suggestedOut={s.suggestedOut}
                suggestedFrom={s.suggestedFrom}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// Everyone's hours side by side, for payroll: one week, or a pay period's two.
export function Totals({ people, weeks }: { people: TimesheetPerson[][]; weeks: { label: string; href?: string }[] }) {
  const byId = new Map<string, { id: string; name: string; hours: number[]; overtime: number }>();
  people.forEach((week, i) =>
    week.forEach((p) => {
      const row = byId.get(p.employeeId) ?? { id: p.employeeId, name: p.name, hours: weeks.map(() => 0), overtime: 0 };
      row.hours[i] = p.hours;
      row.overtime += Math.max(0, p.hours - 40);
      byId.set(p.employeeId, row);
    }),
  );
  const rows = [...byId.values()].filter((r) => r.hours.some((h) => h > 0)).sort((a, b) => a.name.localeCompare(b.name));
  if (!rows.length) return null;
  const col = (i: number) => rows.reduce((n, r) => n + r.hours[i], 0);
  const overtime = rows.reduce((n, r) => n + r.overtime, 0);
  const multi = weeks.length > 1;
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="mb-2 text-sm font-semibold">Totals</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-[var(--muted)]">
              <th className="pb-1 font-medium">Person</th>
              {multi &&
                weeks.map((w) => (
                  <th key={w.label} className="pb-1 pl-3 text-right font-medium">
                    {w.href ? (
                      <Link href={w.href} className="underline-offset-2 hover:underline">
                        {w.label}
                      </Link>
                    ) : (
                      w.label
                    )}
                  </th>
                ))}
              <th className="pb-1 pl-3 text-right font-medium">Hours</th>
              <th className="pb-1 pl-3 text-right font-medium">Overtime</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border)]">
                <td className="py-1">{r.name}</td>
                {multi &&
                  r.hours.map((h, i) => (
                    <td key={i} className="py-1 pl-3 text-right">
                      {h.toFixed(2)}
                    </td>
                  ))}
                <td className="py-1 pl-3 text-right font-semibold">{r.hours.reduce((n, h) => n + h, 0).toFixed(2)}</td>
                <td className={`py-1 pl-3 text-right ${r.overtime > 0 ? "font-bold text-[var(--danger-text)]" : "text-[var(--muted)]"}`}>{r.overtime > 0 ? r.overtime.toFixed(2) : "—"}</td>
              </tr>
            ))}
            {rows.length > 1 && (
              <tr className="border-t-2 border-[var(--border)] font-semibold">
                <td className="py-1">Everyone</td>
                {multi &&
                  weeks.map((w, i) => (
                    <td key={w.label} className="py-1 pl-3 text-right">
                      {col(i).toFixed(2)}
                    </td>
                  ))}
                <td className="py-1 pl-3 text-right">{weeks.reduce((n, _, i) => n + col(i), 0).toFixed(2)}</td>
                <td className="py-1 pl-3 text-right">{overtime > 0 ? overtime.toFixed(2) : "—"}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">Decimal hours from clock-ins that were clocked out. Overtime is the hours over 40 in each Monday-to-Monday week.</p>
    </section>
  );
}

function ShiftFlags({ s }: { s: TimesheetShift }) {
  return (
    <>
      {s.missed && <span className="font-bold text-[var(--danger-text)]">Didn&apos;t clock in</span>}
      {s.forgotten && <span className="font-bold text-[var(--danger-text)]">Never clocked out</span>}
      {s.long && <span className="font-bold text-[var(--danger-text)]">Over 16 h: check the clock-out</span>}
      {s.lateMinutes !== null && <span className="font-bold text-[var(--danger-text)]">{s.lateMinutes} min late</span>}
      {s.earlyMinutes !== null && <span className="text-[var(--muted)]">left {s.earlyMinutes} min early</span>}
      {s.edited && (
        <span className="text-[var(--muted)]" title={`Edited by ${s.edited.byName ?? "a manager"}, ${stamp(s.edited.at)}`}>
          <span className="rounded border border-[var(--border)] px-1 font-semibold">Edited</span> {s.edited.byName ?? "a manager"}
          {s.edited.note ? `: ${s.edited.note}` : ""}
        </span>
      )}
    </>
  );
}

export function WeekTimesheet({ people }: { people: TimesheetPerson[] }) {
  if (!people.length) return <p className="text-sm text-[var(--muted)]">Nobody clocked in or was scheduled this week.</p>;
  return (
    <div className="space-y-4">
      {people.length > 1 && <Totals people={[people]} weeks={[{ label: "This week" }]} />}
      {people.map((p) => (
        <section key={p.employeeId} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-base font-semibold">{p.name}</h2>
            <span className="text-sm tabular-nums">
              <strong>{p.hours.toFixed(2)} h</strong> worked
              {p.scheduledHours > 0 && <span className="text-[var(--muted)]"> of {p.scheduledHours.toFixed(1)} scheduled</span>}
            </span>
            {p.lateCount > 0 && <span className="text-sm font-medium text-[var(--danger-text)]">{p.lateCount} late</span>}
            {p.missedCount > 0 && <span className="text-sm font-medium text-[var(--danger-text)]">{p.missedCount} missed</span>}
            {p.forgottenCount > 0 && <span className="text-sm font-medium text-[var(--danger-text)]">{p.forgottenCount} never clocked out</span>}
            {p.runningHours > 0 && <span className="text-sm text-[var(--muted)]">+ {formatHours(p.runningHours)} on now</span>}
            {p.overtime && <span className="rounded bg-[var(--gold)] px-1.5 text-sm font-bold text-[var(--gold-foreground)]">Over 40 h: overtime</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-[var(--muted)]">
                  <th className="pb-1 font-medium">Day</th>
                  <th className="pb-1 font-medium">Scheduled</th>
                  <th className="pb-1 font-medium">In</th>
                  <th className="pb-1 font-medium">Out</th>
                  <th className="pb-1 text-right font-medium">Hours</th>
                  <th className="pb-1 font-medium">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {p.shifts.map((s, i) => (
                  <tr key={s.shiftId ?? `s${i}`} className="border-t border-[var(--border)] align-top">
                    {/* The fix-it control sits under the day, so a phone doesn't have to scroll the table for it. */}
                    <td className="py-1">
                      <div className="whitespace-nowrap">{dayLabel(s.date)}</div>
                      {s.shiftId && s.clockedIn && (
                        <div className="mb-1 mt-0.5">
                          <ShiftTimesEditor
                            shiftId={s.shiftId}
                            name={p.name}
                            day={dayLabel(s.date)}
                            clockedIn={s.clockedIn}
                            clockedOut={s.clockedOut}
                            forgotten={s.forgotten}
                            stillOn={s.runningHours !== null}
                            suggestedOut={s.suggestedOut}
                            suggestedFrom={s.suggestedFrom}
                          />
                        </div>
                      )}
                    </td>
                    <td className="py-1 text-[var(--muted)]">{s.scheduled ?? "—"}</td>
                    <td className="py-1">{s.clockedIn ? clock(s.clockedIn) : "—"}</td>
                    <td className="py-1">
                      {s.clockedOut ? clock(s.clockedOut) : s.forgotten ? <span className="font-bold text-[var(--danger-text)]">never</span> : s.clockedIn ? <span className="text-[var(--muted)]">still on</span> : "—"}
                    </td>
                    <td className="py-1 text-right">{s.hours !== null ? s.hours.toFixed(2) : s.runningHours !== null ? <span className="text-[var(--muted)]">{s.runningHours.toFixed(2)} so far</span> : ""}</td>
                    <td className="py-1 pl-3 text-xs">
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                        <ShiftFlags s={s} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="text-xs text-[var(--muted)]">
        Hours come from Start shift and End shift on the register. A clock-in within 4 hours of a scheduled start counts as that shift; 5 or more minutes after the
        start is marked late. A shift that was never clocked out counts as 0 hours until its clock-out is set. Every change to a clock-in or clock-out needs a reason
        and is kept with the shift.
      </p>
    </div>
  );
}
