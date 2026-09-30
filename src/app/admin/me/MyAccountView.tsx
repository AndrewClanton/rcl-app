import Link from "next/link";
import { signOut } from "@/app/login/actions";
import PageHeader from "@/components/admin/PageHeader";
import { formatHours } from "@/lib/hours";
import { businessDay, shiftDate } from "@/lib/ops/time";
import { accountClock, accountDay, type AccountData, type CalendarItem, type DoneItem } from "@/lib/data/my-account";
import type { TimesheetPerson } from "@/lib/data/team";
import { ShiftList } from "../my-hours/MyHoursView";

// My account (and, for managers, anyone's page from Team): the pay
// period's hours, what's on the calendar, what's been done lately, and
// what was rung on the register. The page loads the data
// (src/lib/data/my-account.ts); this lays it out. A phone gets one column;
// a computer puts the calendar and shifts on the left and the record on
// the right.

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", manager: "Manager", cashier: "Staff" };

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const worked = (p: TimesheetPerson | null) => (p ? p.hours + p.runningHours : 0);
const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

export default function MyAccountView({ data, self, canFix }: { data: AccountData; self: boolean; canFix: boolean }) {
  const { person, period } = data;
  const today = businessDay().date;
  const first = person.name.trim().split(/\s+/)[0] || person.name;
  const you = self ? "You" : first;
  const [weekA, weekB] = period?.weeks ?? [];
  const current = period ? (weekB && weekB.start <= today ? weekB : weekA) : null;
  const periodHours = period ? period.weeks.reduce((n, w) => n + worked(w.sheet), 0) : 0;
  const periodScheduled = period ? period.weeks.reduce((n, w) => n + (w.sheet?.scheduledHours ?? 0), 0) : 0;
  const lateOrMissed = period ? period.weeks.reduce((n, w) => n + (w.sheet?.lateCount ?? 0) + (w.sheet?.missedCount ?? 0), 0) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        area={self ? undefined : "team"}
        eyebrow={self ? "You" : undefined}
        back={self ? undefined : { href: "/admin/team?view=timesheets", label: "Hours & timesheets" }}
        title={self ? "My account" : person.name}
        purpose={
          self
            ? "Your shifts and hours this pay period, what's on your calendar, what you've done lately, and what you rang on the register. Only you (and the managers) see this."
            : `${first}'s shifts and hours this pay period, calendar, what they've done lately, and what they rang on the register.`
        }
        actions={
          self ? (
            <span className="flex flex-wrap gap-2">
              <Link href="/admin/my-hours" className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] px-3 text-sm hover:border-[var(--foreground)]">
                My hours →
              </Link>
              <Link href="/admin/my-pin" className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] px-3 text-sm hover:border-[var(--foreground)]">
                My PIN →
              </Link>
              <Link href="/training" className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] px-3 text-sm hover:border-[var(--foreground)]">
                My training →
              </Link>
              {/* Also under More in the menu; here too, where people look for it. */}
              <form action={signOut}>
                <button type="submit" className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] px-3 text-sm text-[var(--muted)] hover:border-[var(--foreground)] hover:text-[var(--foreground)]">
                  Sign out
                </button>
              </form>
            </span>
          ) : undefined
        }
        className="!mb-0"
      >
        <p className="text-sm text-[var(--muted)]">
          {ROLE_LABEL[person.role] ?? person.role}
          {person.since && ` · on the team since ${new Date(person.since).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/Chicago" })}`}
          {!person.active && " · no longer active"}
        </p>
      </PageHeader>

      {data.forgotten.length > 0 && (
        <div className="notice notice-warn text-sm">
          <strong>
            {you} never clocked out on {data.forgotten.map((s) => accountDay(s.date)).join(", ")}.
          </strong>{" "}
          {data.forgotten.length === 1 ? "That shift counts" : "Those shifts count"} as 0 hours until a manager sets the clock-out.
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

      {/* The numbers people ask about most. */}
      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Figure
          label="Hours this week"
          value={current ? formatHours(worked(current.sheet)) : "–"}
          sub={current?.sheet?.runningHours ? `Includes ${formatHours(current.sheet.runningHours)} on the clock now` : current?.sheet?.scheduledHours ? `${formatHours(current.sheet.scheduledHours)} scheduled` : "From clock-ins"}
        />
        <Figure
          label="This pay period"
          value={period ? formatHours(periodHours) : "–"}
          sub={period ? `${accountDay(period.start)} – ${accountDay(period.end)}${periodScheduled ? ` · ${formatHours(periodScheduled)} scheduled` : ""}` : "Couldn't load"}
          warn={lateOrMissed ? `${plural(lateOrMissed, "late or missed shift")}` : null}
        />
        <Figure
          label="Rang up this week"
          value={data.sales ? money(data.sales.week.taken) : "–"}
          sub={data.sales ? `${plural(data.sales.week.orders, "order")} · ${money(data.sales.week.tips)} in tips` : "Couldn't load"}
          long
        />
        <Figure
          label="Tips paid out, pay period"
          value={data.tipsPaid ? money(data.tipsPaid.period) : "–"}
          sub={data.tipsPaid ? (data.tipsPaid.days.length ? `${plural(data.tipsPaid.days.length, "day")} recorded` : "None recorded yet") : "Couldn't load"}
          long
        />
      </section>

      <div className="space-y-5 xl:grid xl:grid-cols-3 xl:items-start xl:gap-6 xl:space-y-0">
        <div className="space-y-5 xl:col-span-2">
          <CalendarCard items={data.calendar} today={today} self={self} />
          {period && (
            <div className="space-y-5 2xl:grid 2xl:grid-cols-2 2xl:items-start 2xl:gap-5 2xl:space-y-0">
              {/* This week first. */}
              {[...period.weeks].reverse().filter((w) => w.start <= today).map((w) => (
                <ShiftList key={w.start} title={w.start === current?.start ? "This week" : "Earlier this pay period"} start={w.start} person={w.sheet} you={you} />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-5">
          <DoneCard items={data.done} self={self} />
          <RegisterCard data={data} self={self} />
          {data.trainings && (
            <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <h2 className="text-sm font-semibold">Training</h2>
              <p className="mt-1 text-sm">
                {data.trainings.open ? `${plural(data.trainings.open, "training")} to do` : "Nothing assigned right now"}
                {data.trainings.overdue > 0 && <span className="font-semibold text-[var(--danger-text)]"> · {data.trainings.overdue} overdue</span>}
                <span className="text-[var(--muted)]"> · {data.trainings.done} signed off</span>
              </p>
              {self && (
                <Link href="/training" className="inline-flex min-h-11 items-center text-sm font-semibold hover:underline">
                  Open my training →
                </Link>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// `long`: a money figure like "$12,345.67" that could outgrow half a
// phone's width, so it's a size smaller there and may wrap rather than
// overflow.
function Figure({ label, value, sub, warn = null, long = false }: { label: string; value: string; sub: string; warn?: string | null; long?: boolean }) {
  return (
    <div className="bo-card">
      <div className="text-xs font-medium text-[var(--muted)]">{label}</div>
      <div className={`mt-1 font-bold tabular-nums ${long ? "min-w-0 break-words text-xl sm:text-2xl" : "text-2xl"}`}>{value}</div>
      <div className="mt-0.5 text-xs text-[var(--muted)]">{sub}</div>
      {warn && <div className="mt-0.5 text-xs font-semibold text-[var(--danger-text)]">{warn}</div>}
    </div>
  );
}

// Grouped by day: overdue to-dos and trainings first, then today, tomorrow
// and on, then to-dos with no date. A shift still running from last night
// (it started before today's business day) goes under today, not Overdue.
function CalendarCard({ items, today, self }: { items: CalendarItem[] | null; today: string; self: boolean }) {
  const groups = new Map<string, CalendarItem[]>();
  for (const it of items ?? []) {
    const key = it.date === null ? "any" : it.kind === "shift" ? (it.date < today ? today : it.date) : it.date < today ? "overdue" : it.date;
    groups.set(key, [...(groups.get(key) ?? []), it]);
  }
  const order = [...groups.keys()].sort((a, b) => rank(a).localeCompare(rank(b)));
  const heading = (key: string) =>
    key === "overdue" ? "Overdue" : key === "any" ? "Any time" : key === today ? "Today" : key === shiftDate(today, 1) ? "Tomorrow" : accountDay(key);

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold">
        On {self ? "your" : "their"} calendar <span className="font-normal text-[var(--muted)]">· the next two weeks</span>
      </h2>
      {!items ? (
        <p className="mt-2 text-sm text-[var(--muted)]">Couldn&apos;t load the calendar.</p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted)]">No shifts, to-dos or trainings coming up.</p>
      ) : (
        <div className="mt-2 grid gap-x-6 gap-y-3 lg:grid-cols-2">
          {order.map((key) => (
            <div key={key} className="min-w-0 border-t border-[var(--border)] pt-2">
              <div className={`text-sm font-semibold ${key === "overdue" ? "text-[var(--danger-text)]" : ""}`}>{heading(key)}</div>
              <ul className="mt-0.5 space-y-1">
                {groups.get(key)!.map((it) => (
                  <li key={`${it.kind}-${it.id}`} className="flex items-baseline gap-2 text-sm">
                    <span className="w-32 shrink-0 tabular-nums text-[var(--muted)]">
                      {it.kind === "shift" && it.at && it.until ? `${accountClock(it.at)}–${accountClock(it.until)}` : it.kind === "todo" ? "To-do" : "Training"}
                    </span>
                    <span className="min-w-0 flex-1">
                      {it.href && self ? (
                        <Link href={it.href} className="font-medium underline-offset-2 hover:underline">
                          {it.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{it.title}</span>
                      )}
                      {it.kind === "todo" && key === "overdue" && it.date && <span className="text-[var(--danger-text)]"> · was due {accountDay(it.date)}</span>}
                      {it.detail && <span className="block text-xs text-[var(--muted)]">{it.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-[var(--muted)]">To-dos pop up on the register while {self ? "you're" : "they're"} on shift; they&apos;re marked done there.</p>
    </section>
  );
}

function rank(key: string) {
  return key === "overdue" ? "0" : key === "any" ? "9" : `1${key}`;
}

const DONE_LABEL: Record<DoneItem["kind"], string> = { task: "checklist task", todo: "to-do", par: "par count", ranout: "ran-out report" };

function DoneCard({ items, self }: { items: DoneItem[] | null; self: boolean }) {
  const counts = (["task", "todo", "par", "ranout"] as const).map((k) => ({ k, n: (items ?? []).filter((i) => i.kind === k).length })).filter((c) => c.n > 0);
  const shown = (items ?? []).slice(0, 12);
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold">
        Done lately <span className="font-normal text-[var(--muted)]">· last 30 days</span>
      </h2>
      {!items ? (
        <p className="mt-2 text-sm text-[var(--muted)]">Couldn&apos;t load this.</p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted)]">Nothing ticked off on the register in the last 30 days.</p>
      ) : (
        <>
          <p className="mt-1 text-sm">{counts.map((c) => plural(c.n, DONE_LABEL[c.k])).join(" · ")}</p>
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {shown.map((it) => (
              <li key={`${it.kind}-${it.id}`} className="py-1.5 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 font-medium">{it.title}</span>
                  <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{stamp(it.at)}</span>
                </div>
                {it.detail && <div className="text-xs text-[var(--muted)]">{it.detail}</div>}
              </li>
            ))}
          </ul>
          {items.length > shown.length && <p className="mt-1 text-xs text-[var(--muted)]">and {items.length - shown.length} more</p>}
        </>
      )}
      <p className="mt-2 text-xs text-[var(--muted)]">From the register&apos;s checklists, to-dos, par sheet and Ran out, when {self ? "you were" : "they were"} the one on shift.</p>
    </section>
  );
}

function RegisterCard({ data, self }: { data: AccountData; self: boolean }) {
  const s = data.sales;
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold">
        On the register <span className="font-normal text-[var(--muted)]">· this pay period</span>
      </h2>
      {!s ? (
        <p className="mt-2 text-sm text-[var(--muted)]">Couldn&apos;t load this.</p>
      ) : s.period.orders === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted)]">No orders rung under {self ? "your" : "their"} name this pay period.</p>
      ) : (
        <>
          <p className="mt-1 text-sm">
            <b className="tabular-nums">{plural(s.period.orders, "order")}</b> · <b className="tabular-nums">{money(s.period.taken)}</b> taken ·{" "}
            <b className="tabular-nums">{money(s.period.tips)}</b> in tips on them
          </p>
          <table className="mt-2 w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-[var(--muted)]">
                <th className="pb-1 font-medium">Day</th>
                <th className="pb-1 text-right font-medium">Orders</th>
                <th className="pb-1 text-right font-medium">Taken</th>
                <th className="pb-1 text-right font-medium">Tips</th>
              </tr>
            </thead>
            <tbody>
              {[...s.days].reverse().map((d) => (
                <tr key={d.date} className="border-t border-[var(--border)]">
                  <td className="py-1">{accountDay(d.date)}</td>
                  <td className="py-1 text-right">{d.orders}</td>
                  <td className="py-1 text-right">{money(d.taken)}</td>
                  <td className="py-1 text-right">{money(d.tips)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {data.tipsPaid && data.tipsPaid.days.length > 0 && (
        <p className="mt-2 text-sm">
          Tips paid out to {self ? "you" : first(data.person.name)}: <b className="tabular-nums">{money(data.tipsPaid.period)}</b>
          <span className="text-[var(--muted)]"> over {plural(data.tipsPaid.days.length, "day")}</span>
        </p>
      )}
      <p className="mt-2 text-xs text-[var(--muted)]">
        Finished orders rung under {self ? "your" : "their"} name, with tax and tips, less anything given back in a partial refund; fully refunded ones
        aren&apos;t counted. Orders rung under a shared register login aren&apos;t in here.
      </p>
    </section>
  );
}

function first(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}
