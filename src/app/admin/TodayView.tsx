import Link from "next/link";
import type { Signals, TodayBoard, NavBadges } from "@/lib/data/backoffice";
import type { HomeExtras, HomeTodo, WeekAheadDay } from "@/lib/data/home";
import { raiseParText } from "@/lib/ops/shared";
import { shiftDate } from "@/lib/ops/time";
import PageHeader from "@/components/admin/PageHeader";
import Badge from "./_nav/Badge";
import FindButton from "./_nav/FindButton";
import type { BackOfficeNav, NavGroup, NavLink } from "./_nav/map";
import type { ShortcutEntry } from "./_nav/shortcuts";
import Shortcuts from "./Shortcuts";

// Back office → Today, the home page: your shortcuts, what's on tonight,
// anything that needs a look, to-dos and the week ahead, and a way into
// everything else, grouped the same way as the menu. The figures come from
// page.tsx; this only lays them out.
//
// A phone gets one column: shortcuts, Needs a look, to-dos, the day's
// numbers, tonight, the week ahead, everything else. A computer gets a
// dashboard: shortcuts and the numbers across the top, then what to act on
// (Needs a look, to-dos) in the left column beside what's on (tonight, the
// week ahead), and everything else under them.

const TZ = "America/Chicago";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
// "Tue 7:45 PM"
const dayTime = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: TZ });

// "19:30:00" -> "7:30 PM"
function wallClock(time: string) {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// Minutes into the night, Central, for putting a day's items in order: an
// instant ("2026-10-02T00:30:00Z") or a wall-clock time ("19:30:00").
// Before 4 a.m. counts as the end of the night before, like the business day.
function nightMinutes(when: string) {
  const [h, m] = /^\d{1,2}:\d{2}/.test(when)
    ? when.split(":").map(Number)
    : new Date(when).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).split(":").map(Number);
  return (h < 4 ? h + 24 : h) * 60 + m;
}

