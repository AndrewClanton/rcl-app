import Link from "next/link";
import { formatHours } from "@/lib/hours";
import type { TimesheetPerson, TimesheetShift } from "@/lib/data/team";

// My hours, laid out for a phone: this week and last week at the top, the
// last four weeks as bars, then each shift.

const TZ = "America/Chicago";
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const dayLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const plusDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const worked = (p: TimesheetPerson | null) => (p ? p.hours + p.runningHours : 0);

export default function MyHoursView({
  name,
  self,
  fromRegister,
  canFix,
  weeks,
  sheets,
  forgotten,
}: {
  name: string;
  self: boolean;
  fromRegister: boolean;
  canFix: boolean;
  weeks: string[]; // week starts, this week first
  sheets: (TimesheetPerson | null)[]; // same order
  forgotten: TimesheetShift[];
}) {
  const [now, last] = sheets;
  const you = self ? "You" : name.split(" ")[0];

  return (
    // A phone: one column. A computer: the totals and bars on the left,
    // each week's shifts on the right.
    <div className="mx-auto max-w-xl space-y-5 lg:max-w-5xl">
      {fromRegister && (
        <Link href="/pos" className="inline-flex min-h-11 items-center text-sm font-semibold hover:underline">
          ← Back to the register
        </Link>
      )}
      <div>
        <h1 className="text-lg font-semibold">{self ? "My hours" : `${name}'s hours`}</h1>
        <p className="text-sm text-[var(--muted)]">From Start shift and End shift on the register. Weeks run Monday 4 AM to Monday 4 AM.</p>
        {self && !fromRegister && (
          <Link href="/admin/me" className="inline-flex min-h-11 items-center text-sm font-semibold hover:underline">
            My account: the pay period, what&apos;s coming up, tasks and sales →
          </Link>
        )}
      </div>

      {forgotten.length > 0 && (
        <div className="notice notice-warn text-sm">
          <strong>
            {you} never clocked out on {forgotten.map((s) => dayLabel(s.date)).join(", ")}.
          </strong>{" "}
          {forgotten.length === 1 ? "That shift counts" : "Those shifts count"} as 0 hours until it&apos;s fixed. Ask a manager to set the clock-out.
          {canFix && (
            <>
              {" "}
              <Link href="/admin/team?view=timesheets" className="font-bold underline">
                Fix it on Timesheets
              </Link>
            </>
          )}
        </div>
      )}

      <div className="space-y-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 lg:space-y-0">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="eyebrow">This week</div>
              <div className="mt-1 text-3xl font-bold tabular-nums">{formatHours(worked(now))}</div>
              <div className="mt-1 space-y-0.5 text-xs text-[var(--muted)]">
                {now && now.runningHours > 0 && <div>Includes {formatHours(now.runningHours)} on the clock now</div>}
                {now && now.scheduledHours > 0 && <div>{formatHours(now.scheduledHours)} scheduled</div>}
                {worked(now) > 40 && <div className="font-bold text-[var(--danger-text)]">Over 40 h: overtime</div>}
              </div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="eyebrow">Last week</div>
              <div className="mt-1 text-3xl font-bold tabular-nums">{formatHours(worked(last))}</div>
              <div className="mt-1 text-xs text-[var(--muted)]">
                {shortDate(weeks[1])} – {shortDate(plusDays(weeks[1], 6))}
              </div>
            </div>
          </div>

          <WeekBars weeks={weeks.map((w, i) => ({ start: w, hours: worked(sheets[i]), current: i === 0 })).reverse()} />
        </div>

        <div className="space-y-5">
          <ShiftList title="This week" start={weeks[0]} person={now} you={you} />
          <ShiftList title="Last week" start={weeks[1]} person={last} you={you} />
        </div>
      </div>

      <p className="text-xs text-[var(--muted)]">
        Something wrong, like a clock-in you forgot? Tell a manager: they can fix the times on Team → Timesheets, and the fix shows here marked Edited.
      </p>
    </div>
  );
}

