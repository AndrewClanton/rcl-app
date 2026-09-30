import Link from "next/link";
import type { Signals, TodayBoard, NavBadges } from "@/lib/data/backoffice";
import { shiftDate } from "@/lib/ops/time";
import PageHeader from "@/components/admin/PageHeader";
import Badge from "./_nav/Badge";
import FindButton from "./_nav/FindButton";
import type { BackOfficeNav, NavGroup, NavLink } from "./_nav/map";

// Back office → Today: what's on tonight, anything that needs a look, and a
// way into everything else, grouped the same way as the menu. The figures
// come from page.tsx; this only lays them out.

const TZ = "America/Chicago";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });

// "19:30:00" -> "7:30 PM"
function wallClock(time: string) {
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
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
  if (s.itemsOut?.length) {
    const names = s.itemsOut.length > 4 ? `${s.itemsOut.slice(0, 4).join(", ")} and ${s.itemsOut.length - 4} more` : s.itemsOut.join(", ");
    out.push({ tone: "warn", text: `Marked out on the register: ${names}`, href: "/admin/menu", go: "Menu" });
  }
  if (board.trainingOverdue) out.push({ tone: "warn", text: `${plural(board.trainingOverdue, "training")} overdue`, href: "/admin/training", go: "Training" });
  for (const e of board.events ?? []) {
    if (!e.paid && e.balanceDue > 0 && e.date <= shiftDate(board.date, 3)) {
      out.push({ tone: "warn", text: `${money(e.balanceDue)} still owed for ${e.name} (${e.date === board.date ? "tonight" : dayName(e.date)})`, href: "/admin/events", go: "Private events" });
    }
  }
  if (s.held) out.push({ tone: "info", text: `${plural(s.held, "held order")} parked on the register`, href: "/pos", go: "Register" });
  if (s.devNotes) out.push({ tone: "info", text: `${plural(s.devNotes, "new dev note")} to look over`, href: "/admin/dev-notes", go: "Dev notes" });
  if (s.oldSite) out.push({ tone: "info", text: `${plural(s.oldSite, "old-site account")} waiting for a decision`, href: "/admin/members/old-site", go: "Old site members" });
  return out;
}

export default function TodayView({ signals, board, badges, nav, manager }: { signals: Signals; board: TodayBoard; badges: NavBadges; nav: BackOfficeNav; manager: boolean }) {
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
  const eventsLater = (board.events ?? []).filter((e) => e.date > today);

  const stats: Partial<Record<NavGroup["area"], string>> = {};
  if (board.summary) {
    stats.shows = `${plural(board.summary.upcomingScreenings, "showing")} coming up`;
    stats.guests = `${board.summary.totalMembers.toLocaleString()} members · ${board.summary.compedMembers.toLocaleString()} free or community`;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={dayName(today, { weekday: "long", month: "long", day: "numeric" })}
        title="Today"
        purpose="What's on tonight, anything that needs a look, and the way into everything else."
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

      {/* Needs a look: problems find people, not the other way round. */}
      <section aria-labelledby="needs-heading">
        <h2 id="needs-heading" className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
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

      {/* At a glance */}
      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Sales today" href="/admin/reports" value={board.summary ? money(board.summary.todaysRevenue) : "–"} sub={board.summary ? plural(board.summary.todaysOrders, "order") : "Couldn't load"} />
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
      </section>

      {/* Tonight */}
      <section aria-label="Tonight" className="bo-area-shows grid gap-4 lg:grid-cols-2">
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
          {eventsLater.length > 0 && (
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <div className="mb-1 text-xs font-medium text-[var(--muted)]">Later this week</div>
              <ul className="space-y-1 text-sm">
                {eventsLater.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span className="w-24 shrink-0 text-[var(--muted)]">{dayName(e.date)}</span>
                    <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-x-4 text-sm">
            <Link href="/admin/booths" className="inline-flex min-h-11 items-center text-[var(--muted)] hover:text-[var(--foreground)]">
              Booths →
            </Link>
          </div>
        </div>
      </section>

      {/* Everything else, grouped the same way as the menu. */}
      <section aria-labelledby="everything-heading">
        <h2 id="everything-heading" className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
          Everything else
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {nav.groups.map((g) => (
            <LinkCard key={g.area} area={g.area} title={g.label} stat={stats[g.area]} links={g.links} badges={badges} />
          ))}
          <LinkCard title="You" links={nav.you} badges={badges} />
        </div>
      </section>
    </div>
  );
}

function Tile({ label, value, sub, href }: { label: string; value: string; sub: string; href?: string }) {
  const body = (
    <>
      <div className="text-xs font-medium text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
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

function CardHead({ title, href, link }: { title: string; href: string; link: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 className="text-base font-semibold">{title}</h2>
      <Link href={href} className="inline-flex min-h-11 items-center text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
        {link} →
      </Link>
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
