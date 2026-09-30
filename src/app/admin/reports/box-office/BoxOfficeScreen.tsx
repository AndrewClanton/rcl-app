import type { BoxOfficeMovie, BoxOfficeReport, BoxOfficeShow } from "@/lib/data/box-office";
import { addDays, filmWeekOf, monthLabel, monthOf, periodLabel, rangeLabel, shiftMonth, shiftPeriod, shortDate, weekOf, type Period } from "@/lib/report-periods";
import { Card, PeriodNav, Pill, Segmented, SplitBar, Stat, money, num } from "../ui";
import BoxOfficeActions from "./BoxOfficeActions";

// Reports -> Box office, as drawn: the page (./page.tsx) reads the dates
// from the address, checks the sign-in and gets the numbers.

const PATH = "/admin/reports/box-office";

function linkTo(p: Period, today: string) {
  if (p.kind === "month") return `${PATH}?range=month&month=${p.start.slice(0, 7)}`;
  if (p.kind === "custom") return `${PATH}?range=custom&from=${p.start}&to=${p.end}`;
  if (p.kind === "week") return `${PATH}?range=week&date=${p.start}`;
  return p.start === filmWeekOf(today).start ? PATH : `${PATH}?date=${p.start}`;
}

function title(p: Period) {
  if (p.kind === "film") return `Film week of ${shortDate(p.start, { weekday: true })}`;
  if (p.kind === "week") return `Week of ${shortDate(p.start)}`;
  if (p.kind === "month") return monthLabel(p.start.slice(0, 7));
  return rangeLabel(p.start, p.end);
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const fixed = (n: number) => n.toFixed(2);

export default function BoxOfficeScreen({ report, period, today }: { report: BoxOfficeReport; period: Period; today: string }) {
  const t = report.totals;

  // Showings are scheduled a couple of weeks out, so the arrows go a little past today.
  const next = shiftPeriod(period, 1);
  const horizon = addDays(today, 14);
  const hasNext = period.kind !== "custom" && next.start <= horizon;
  const upcoming = report.movies.some((m) => m.showings.some((s) => s.upcoming));
  const anyHand = report.movies.some((m) => m.showings.some((s) => s.handCount !== null));

  const film = filmWeekOf(today);
  const week = weekOf(today);
  const month = monthOf(today.slice(0, 7));
  const segments = [
    { label: "Film week", href: linkTo(period.kind === "film" ? period : filmWeekOf(period.start), today), active: period.kind === "film" },
    { label: "Mon–Sun", href: linkTo(period.kind === "week" ? period : weekOf(period.start), today), active: period.kind === "week" },
    { label: "Month", href: linkTo(period.kind === "month" ? period : monthOf(period.start.slice(0, 7)), today), active: period.kind === "month" },
    { label: "Custom", href: linkTo({ kind: "custom", start: period.start, end: period.end }, today), active: period.kind === "custom" },
  ];

  const name = `box-office_${period.start}_to_${period.end}`;

  return (
    <div className="space-y-5">
      <div className="flex justify-center print:hidden">
        <Segmented items={segments} />
      </div>

      <div className="print:hidden">
        {period.kind === "custom" ? (
          <CustomDates period={period} />
        ) : (
          <PeriodNav title={title(period)} subtitle={rangeLabel(period.start, period.end, { weekday: true })} prev={linkTo(shiftPeriod(period, -1), today)} next={hasNext ? linkTo(next, today) : null}>
            {period.kind === "film" && (
              <>
                <Pill href={linkTo(film, today)} active={period.start === film.start}>
                  This film week
                </Pill>
                <Pill href={linkTo(shiftPeriod(film, -1), today)} active={period.start === shiftPeriod(film, -1).start}>
                  Last film week
                </Pill>
              </>
            )}
            {period.kind === "week" && (
              <>
                <Pill href={linkTo(week, today)} active={period.start === week.start}>
                  This week
                </Pill>
                <Pill href={linkTo(shiftPeriod(week, -1), today)} active={period.start === shiftPeriod(week, -1).start}>
                  Last week
                </Pill>
              </>
            )}
            {period.kind === "month" && (
              <>
                <Pill href={linkTo(month, today)} active={period.start === month.start}>
                  This month
                </Pill>
                <Pill href={linkTo(monthOf(shiftMonth(today.slice(0, 7), -1)), today)} active={period.start === monthOf(shiftMonth(today.slice(0, 7), -1)).start}>
                  Last month
                </Pill>
              </>
            )}
          </PeriodNav>
        )}
      </div>

      <BoxOfficeActions name={name} byMovie={movieRows(report)} byShowing={showingRows(report)} />

      <div className="space-y-5 print:hidden">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat hero className="col-span-2" label="Admissions" value={num(t.admissions)} sub={`${num(t.online + t.register)} paid · ${num(t.free)} free${upcoming ? " · includes advance sales for shows still to come" : ""}`} />
          <Stat label="Gross, before tax" value={money(t.gross)} sub={t.discounts > 0 ? `after ${money(t.discounts)} member discounts` : undefined} />
          <Stat label="Sales tax" value={money(t.tax)} />
          <Stat label="Average paid ticket" value={t.avgTicket === null ? "—" : money(t.avgTicket)} />
          <Stat label="Showings" value={num(t.shows)} sub={t.capacity ? `${pct(t.admissions, t.capacity)}% of seats filled` : undefined} />
          <Stat label="Movies" value={num(report.movies.length)} className="col-span-2 lg:col-span-2" sub={report.movies[0]?.admissions ? `top: ${report.movies[0].title}` : undefined} />
        </div>

        <Card title="Where the admissions came from">
          <SplitBar
            format={(n) => num(n)}
            parts={[
              { label: "Paid online", value: t.online },
              { label: "Paid at the register", value: t.register },
              { label: "Free / comp", value: t.free },
            ]}
          />
        </Card>

        {report.movies.length === 0 ? (
          <Card>
            <p className="py-6 text-center text-sm text-[var(--muted)]">No showings on these dates.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            <h3 className="px-1 text-base font-semibold">By movie</h3>
            {report.movies.map((m) => (
              <MovieCard key={m.movieId} movie={m} />
            ))}
            <TotalsCard report={report} />
          </div>
        )}

        <Card title="What's counted" className="text-sm">
          <ul className="list-disc space-y-1.5 pl-5 text-[var(--muted)]">
            <li>Showings are counted by their date, 4 a.m. to 4 a.m. Central, so a midnight show counts on the night it started.</li>
            <li>Gross is ticket money before sales tax. Register tickets are after member discounts, which are taken off the order&apos;s tickets in proportion.</li>
            <li>Free / comp is $0 tickets: Insiders+ free seats and free screenings. An Insiders+ free seat booked together with paid seats is counted as free.</li>
            <li>
              Refunded tickets aren&apos;t counted{report.refundedTickets > 0 ? ` (${num(report.refundedTickets)} refunded on these dates)` : ""}.
              {report.partialRefunds.amount > 0 &&
                ` A partial refund keeps the seats sold, so its tickets stay counted: ${money(report.partialRefunds.amount)} was given back in part on ${num(report.partialRefunds.orders)} order${report.partialRefunds.orders === 1 ? "" : "s"} with tickets. Check whether any of it was for a ticket.`}
            </li>
            {anyHand && <li>&ldquo;Hand count&rdquo; is the attendance typed in on the Showtimes page, to compare. It&apos;s marked when it differs from the tickets sold.</li>}
          </ul>
        </Card>
      </div>

      <PrintReport report={report} period={period} />
    </div>
  );
}

function CustomDates({ period }: { period: Period }) {
  return (
    <Card title="Custom dates" subtitle={`Up to a year. Showing ${periodLabel(period)}.`}>
      {/* A plain form: the dates go in the address, so the result can be linked. */}
      <form action={PATH} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="range" value="custom" />
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--muted)]">From</span>
          <input type="date" name="from" defaultValue={period.start} required className="h-10 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--muted)]">To</span>
          <input type="date" name="to" defaultValue={period.end} required className="h-10 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" />
        </label>
        <button type="submit" className="h-10 rounded-full bg-[var(--foreground)] px-5 text-sm font-semibold text-[var(--background)]">
          Show
        </button>
      </form>
    </Card>
  );
}