const dayName = (date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Attention = { tone: "danger" | "warn" | "info"; text: string; href: string; go: string };

function attention(s: Signals, board: TodayBoard): Attention[] {
  const out: Attention[] = [];
  if (s.printers?.open && s.printers.offline.length) {
    out.push({ tone: "danger", text: `Printer not connected: ${s.printers.offline.join(", ")}`, href: "/admin/printers", go: "Printers" });
  }
  if (s.tabs?.fromBefore) out.push({ tone: "warn", text: `${plural(s.tabs.fromBefore, "tab")} left open from before today`, href: "/pos", go: "Register" });
  // Managers: restock to-dos from Ran out ("Buy Hot dog buns at Walmart"),
  // marked back in stock on Back office → Ran out.
  for (const t of board.managerTodos ?? []) {
    out.push(
      t.ranOut
        ? { tone: "warn", text: `${t.title} · ran out ${dayTime(t.createdAt)}`, href: "/admin/ran-out", go: "Ran out" }
        : { tone: "warn", text: `${t.title} · ${dayTime(t.createdAt)}`, href: "/admin/team?view=todos", go: "To-dos" },
    );
  }
  // Managers: running out before the week is over means the week's
  // shopping wasn't enough. Repeats first.
  const week = board.ranOutWeek;
  if (week?.reports) {
    const top = week.lines.slice(0, 3).map((l) => (l.times > 1 ? `${l.name} ×${l.times}` : l.name));
    const more = week.lines.length - top.length;
    out.push({
      tone: week.lines.some((l) => l.times > 1) ? "warn" : "info",
      text: `Ran out this week: ${plural(week.reports, "time")} (${top.join(", ")}${more > 0 ? ` and ${more} more` : ""})`,
      href: "/admin/ran-out",
      go: "Ran out",
    });
  }
  if (s.itemsOut?.length) {
    const names = s.itemsOut.length > 4 ? `${s.itemsOut.slice(0, 4).join(", ")} and ${s.itemsOut.length - 4} more` : s.itemsOut.join(", ");
    out.push({ tone: "warn", text: `Marked out on the register: ${names}`, href: "/admin/menu", go: "Menu" });
  }
  // Managers: par lines that keep running out. Only a nudge: nothing changes the par by itself.
  for (const o of board.oftenOut ?? []) {
    // The par sheet is edited on the register (Par sheet → Edit the list).
    out.push({ tone: "info", text: raiseParText(o), href: "/pos", go: "Par sheet" });
  }
  if (board.trainingOverdue) out.push({ tone: "warn", text: `${plural(board.trainingOverdue, "training")} overdue`, href: "/admin/training", go: "Training" });
  for (const e of board.events ?? []) {
    if (!e.paid && e.balanceDue > 0 && e.date <= shiftDate(board.date, 3)) {
      out.push({ tone: "warn", text: `${money(e.balanceDue)} still owed for ${e.name} (${e.date === board.date ? "tonight" : dayName(e.date)})`, href: "/admin/events", go: "Private events" });
    }
  }
  // Admins: accounts flagged at the register ("Flag suspicious activity"), to look at and clear.
  for (const f of s.flagged ?? []) {
    out.push({ tone: "warn", text: `🚩 Flagged account: ${f.name} · ${f.reason}`, href: `/admin/members/${f.memberId}`, go: "Review" });
  }
  if (s.held) out.push({ tone: "info", text: `${plural(s.held, "held order")} parked on the register`, href: "/pos", go: "Register" });
  if (s.devNotes) out.push({ tone: "info", text: `${plural(s.devNotes, "new dev note")} to look over`, href: "/admin/dev-notes", go: "Dev notes" });
  if (s.oldSite) out.push({ tone: "info", text: `${plural(s.oldSite, "old-site account")} waiting for a decision`, href: "/admin/members/old-site", go: "Old site members" });
  return out;
}

// The section headings on this page.
const SECTION_HEAD = "mb-2 text-sm font-bold uppercase tracking-[0.12em] text-[var(--muted)]";

export default function TodayView({
  signals,
  board,
  extras,
  badges,
  nav,
  manager,
  shortcuts,
}: {
  signals: Signals;
  board: TodayBoard;
  extras: HomeExtras;
  badges: NavBadges;
  nav: BackOfficeNav;
  manager: boolean;
  shortcuts: { employeeId: string; entries: ShortcutEntry[]; fromRole: string[]; defaults: string[]; roleName: string };
}) {
  const today = board.date;
  const needs = attention(signals, board);

  const shows = board.shows ?? [];
  const sold = shows.reduce((n, s) => n + s.sold, 0);
  const seats = shows.reduce((n, s) => n + s.capacity, 0);
  const tonight = [
    ...shows.map((s) => ({ key: `s${s.id}`, at: s.startsAt, show: s, house: null })),
    ...(board.houseEvents ?? []).map((h) => ({ key: `h${h.id}`, at: h.startsAt, show: null, house: h })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const eventsTonight = (board.events ?? []).filter((e) => e.date === today);

  const stats: Partial<Record<NavGroup["area"], string>> = {};
  if (board.summary) {
    stats.shows = `${plural(board.summary.upcomingScreenings, "showing")} coming up`;
    stats.guests = `${board.summary.totalMembers.toLocaleString()} members · ${board.summary.compedMembers.toLocaleString()} free or community`;
  }

  return (
    <div className="space-y-8 xl:grid xl:grid-cols-3 xl:gap-x-6 xl:gap-y-8 xl:space-y-0">
      <PageHeader
        eyebrow={dayName(today, { weekday: "long", month: "long", day: "numeric" })}
        title="Today"
        purpose="Your shortcuts, what's on tonight, anything that needs a look, and the way into everything else."
        className="xl:col-span-3 xl:row-start-1 xl:mb-0"
        actions={
          <>
            <Link href="/pos" className="btn-primary inline-flex min-h-11 items-center gap-2">
              Open the register
              {badges.tabs && <Badge badge={badges.tabs} className={badges.tabs.tone === "count" ? "!bg-white !text-[var(--foreground)]" : ""} />}
            </Link>
            <FindButton />
          </>
        }
      />

      <div className="xl:col-span-3 xl:row-start-2">
        <Shortcuts {...shortcuts} />
      </div>

      {/* Things to act on. A computer: the left-hand column. */}
      <div className="space-y-8 xl:col-start-1 xl:row-start-4">
        {/* Needs a look: problems find people, not the other way round. */}
        <section aria-labelledby="needs-heading">
          <h2 id="needs-heading" className={SECTION_HEAD}>
            Needs a look
          </h2>
          {needs.length === 0 ? (
            <p className="notice notice-success !p-3 text-sm">Nothing needs a look right now.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              {needs.map((n, i) => (
                <li key={i}>
                  <Link href={n.href} className="flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-[var(--surface-hover)]">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${n.tone === "danger" ? "bg-[var(--danger-text)]" : n.tone === "warn" ? "bg-[#d99a1e]" : "bg-[var(--muted)]"}`}
                      aria-hidden
                    />
                    <span className="sr-only">{n.tone === "danger" ? "Problem:" : n.tone === "warn" ? "Heads up:" : ""}</span>
                    <span className={`min-w-0 flex-1 text-sm ${n.tone === "danger" ? "font-semibold text-[var(--danger-text)]" : ""}`}>{n.text}</span>
                    <span className="shrink-0 text-sm text-[var(--muted)]">{n.go} →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <TodosCard todos={extras.todos} manager={manager} today={today} />
      </div>

      {/* At a glance */}
      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:col-span-3 xl:row-start-3">
        <Tile
          label="Sales today"
          href="/admin/reports"
          value={board.summary ? money(board.summary.todaysRevenue) : "–"}
          sub={
            board.summary
              ? `${plural(board.summary.todaysOrders, "order")}${board.summary.todaysOwnerTabOrders ? ` · ${board.summary.todaysOwnerTabOrders} on owner tabs` : ""}`
              : "Couldn't load"
          }
          long
        />
        <Tile
          label="Tickets tonight"
          href="/admin/screenings"
          value={board.shows ? (shows.length ? `${sold}` : "–") : "–"}
          sub={board.shows ? (shows.length ? `of ${seats} seats · ${plural(shows.length, "showing")}` : "No showings tonight") : "Couldn't load"}
        />
        <Tile
          label="On shift now"
          href={manager ? "/admin/team" : undefined}
          value={board.onShift ? String(board.onShift.length) : "–"}
          sub={board.onShift ? (board.onShift.length ? board.onShift.map((o) => o.name).join(", ") : "Nobody yet") : "Couldn't load"}
        />
        <div className="bo-card flex flex-col">
          <Link href="/admin/my-hours" className="-m-4 flex-1 rounded-xl p-4 hover:bg-[var(--surface-hover)]">
            <div className="text-xs font-medium text-[var(--muted)]">Your hours this week</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{board.hours ? `${board.hours.mine.toFixed(1)} h` : "–"}</div>
            <div className="mt-0.5 text-xs text-[var(--muted)]">
              {board.hours ? (board.hours.onNowSince ? `On now, since ${clock(board.hours.onNowSince)}` : "Monday to Sunday, from clock-ins") : "Couldn't load"}
            </div>
          </Link>
          {manager && board.hours && board.hours.team !== null && (
            <Link href="/admin/team?view=timesheets" className="-mx-4 -mb-4 mt-4 flex min-h-11 flex-wrap items-center justify-between gap-x-2 border-t border-[var(--border)] px-4 py-1 text-xs hover:bg-[var(--surface-hover)]">
              <span className="whitespace-nowrap">
                Team: <b className="tabular-nums">{board.hours.team?.toFixed(1)} h</b>
              </span>
              <span className="whitespace-nowrap text-[var(--muted)]">Timesheets →</span>
            </Link>
          )}
        </div>
        {/* Owners only: what the owners have had at the owner rate this month. */}
        {board.ownerTab && (
          <Link
            href="/admin/owner-tab"
            className="col-span-2 flex min-h-11 flex-wrap items-center justify-between gap-x-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm hover:bg-[var(--surface-hover)] lg:col-span-4"
          >
            <span>
              Owner tab this month: <b className="tabular-nums">{money(board.ownerTab.owed)}</b>{" "}
              <span className="text-[var(--muted)]">(menu value {money(board.ownerTab.menuValue)})</span>
            </span>
            <span className="whitespace-nowrap text-[var(--muted)]">Owner tab →</span>
          </Link>
        )}
      </section>

      {/* What's on. A computer: the two right-hand columns. */}
      <div className="space-y-8 xl:col-span-2 xl:col-start-2 xl:row-start-4">
        {/* Tonight. The heading only shows on a computer, where it sits
            beside Needs a look. */}
        <section aria-labelledby="tonight-heading" className="bo-area-shows">
          <h2 id="tonight-heading" className={`${SECTION_HEAD} hidden xl:block`}>
            Tonight
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="bo-card bo-card-area">
              <CardHead title="On screen tonight" href="/admin/screenings" link="Showtimes" />
              {!board.shows ? (
                <p className="text-sm text-[var(--muted)]">Couldn&apos;t load tonight&apos;s showings.</p>
              ) : tonight.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No showings or house events tonight.</p>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {tonight.map((t) => (
                    <li key={t.key} className="flex items-baseline gap-3 py-2 text-sm">
                      <span className="w-16 shrink-0 font-semibold tabular-nums">{clock(t.at)}</span>
                      {t.show ? (
                        <>
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">{t.show.title}</span>
                            {t.show.room && <span className="text-[var(--muted)]"> · {t.show.room}</span>}
                          </span>
                          <span className="shrink-0 tabular-nums text-[var(--muted)]">
                            <b className="text-[var(--foreground)]">{t.show.sold}</b>/{t.show.capacity}
                          </span>
                        </>
                      ) : (
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{t.house!.title}</span>
                          <span className="text-[var(--muted)]"> · house event</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bo-card bo-card-area">
              <CardHead title="Booked tonight" href="/admin/events" link="Private events" />
              {eventsTonight.length === 0 && (board.booths ?? []).length === 0 ? (
                <p className="text-sm text-[var(--muted)]">{board.events && board.booths ? "No private events or booth bookings tonight." : "Couldn't load tonight's bookings."}</p>
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {eventsTonight.map((e) => (
                    <li key={e.id} className="flex items-baseline gap-3 py-2 text-sm">
                      <span className="w-16 shrink-0 font-semibold tabular-nums">{wallClock(e.time)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{e.name}</span>
                        <span className="text-[var(--muted)]">
                          {" "}
                          · {e.room} · <span className="whitespace-nowrap">{e.hours} h</span>
                        </span>
                      </span>
                      {!e.paid && e.balanceDue > 0 && <span className="bo-badge bo-badge-warn">{money(e.balanceDue)} due</span>}
                    </li>
                  ))}
                  {(board.booths ?? []).map((b) => (
                    <li key={b.id} className="flex items-baseline gap-3 py-2 text-sm">
                      <span className="w-16 shrink-0 font-semibold tabular-nums">{wallClock(b.time)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{b.booth}</span>
                        <span className="text-[var(--muted)]">
                          {" "}
                          · {b.name} · party of {b.party}
                        </span>
                      </span>
                      {!b.confirmed && <span className="bo-badge bo-badge-warn">Not paid yet</span>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-x-4 text-sm">
                <Link href="/admin/booths" className="inline-flex min-h-11 items-center text-[var(--muted)] hover:text-[var(--foreground)]">
                  Booths →
                </Link>
              </div>
            </div>
          </div>
        </section>

        <WeekAhead days={extras.weekAhead} events={(board.events ?? []).filter((e) => e.date > today)} />
      </div>

      {/* Everything else, grouped the same way as the menu. */}
      <section aria-labelledby="everything-heading" className="xl:col-span-3 xl:row-start-5">
        <h2 id="everything-heading" className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
          Everything else
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {nav.groups.map((g) => (
            <LinkCard key={g.area} area={g.area} title={g.label} stat={stats[g.area]} links={g.links} badges={badges} />
          ))}
          <LinkCard title="You" links={nav.you} badges={badges} />
        </div>
      </section>
    </div>
  );
}

// `long`: a figure like "$12,345.67" that could outgrow half a phone's
// width, so it's a size smaller there and may wrap rather than overflow.
function Tile({ label, value, sub, href, long = false }: { label: string; value: string; sub: string; href?: string; long?: boolean }) {
  const body = (
    <>
      <div className="text-xs font-medium text-[var(--muted)]">{label}</div>
      <div className={`mt-1 font-bold tabular-nums ${long ? "min-w-0 break-words text-xl sm:text-2xl" : "text-2xl"}`}>{value}</div>
      <div className="mt-0.5 truncate text-xs text-[var(--muted)]">{sub}</div>
    </>
  );
  return href ? (
    <Link href={href} className="bo-card block hover:bg-[var(--surface-hover)]">
      {body}
    </Link>
  ) : (
    <div className="bo-card">{body}</div>
  );
}

function CardHead({ title, href, link }: { title: string; href?: string; link?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {href && link && (
        <Link href={href} className="inline-flex min-h-11 items-center text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
          {link} →
        </Link>
      )}
    </div>
  );
}

function TodoList({ todos, today }: { todos: HomeTodo[]; today: string }) {
  return (
    <ul className="divide-y divide-[var(--border)]">
      {todos.map((t) => (
        <li key={t.id} className="py-2 text-sm">
          <div className="font-medium">{t.title}</div>
          {(t.dueDate || t.details) && (
            <div className="text-xs text-[var(--muted)]">
              {t.dueDate && <span className={t.dueDate < today ? "font-semibold text-[var(--danger-text)]" : ""}>{t.dueDate < today ? "Overdue · " : "Due "}{dayName(t.dueDate)}</span>}
              {t.dueDate && t.details && " · "}
              {t.details}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// Open to-dos for this person and for whoever's on shift. They're marked
// done on the register, where they pop up; managers hand them out on Team.
function TodosCard({ todos, manager, today }: { todos: HomeExtras["todos"]; manager: boolean; today: string }) {
  return (
    <div className="bo-card bo-card-area bo-area-team">
      <CardHead title="To-dos" href={manager ? "/admin/team?view=todos" : undefined} link="All to-dos" />
      {!todos ? (
        <p className="text-sm text-[var(--muted)]">Couldn&apos;t load the to-dos.</p>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="text-xs font-medium text-[var(--muted)]">For you</div>
            {todos.mine.length ? <TodoList todos={todos.mine} today={today} /> : <p className="py-2 text-sm text-[var(--muted)]">Nothing for you right now.</p>}
          </div>
          {todos.shift.length > 0 && (
            <div>
              <div className="text-xs font-medium text-[var(--muted)]">For whoever&apos;s on shift</div>
              <TodoList todos={todos.shift.slice(0, 5)} today={today} />
              {todos.shift.length > 5 && <p className="text-xs text-[var(--muted)]">and {todos.shift.length - 5} more</p>}
            </div>
          )}
          <p className="border-t border-[var(--border)] pt-2 text-xs text-[var(--muted)]">
            {manager && todos.teamOpen !== null ? `${plural(todos.teamOpen, "to-do")} open for the whole team, restocks included. ` : ""}
            They pop up on the register while you&apos;re on shift; tap Done there.
          </p>
        </div>
      )}
    </div>
  );
}

// The next seven days: showings with tickets sold so far, house events and
// private events (these used to be "Later this week" under Booked
// tonight). Two or three days to a row where there's room.
function WeekAhead({ days, events, className = "" }: { days: HomeExtras["weekAhead"]; events: TodayBoard["events"]; className?: string }) {
  // If the showings couldn't be read, the private events (read with
  // tonight's board) still show, day by day.
  const list: WeekAheadDay[] = days ?? [...new Set((events ?? []).map((e) => e.date))].sort().map((date) => ({ date, shows: [], houseEvents: [] }));
  return (
    <div className={`bo-card bo-card-area bo-area-shows ${className}`}>
      <CardHead title="The week ahead" href="/admin/screenings" link="Showtimes" />
      {!days && <p className="mb-2 text-sm text-[var(--muted)]">Couldn&apos;t load the week&apos;s showings{list.length ? "; the private events are below." : "."}</p>}
      {list.length > 0 && (
        <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2 2xl:grid-cols-3">
          {list.map((d) => {
            const booked = (events ?? []).filter((e) => e.date === d.date);
            const items = [
              ...d.shows.map((s) => ({ key: `s${s.id}`, at: clock(s.startsAt), sort: nightMinutes(s.startsAt), title: s.title, extra: `${s.sold}/${s.capacity}`, warn: null as string | null })),
              ...d.houseEvents.map((h) => ({ key: `h${h.id}`, at: clock(h.startsAt), sort: nightMinutes(h.startsAt), title: h.title, extra: "house event", warn: null as string | null })),
              ...booked.map((e) => ({
                key: `e${e.id}`,
                at: wallClock(e.time),
                sort: nightMinutes(e.time),
                title: e.name,
                extra: "private",
                warn: !e.paid && e.balanceDue > 0 ? `${money(e.balanceDue)} due` : null,
              })),
            ].sort((a, b) => a.sort - b.sort);
            return (
              <li key={d.date} className="min-w-0 border-t border-[var(--border)] pt-2">
                <div className="text-sm font-semibold">{dayName(d.date, { weekday: "long", month: "short", day: "numeric" })}</div>
                {items.length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">Nothing scheduled.</p>
                ) : (
                  <ul className="mt-0.5 space-y-0.5">
                    {items.map((it) => (
                      <li key={it.key} className="flex items-baseline gap-2 text-sm">
                        <span className="w-16 shrink-0 tabular-nums text-[var(--muted)]">{it.at}</span>
                        <span className="min-w-0 flex-1 truncate" title={it.title}>
                          {it.title}
                        </span>
                        {it.warn ? <span className="bo-badge bo-badge-warn">{it.warn}</span> : <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{it.extra}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function LinkCard({ area, title, stat, links, badges }: { area?: NavGroup["area"]; title: string; stat?: string; links: NavLink[]; badges: NavBadges }) {
  return (
    <div className={`bo-card bo-card-area ${area ? `bo-area-${area}` : ""}`}>
      <div className="bo-eyebrow mb-1">
        {area && <span className="bo-dot" />}
        {title}
      </div>
      {stat && <div className="mb-1 text-xs text-[var(--muted)]">{stat}</div>}
      <ul className="-mx-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex min-h-11 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--surface-hover)]">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{l.label}</span>
                <span className="block text-xs text-[var(--muted)]">{l.about}</span>
              </span>
              {l.badge && <Badge badge={badges[l.badge]} />}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