// The last four weeks as bars, oldest on the left. One series, so one color;
// the numbers sit on the bars since phones can't hover.
function WeekBars({ weeks }: { weeks: { start: string; hours: number; current: boolean }[] }) {
  const top = Math.max(10, ...weeks.map((w) => w.hours));
  const scale = top * 1.15;
  const showForty = top >= 30;
  const label = (w: { start: string; current: boolean }) => (w.current ? "This week" : `Week of ${shortDate(w.start)}`);
  return (
    <figure className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <figcaption className="mb-3 text-sm font-semibold">Last 4 weeks</figcaption>
      <div className="relative h-32" role="img" aria-label={weeks.map((w) => `${label(w)}: ${formatHours(w.hours)}`).join("; ")}>
        {showForty && (
          <div className="absolute inset-x-0 border-t border-dashed border-[var(--muted)]" style={{ bottom: `${(40 / scale) * 100}%` }} aria-hidden="true">
            <span className="absolute -top-4 right-0 text-[10px] text-[var(--muted)]">40 h</span>
          </div>
        )}
        <div className="absolute inset-0 grid grid-cols-4 items-end gap-2 border-b border-[var(--border)]">
          {weeks.map((w) => (
            <div key={w.start} className="flex h-full flex-col items-center justify-end" title={`${label(w)}: ${formatHours(w.hours)}`}>
              <span className="mb-1 whitespace-nowrap text-[11px] font-semibold tabular-nums">{formatHours(w.hours)}</span>
              <div className="w-full max-w-10 rounded-t bg-[var(--foreground)]" style={{ height: `${(w.hours / scale) * 100}%`, minHeight: w.hours > 0 ? 2 : 0 }} />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 grid grid-cols-4 gap-2 text-center text-[11px] text-[var(--muted)]">
        {weeks.map((w) => (
          <span key={w.start} className={w.current ? "font-bold text-[var(--foreground)]" : ""}>
            {w.current ? "This week" : shortDate(w.start)}
          </span>
        ))}
      </div>
    </figure>
  );
}

// Also on My account (../me), for the pay period's two weeks.
export function ShiftList({ title, start, person, you }: { title: string; start: string; person: TimesheetPerson | null; you: string }) {
  const shifts = person?.shifts ?? [];
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold">
        {title}{" "}
        <span className="font-normal text-[var(--muted)]">
          · {shortDate(start)} – {shortDate(plusDays(start, 6))}
        </span>
      </h2>
      {shifts.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted)]">No shifts.</p>
      ) : (
        <ul className="mt-1 divide-y divide-[var(--border)]">
          {shifts.map((s, i) => (
            <li key={s.shiftId ?? `s${i}`} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium">{dayLabel(s.date)}</div>
                <ShiftLine s={s} you={you} />
              </div>
              <div className="shrink-0 text-right text-sm font-semibold tabular-nums">
                {s.hours !== null ? (
                  formatHours(s.hours)
                ) : s.runningHours !== null ? (
                  <>
                    {formatHours(s.runningHours)}
                    <span className="block text-xs font-normal text-[var(--muted)]">so far</span>
                  </>
                ) : (
                  <span className="text-[var(--muted)]">—</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ShiftLine({ s, you }: { s: TimesheetShift; you: string }) {
  return (
    <div className="space-y-0.5 text-sm">
      {s.clockedIn ? (
        <div>
          {clock(s.clockedIn)} –{" "}
          {s.clockedOut ? clock(s.clockedOut) : s.forgotten ? <span className="font-semibold text-[var(--danger-text)]">never clocked out</span> : <span className="font-semibold">still on</span>}
        </div>
      ) : (
        <div className="text-[var(--muted)]">{s.missed ? "Didn't clock in" : "Coming up"}</div>
      )}
      {s.scheduled && <div className="text-xs text-[var(--muted)]">Scheduled {s.scheduled}</div>}
      {s.forgotten && <div className="text-xs font-semibold text-[var(--danger-text)]">{you === "You" ? "Ask" : `${you} should ask`} a manager to fix it. Until then it counts as 0 hours.</div>}
      {s.edited && (
        <div className="text-xs text-[var(--muted)]">
          <span className="rounded border border-[var(--border)] px-1 font-semibold">Edited</span> by {s.edited.byName ?? "a manager"}
          {s.edited.note ? `: ${s.edited.note}` : ""}
        </div>
      )}
    </div>
  );
}