function Fill({ n, of }: { n: number; of: number }) {
  const p = pct(n, of);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-1.5 w-10 overflow-hidden rounded-full bg-[var(--surface-hover)]">
        <span className="rpt-bar-strong block h-full rounded-full" style={{ width: `${Math.min(100, p)}%` }} />
      </span>
      <span className="tabular-nums">{p}%</span>
    </span>
  );
}

function HandCount({ show }: { show: BoxOfficeShow }) {
  if (show.handCount === null) return <span className="text-[var(--muted)]">—</span>;
  const off = !show.upcoming && show.handCount !== show.admissions;
  return (
    <span className={off ? "font-semibold text-[var(--warn-text)]" : ""} title={off ? `Hand count ${show.handCount}, tickets ${show.admissions}` : undefined}>
      {num(show.handCount)}
      {off && <span className="sr-only"> (differs from tickets)</span>}
    </span>
  );
}

function MovieCard({ movie: m }: { movie: BoxOfficeMovie }) {
  const hand = m.showings.filter((s) => s.handCount !== null);
  return (
    <details className="group rounded-xl border border-[var(--border)] bg-[var(--surface)] open:border-[var(--foreground)]">
      <summary className="cursor-pointer list-none p-4 sm:p-5 [&::-webkit-details-marker]:hidden">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold leading-snug">
              {m.title}
              {m.releaseYear && <span className="ml-1.5 text-sm font-normal text-[var(--muted)]">({m.releaseYear})</span>}
            </div>
            <div className="mt-0.5 text-xs text-[var(--muted)]">
              {num(m.shows)} showing{m.shows === 1 ? "" : "s"} · {num(m.online)} online · {num(m.register)} register · {num(m.free)} free
              {hand.length > 0 && ` · hand count ${num(hand.reduce((s, x) => s + (x.handCount ?? 0), 0))} (${hand.length} of ${m.shows})`}
            </div>
          </div>
          <span className="mt-1 shrink-0 text-xs text-[var(--muted)] transition-transform group-open:rotate-180" aria-hidden>
            ▼
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-[var(--muted)]">Admissions</dt>
            <dd className="text-lg font-bold">{num(m.admissions)}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)]">Gross</dt>
            <dd className="text-lg font-bold">{money(m.gross)}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)]">Tax</dt>
            <dd className="text-lg font-semibold">{money(m.tax)}</dd>
          </div>
          <div className="hidden sm:block">
            <dt className="text-xs text-[var(--muted)]">Avg paid ticket</dt>
            <dd className="text-lg font-semibold">{m.avgTicket === null ? "—" : money(m.avgTicket)}</dd>
          </div>
        </dl>
      </summary>

      <div className="border-t border-[var(--border)] px-4 pb-4 pt-2 sm:px-5">
        {/* Phones: one block per showing. */}
        <ul className="divide-y divide-[var(--border)] sm:hidden">
          {m.showings.map((s) => (
            <li key={s.screeningId} className="py-2.5 text-sm">
              <div className="flex items-baseline gap-2">
                <span className="font-medium">
                  {shortDate(s.date, { weekday: true })} · {s.time}
                </span>
                {s.upcoming && <span className="text-xs text-[var(--muted)]">upcoming</span>}
                <span className="ml-auto font-semibold tabular-nums">{money(s.gross)}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                <span>{s.room}</span>
                <span className="text-[var(--foreground)]">
                  <strong>{num(s.admissions)}</strong> in ({s.online} online · {s.register} register · {s.free} free)
                </span>
                <Fill n={s.admissions} of={s.capacity} />
                {s.handCount !== null && (
                  <span>
                    hand count <HandCount show={s} />
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>

        {/* Wider screens: a table. */}
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[720px] text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-[var(--muted)]">
                <th className="py-1.5 pr-2 font-medium">Date</th>
                <th className="py-1.5 pr-2 font-medium">Time</th>
                <th className="py-1.5 pr-2 font-medium">Room</th>
                <th className="py-1.5 pr-2 text-right font-medium">Online</th>
                <th className="py-1.5 pr-2 text-right font-medium">Register</th>
                <th className="py-1.5 pr-2 text-right font-medium">Free</th>
                <th className="py-1.5 pr-2 text-right font-medium">Total</th>
                <th className="py-1.5 pr-2 text-right font-medium">Gross</th>
                <th className="py-1.5 pr-2 text-right font-medium">Tax</th>
                <th className="py-1.5 pr-2 font-medium">Full</th>
                {m.showings.some((s) => s.handCount !== null) && <th className="py-1.5 text-right font-medium">Hand count</th>}
              </tr>
            </thead>
            <tbody>
              {m.showings.map((s) => (
                <tr key={s.screeningId} className="border-t border-[var(--border)]">
                  <td className="whitespace-nowrap py-1.5 pr-2">{shortDate(s.date, { weekday: true })}</td>
                  <td className="whitespace-nowrap py-1.5 pr-2">
                    {s.time}
                    {s.upcoming && <span className="ml-1 text-xs text-[var(--muted)]">upcoming</span>}
                  </td>
                  <td className="py-1.5 pr-2">{s.room}</td>
                  <td className="py-1.5 pr-2 text-right">{num(s.online)}</td>
                  <td className="py-1.5 pr-2 text-right">{num(s.register)}</td>
                  <td className="py-1.5 pr-2 text-right">{num(s.free)}</td>
                  <td className="py-1.5 pr-2 text-right font-semibold">{num(s.admissions)}</td>
                  <td className="py-1.5 pr-2 text-right">{money(s.gross)}</td>
                  <td className="py-1.5 pr-2 text-right text-[var(--muted)]">{money(s.tax)}</td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-xs">
                    <Fill n={s.admissions} of={s.capacity} />
                    <span className="ml-1 text-[var(--muted)]">of {s.capacity}</span>
                  </td>
                  {m.showings.some((x) => x.handCount !== null) && (
                    <td className="py-1.5 text-right">
                      <HandCount show={s} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

function TotalsCard({ report }: { report: BoxOfficeReport }) {
  const t = report.totals;
  return (
    <section className="rounded-xl border-2 border-[var(--foreground)] bg-[var(--surface)] p-4 sm:p-5">
      <h3 className="text-base font-semibold">All movies</h3>
      <dl className="mt-3 grid grid-cols-3 gap-3 text-sm sm:grid-cols-6">
        {[
          ["Showings", num(t.shows)],
          ["Online", num(t.online)],
          ["Register", num(t.register)],
          ["Free", num(t.free)],
          ["Admissions", num(t.admissions)],
          ["Gross", money(t.gross)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-[var(--muted)]">{label}</dt>
            <dd className="text-lg font-bold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-[var(--muted)]">
        Sales tax {money(t.tax)} · average paid ticket {t.avgTicket === null ? "—" : money(t.avgTicket)} · {pct(t.admissions, t.capacity)}% of {num(t.capacity)} seats
      </p>
    </section>
  );
}

// ---------- spreadsheet rows ----------

function movieRows(r: BoxOfficeReport): string[][] {
  const head = ["Movie", "Release year", "Showings", "Paid online", "Paid at register", "Free/comp", "Total admissions", "Gross before tax", "Sales tax", "Avg paid ticket", "Seats", "% full"];
  const row = (label: string, year: string, t: BoxOfficeReport["totals"]) => [
    label,
    year,
    String(t.shows),
    String(t.online),
    String(t.register),
    String(t.free),
    String(t.admissions),
    fixed(t.gross),
    fixed(t.tax),
    t.avgTicket === null ? "" : fixed(t.avgTicket),
    String(t.capacity),
    String(pct(t.admissions, t.capacity)),
  ];
  return [head, ...r.movies.map((m) => row(m.title, m.releaseYear ? String(m.releaseYear) : "", m)), row("TOTAL", "", r.totals)];
}

function showingRows(r: BoxOfficeReport): string[][] {
  const head = ["Movie", "Release year", "Date", "Day", "Showtime", "Room", "Ticket price", "Paid online", "Paid at register", "Free/comp", "Total admissions", "Gross before tax", "Sales tax", "Seats", "% full", "Hand count"];
  const rows: string[][] = [head];
  for (const m of r.movies) {
    for (const s of m.showings) {
      rows.push([
        m.title,
        m.releaseYear ? String(m.releaseYear) : "",
        s.date,
        new Date(`${s.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
        s.time,
        s.room,
        fixed(s.ticketPrice),
        String(s.online),
        String(s.register),
        String(s.free),
        String(s.admissions),
        fixed(s.gross),
        fixed(s.tax),
        String(s.capacity),
        String(pct(s.admissions, s.capacity)),
        s.handCount === null ? "" : String(s.handCount),
      ]);
    }
  }
  return rows;
}

// ---------- printed ----------
// Black on white, one table per movie with its showings, totals at the end.
// Only on paper (hidden on screen).

function PrintReport({ report, period }: { report: BoxOfficeReport; period: Period }) {
  const t = report.totals;
  const cell = "border-b border-black/30 px-1.5 py-1";
  const printed = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="hidden text-[10pt] leading-snug text-black print:block">
      <header className="mb-4 border-b-2 border-black pb-2">
        <div className="text-[9pt] uppercase tracking-wide">Royale Cinema Lounge · Joplin, MO</div>
        <h1 className="text-[16pt] font-bold">Box office report</h1>
        <div>
          {period.kind === "film" ? "Film week" : period.kind === "week" ? "Week" : period.kind === "month" ? "Month" : "Dates"}: {rangeLabel(period.start, period.end, { weekday: true })}
        </div>
        <div className="text-[8pt]">As of {printed}. Gross is before sales tax. Refunded tickets are not counted.</div>
      </header>

      {report.movies.map((m) => (
        <section key={m.movieId} className="mb-4 break-inside-avoid">
          <h2 className="mb-1 text-[11pt] font-bold">
            {m.title}
            {m.releaseYear ? ` (${m.releaseYear})` : ""}
          </h2>
          <table className="w-full border-collapse tabular-nums">
            <thead>
              <tr className="text-left text-[8pt] uppercase">
                <th className={cell}>Date</th>
                <th className={cell}>Time</th>
                <th className={cell}>Room</th>
                <th className={`${cell} text-right`}>Price</th>
                <th className={`${cell} text-right`}>Paid</th>
                <th className={`${cell} text-right`}>Free</th>
                <th className={`${cell} text-right`}>Adm.</th>
                <th className={`${cell} text-right`}>Gross</th>
                <th className={`${cell} text-right`}>Tax</th>
                <th className={`${cell} text-right`}>Seats</th>
              </tr>
            </thead>
            <tbody>
              {m.showings.map((s) => (
                <tr key={s.screeningId}>
                  <td className={cell}>{shortDate(s.date, { weekday: true })}</td>
                  <td className={cell}>{s.time}</td>
                  <td className={cell}>{s.room}</td>
                  <td className={`${cell} text-right`}>{money(s.ticketPrice)}</td>
                  <td className={`${cell} text-right`}>{s.online + s.register}</td>
                  <td className={`${cell} text-right`}>{s.free}</td>
                  <td className={`${cell} text-right font-semibold`}>{s.admissions}</td>
                  <td className={`${cell} text-right`}>{money(s.gross)}</td>
                  <td className={`${cell} text-right`}>{money(s.tax)}</td>
                  <td className={`${cell} text-right`}>{s.capacity}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td className="px-1.5 py-1" colSpan={4}>
                  {num(m.shows)} showing{m.shows === 1 ? "" : "s"}
                </td>
                <td className="px-1.5 py-1 text-right">{m.online + m.register}</td>
                <td className="px-1.5 py-1 text-right">{m.free}</td>
                <td className="px-1.5 py-1 text-right">{m.admissions}</td>
                <td className="px-1.5 py-1 text-right">{money(m.gross)}</td>
                <td className="px-1.5 py-1 text-right">{money(m.tax)}</td>
                <td className="px-1.5 py-1 text-right">{m.capacity}</td>
              </tr>
            </tbody>
          </table>
        </section>
      ))}

      <section className="break-inside-avoid border-t-2 border-black pt-2">
        <h2 className="text-[11pt] font-bold">Totals</h2>
        <table className="mt-1 w-full border-collapse tabular-nums">
          <thead>
            <tr className="text-left text-[8pt] uppercase">
              <th className={cell}>Movie</th>
              <th className={`${cell} text-right`}>Shows</th>
              <th className={`${cell} text-right`}>Paid</th>
              <th className={`${cell} text-right`}>Free</th>
              <th className={`${cell} text-right`}>Adm.</th>
              <th className={`${cell} text-right`}>Gross</th>
              <th className={`${cell} text-right`}>Tax</th>
            </tr>
          </thead>
          <tbody>
            {report.movies.map((m) => (
              <tr key={m.movieId}>
                <td className={cell}>{m.title}</td>
                <td className={`${cell} text-right`}>{m.shows}</td>
                <td className={`${cell} text-right`}>{m.online + m.register}</td>
                <td className={`${cell} text-right`}>{m.free}</td>
                <td className={`${cell} text-right`}>{m.admissions}</td>
                <td className={`${cell} text-right`}>{money(m.gross)}</td>
                <td className={`${cell} text-right`}>{money(m.tax)}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className="px-1.5 py-1">All movies</td>
              <td className="px-1.5 py-1 text-right">{t.shows}</td>
              <td className="px-1.5 py-1 text-right">{t.online + t.register}</td>
              <td className="px-1.5 py-1 text-right">{t.free}</td>
              <td className="px-1.5 py-1 text-right">{t.admissions}</td>
              <td className="px-1.5 py-1 text-right">{money(t.gross)}</td>
              <td className="px-1.5 py-1 text-right">{money(t.tax)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-[8pt]">
          Paid = online {num(t.online)} + register {num(t.register)}. Free = Insiders+ member seats and free screenings. Average paid ticket {t.avgTicket === null ? "—" : money(t.avgTicket)}.
        </p>
      </section>
    </div>
  );
}
