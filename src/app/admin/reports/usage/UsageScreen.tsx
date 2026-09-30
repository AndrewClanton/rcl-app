import type { UsageAudience, UsagePage, UsageReport } from "@/lib/data/usage";
import { datesIn, rangeLabel, shortDate } from "@/lib/report-periods";
import { BarList, Card, Columns, Rows, Segmented, SplitBar, Stat, num } from "../ui";

// Reports -> Website usage, as drawn: the page (./page.tsx) reads the
// period and audience from the address, checks the sign-in and gets the
// numbers (src/lib/data/usage.ts).

const PATH = "/admin/reports/usage";

export type UsageRange = "today" | "7" | "30" | "custom";

export interface UsageLink {
  who: UsageAudience;
  range: UsageRange;
  from?: string;
  to?: string;
}

export function usageHref(l: UsageLink) {
  const q = new URLSearchParams();
  if (l.who !== "customers") q.set("who", l.who);
  if (l.range !== "7") q.set("range", l.range);
  if (l.range === "custom" && l.from && l.to) {
    q.set("from", l.from);
    q.set("to", l.to);
  }
  const s = q.toString();
  return s ? `${PATH}?${s}` : PATH;
}

// ---- words and numbers ------------------------------------------------------

// "45s", "3m 20s", "42m", "5h 07m".
export function duration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 10) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

// "1 visitor", "12 visitors".
function count(n: number, word: string) {
  return `${num(n)} ${word}${n === 1 ? "" : "s"}`;
}

const PAGE_NAMES: Record<string, string> = {
  "/": "Home",
  "/about": "About",
  "/booths": "Reserve a booth",
  "/events": "Private events",
  "/membership": "Insiders (membership)",
  "/membership/gift": "Gift a membership",
  "/menu": "Menu",
  "/showtimes": "Showtimes",
  "/privacy": "Privacy policy",
  "/data-deletion": "Deleting your data",
  "/account": "My account",
  "/account/billing": "My account · Billing",
  "/account/movies": "My account · Movies",
  "/account/movies/[id]": "My account · A booking",
  "/account/points": "My account · Points",
  "/account/profile": "My account · Profile",
  "/account/purchases": "My account · Purchases",
  "/account/login": "Member sign-in",
  "/account/claim": "Claim an old-site account",
  "/account/reset-password": "Reset password",
  "/login": "Staff sign-in",
  "/admin": "Dashboard",
  "/admin/booths": "Booths",
  "/admin/dev-notes": "Dev notes",
  "/admin/events": "Events",
  "/admin/ingredients": "Ingredients",
  "/admin/members": "Members",
  "/admin/members/[id]": "Members · One member",
  "/admin/members/indy": "Members · Indy import",
  "/admin/members/old-site": "Members · Old site",
  "/admin/members/regulars": "Members · Regulars",
  "/admin/menu": "Menu",
  "/admin/my-pin": "My PIN",
  "/admin/printers": "Printers",
  "/admin/reports": "Reports · Day",
  "/admin/reports/daily": "Reports · Daily email",
  "/admin/reports/week": "Reports · Week",
  "/admin/reports/month": "Reports · Month",
  "/admin/reports/box-office": "Reports · Box office",
  "/admin/reports/tax": "Reports · Sales tax",
  "/admin/reports/bar": "Reports · Bar usage",
  "/admin/reports/members": "Reports · Members",
  "/admin/reports/usage": "Reports · Website usage",
  "/admin/schedule-graphic": "Schedule graphic",
  "/admin/screenings": "Showtimes",
  "/admin/staff": "Staff",
  "/admin/team": "Team",
  "/admin/training": "Training (managers)",
  "/pos": "Register",
  "/pos/shift": "Register · Shift",
  "/training": "Training",
  "/display": "Screens & TVs",
  "/display/bar": "Bar board",
  "/display/box-office": "Box office screen",
  "/display/customer": "Customer screen",
  "/display/kitchen": "Kitchen board",
  "/display/prep": "Prep board",
  "/display/now-playing": "Now Playing screen",
  // Its old address, kept so visits logged before the rename keep a name.
  "/display/ramp": "Now Playing screen (old address)",
};

export function pageName(pattern: string, movieTitle: string | null = null) {
  if (pattern === "/showtimes/[id]") return movieTitle ? `Showtime · ${movieTitle}` : "Showtime · since taken down";
  const known = PAGE_NAMES[pattern];
  if (known) return known;
  if (pattern.startsWith("/account/purchases/")) return "My account · A receipt";
  const training = pattern.match(/^\/training\/([^/]+)$/);
  if (training) return `Training · ${decodeSafe(training[1]).replace(/[-_]+/g, " ")}`;
  return pattern;
}

function decodeSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const ROLE_NAMES: Record<string, string> = {
  owner: "Owners",
  admin: "Admins",
  manager: "Managers",
  cashier: "Cashiers",
  display: "Display logins",
  "": "Not signed in",
};
const ROLE_ORDER = ["cashier", "manager", "admin", "owner", "display", ""];

// Where visits came from, by the name people know.
function referrerName(host: string) {
  if (!host) return "Typed in or bookmarked";
  const h = host.replace(/^(l|lm|m|mobile|web)\./, "");
  if (/(^|\.)google\./.test(h) || h === "com.google.android.googlequicksearchbox") return "Google";
  if (h === "com.google.android.gm") return "Gmail";
  if (h.startsWith("facebook.") || h === "fb.com" || h === "fb.me") return "Facebook";
  if (h.startsWith("instagram.")) return "Instagram";
  if (h === "t.co" || h === "x.com" || h === "twitter.com") return "X (Twitter)";
  if (h.startsWith("bing.")) return "Bing";
  if (h === "duckduckgo.com") return "DuckDuckGo";
  if (h.endsWith("yahoo.com")) return "Yahoo";
  if (h === "tiktok.com") return "TikTok";
  return h;
}

// BarList keys its rows by label, so a repeated name gets a number.
function uniqueLabels<T extends { label: string }>(rows: T[]): T[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const n = (seen.get(r.label) ?? 0) + 1;
    seen.set(r.label, n);
    return n === 1 ? r : { ...r, label: `${r.label} (${n})` };
  });
}

function hourLabel(h: number, long = false) {
  const suffix = h < 12 ? (long ? " AM" : "a") : long ? " PM" : "p";
  return `${h % 12 === 0 ? 12 : h % 12}${suffix}`;
}

// ---- the screen -------------------------------------------------------------

const AUDIENCE_NOTES: Record<UsageAudience, string> = {
  customers: "The public site and member accounts.",
  staff: "The back office, the register and training.",
  screens: "The TVs and boards (Displays).",
};

export default function UsageScreen({ report, range, today, earliest }: { report: UsageReport; range: UsageRange; today: string; earliest: string }) {
  const who = report.audience;
  const since = report.firstDate;
  const link = (l: Partial<UsageLink>) => usageHref({ who, range, from: report.start, to: report.end, ...l });
  const oneDay = report.start === report.end;

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-2">
        <Segmented
          items={(["customers", "staff", "screens"] as const).map((w) => ({
            label: w === "customers" ? "Customers" : w === "staff" ? "Staff" : "Screens",
            href: link({ who: w }),
            active: who === w,
          }))}
        />
        <Segmented
          items={[
            { label: "Today", href: link({ range: "today" }), active: range === "today" },
            { label: "7 days", href: link({ range: "7" }), active: range === "7" },
            { label: "30 days", href: link({ range: "30" }), active: range === "30" },
            { label: "Custom", href: link({ range: "custom" }), active: range === "custom" },
          ]}
        />
        <div className="text-center">
          <h2 className="text-lg font-bold leading-tight sm:text-xl">{rangeLabel(report.start, report.end, { weekday: oneDay })}</h2>
          <p className="mt-0.5 text-xs text-[var(--muted)] sm:text-sm">{AUDIENCE_NOTES[who]}</p>
        </div>
      </div>

      {range === "custom" && <CustomDates who={who} start={report.start} end={report.end} today={today} earliest={since && since > earliest ? since : earliest} />}

      {report.error ? (
        <Card>
          <p className="py-6 text-center text-sm text-[var(--muted)]">Couldn&apos;t read the page counts right now. ({report.error})</p>
        </Card>
      ) : report.totals.views === 0 && report.totals.notFound === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-[var(--muted)]">
            {since ? "No page views on these dates." : "No page views counted yet. They start adding up as soon as people use the site."}
            {since && report.start < since ? ` Counting started ${shortDate(since, { year: true })}.` : ""}
          </p>
        </Card>
      ) : (
        <Figures report={report} oneDay={oneDay} />
      )}

      <Counted report={report} />
    </div>
  );
}

function Figures({ report, oneDay }: { report: UsageReport; oneDay: boolean }) {
  const who = report.audience;
  const t = report.totals;
  const p = report.previous;
  const avg = t.views ? t.seconds / t.views : 0;
  const avgBefore = p && p.views ? p.seconds / p.views : null;
  const vs = `vs ${rangeLabel(report.previousStart, report.previousEnd)}`;
  const byViews = report.pages;
  const byTime = [...report.pages].sort((a, b) => b.seconds - a.seconds);
  const busiest = report.hours.reduce<{ hour: number; views: number } | null>((top, h) => (h.views > (top?.views ?? 0) ? h : top), null);
  const hourViews = new Map(report.hours.map((h) => [h.hour, h.views]));
  const dayViews = new Map(report.days.map((d) => [d.date, d]));
  const dates = datesIn(report.start, report.end);
  const manyDays = dates.length > 10;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat hero className="col-span-2" label="Page views" value={num(t.views)} now={t.views} before={p?.views ?? null} beforeText={p ? `${num(p.views)} ${vs}` : undefined} />
        <Stat
          label="Time on pages"
          value={duration(t.seconds)}
          now={t.seconds}
          before={p?.seconds ?? null}
          sub={t.views ? `${duration(avg)} a view` : undefined}
        />
        {who === "customers" ? (
          <Stat label="Visitors" value={num(t.visitors)} now={t.visitors} before={p?.visitors ?? null} sub={`${num(t.newVisitors)} new`} />
        ) : (
          <Stat label="Devices" value={num(t.visitors)} sub="different browsers" />
        )}
        {who !== "screens" && (
          <Stat label="Visits" value={num(t.sessions)} now={t.sessions} before={p?.sessions ?? null} sub={t.sessions ? `${(t.views / t.sessions).toFixed(1)} pages a visit` : undefined} />
        )}
        <Stat label="Average time a view" value={t.views ? duration(avg) : "—"} now={avg} before={avgBefore} />
        {who === "customers" && (
          <Stat label="Returning visitors" value={num(Math.max(0, t.visitors - t.newVisitors))} sub={t.visitors ? `${Math.round(((t.visitors - t.newVisitors) / t.visitors) * 100)}% of visitors` : undefined} />
        )}
        {who === "customers" && t.notFound > 0 && <Stat label="Page not found" value={num(t.notFound)} sub="dead links and typos" />}
      </div>

      {!oneDay && (
        <Card title="Page views by day">
          <Columns
            height={120}
            format={(n) => num(n)}
            labelEvery={manyDays ? 7 : 1}
            columns={dates.map((date) => {
              const d = dayViews.get(date);
              return {
                key: date,
                label: manyDays ? String(Number(date.slice(8))) : shortDate(date, { weekday: true }).split(",")[0],
                value: d?.views ?? 0,
                title: d ? `${shortDate(date, { weekday: true })}: ${count(d.views, "view")}, ${count(d.visitors, who === "customers" ? "visitor" : "device")}, ${duration(d.seconds)} on screen` : `${shortDate(date, { weekday: true })}: no views`,
              };
            })}
            emptyText="No views."
          />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title={who === "staff" ? "Most used" : "Most visited"} subtitle="By page views.">
          <BarList
            format={(n) => num(n)}
            showShare={false}
            rows={uniqueLabels(byViews.slice(0, 10).map((pg) => ({ label: pageName(pg.pattern, pg.movieTitle), value: pg.views, detail: count(pg.visitors, who === "customers" ? "visitor" : "device") })))}
          />
        </Card>
        <Card title="Where the time goes" subtitle="By total time on screen.">
          <BarList
            format={duration}
            showShare={false}
            rows={uniqueLabels(byTime.slice(0, 10).map((pg) => ({ label: pageName(pg.pattern, pg.movieTitle), value: pg.seconds, detail: `${duration(pg.views ? pg.seconds / pg.views : 0)} a view` })))}
          />
        </Card>
      </div>

      {who === "staff" && <ByRole report={report} />}

      <Card title="Every page" subtitle={report.buckets > 1 ? `Trend: page views ${report.bucketDays === 1 ? "each day" : `every ${report.bucketDays} days`}.` : undefined}>
        <PageTable pages={report.pages} who={who} showTrend={report.buckets > 1} />
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {who === "customers" && (
          <>
            <Card title="Where visits start" subtitle="The first page of each visit.">
              {report.entries.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">None yet.</p>
              ) : (
                <BarList format={(n) => num(n)} showShare={false} rows={uniqueLabels(report.entries.map((e) => ({ label: pageName(e.pattern, e.movieTitle), value: e.views })))} />
              )}
            </Card>
            <Card title="Where they came from" subtitle="The site that sent each visit. Links in texts and apps usually count as typed in.">
              {report.referrers.length === 0 ? <p className="text-sm text-[var(--muted)]">None yet.</p> : <BarList format={(n) => num(n)} showShare={false} rows={referrerRows(report.referrers)} />}
            </Card>
          </>
        )}

        <Card
          title="Busiest hours"
          subtitle={busiest ? `Page views by the hour they were opened. Busiest: ${hourLabel(busiest.hour, true)}, ${num(busiest.views)} view${busiest.views === 1 ? "" : "s"}.` : "Page views by the hour they were opened."}
        >
          <Columns
            height={110}
            format={(n) => num(n)}
            labelEvery={3}
            columns={Array.from({ length: 24 }, (_, h) => ({
              key: String(h),
              label: hourLabel(h),
              value: hourViews.get(h) ?? 0,
              title: `${hourLabel(h, true)}: ${count(hourViews.get(h) ?? 0, "view")}`,
            }))}
            emptyText="No views."
          />
        </Card>

        {who !== "screens" && (
          <Card title={who === "customers" ? "Phones, tablets, computers" : "Devices"} subtitle="Visits, by screen size.">
            <SplitBar format={(n) => num(n)} parts={deviceParts(report.devices)} />
          </Card>
        )}

        {report.missing.length > 0 && (
          <Card title="Pages not found" subtitle="Addresses that led nowhere: old links, typos, and robots guessing.">
            <Rows rows={report.missing.map((m) => ({ key: m.path, label: <span className="break-all font-mono text-xs">{m.path}</span>, value: num(m.views) }))} />
          </Card>
        )}
      </div>
    </div>
  );
}

function referrerRows(rows: { host: string; visits: number }[]) {
  const merged = new Map<string, number>();
  for (const r of rows) merged.set(referrerName(r.host), (merged.get(referrerName(r.host)) ?? 0) + Number(r.visits));
  return [...merged.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
}

function deviceParts(rows: { device: string; visits: number }[]) {
  const names: Record<string, string> = { phone: "Phones", tablet: "Tablets", desktop: "Computers", unknown: "Unknown" };
  const count = (d: string) => Number(rows.find((r) => r.device === d)?.visits ?? 0);
  return ["phone", "tablet", "desktop", "unknown"].map((d) => ({ label: names[d], value: count(d) }));
}

// Staff: which pages each role leans on, by time on screen.
function ByRole({ report }: { report: UsageReport }) {
  const roles = new Map<string, { views: number; seconds: number; pages: { pattern: string; views: number; seconds: number }[] }>();
  for (const r of report.roles) {
    const role = roles.get(r.role) ?? { views: 0, seconds: 0, pages: [] };
    role.views += Number(r.views);
    role.seconds += Number(r.seconds);
    role.pages.push({ pattern: r.pattern, views: Number(r.views), seconds: Number(r.seconds) });
    roles.set(r.role, role);
  }
  const order = [...roles.keys()].sort((a, b) => (ROLE_ORDER.indexOf(a) === -1 ? 99 : ROLE_ORDER.indexOf(a)) - (ROLE_ORDER.indexOf(b) === -1 ? 99 : ROLE_ORDER.indexOf(b)));
  if (order.length === 0) return null;
  return (
    <div className="space-y-3">
      <h3 className="px-1 text-base font-semibold">By role</h3>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {order.map((role) => {
          const r = roles.get(role)!;
          const top = [...r.pages].sort((a, b) => b.seconds - a.seconds || b.views - a.views).slice(0, 6);
          return (
            <Card key={role || "none"} title={ROLE_NAMES[role] ?? role} subtitle={`${count(r.views, "page view")} · ${duration(r.seconds)} on screen. Their pages, most time first.`}>
              <BarList format={duration} showShare={false} rows={uniqueLabels(top.map((pg) => ({ label: pageName(pg.pattern), value: pg.seconds, detail: count(pg.views, "view") })))} />
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// One line per page. On a phone the figures sit under the name; wider, they
// line up in columns.
const TABLE_COLS = "sm:grid-cols-[minmax(0,1fr)_4rem_4.5rem_4.5rem_4.5rem_5.5rem]";
const SHOWN = 25;

function PageTable({ pages, who, showTrend }: { pages: UsagePage[]; who: UsageAudience; showTrend: boolean }) {
  if (pages.length === 0) return <p className="text-sm text-[var(--muted)]">No pages yet.</p>;
  const people = who === "customers" ? "Visitors" : "Devices";
  return (
    <div>
      <div className={`hidden gap-x-3 border-b border-[var(--border)] pb-1.5 text-xs font-medium text-[var(--muted)] sm:grid ${TABLE_COLS}`}>
        <span>Page</span>
        <span className="text-right">Views</span>
        <span className="text-right">{people}</span>
        <span className="text-right">Avg time</span>
        <span className="text-right">Total</span>
        <span className="text-right">{showTrend ? "Trend" : ""}</span>
      </div>
      <ol className="divide-y divide-[var(--border)]">
        {pages.slice(0, SHOWN).map((pg) => (
          <PageRow key={pg.key} pg={pg} people={people} showTrend={showTrend} />
        ))}
      </ol>
      {pages.length > SHOWN && (
        <details className="mt-1">
          <summary className="cursor-pointer py-2 text-sm font-medium">Show the other {num(pages.length - SHOWN)}</summary>
          <ol className="divide-y divide-[var(--border)]">
            {pages.slice(SHOWN).map((pg) => (
              <PageRow key={pg.key} pg={pg} people={people} showTrend={showTrend} />
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function PageRow({ pg, people, showTrend }: { pg: UsagePage; people: string; showTrend: boolean }) {
  const name = pageName(pg.pattern, pg.movieTitle);
  const cell = "flex items-baseline gap-1 sm:block sm:text-right";
  const label = "text-[var(--muted)] sm:sr-only";
  return (
    <li className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 text-sm ${TABLE_COLS}`}>
      <div className="min-w-0">
        <div className="truncate font-medium" title={name}>
          {name}
        </div>
        {name !== pg.pattern && <div className="truncate font-mono text-[11px] text-[var(--muted)]">{pg.pattern}</div>}
      </div>
      <div className="justify-self-end sm:order-last">{showTrend && <Sparkline values={pg.trend} name={name} />}</div>
      <dl className="col-span-2 flex flex-wrap gap-x-4 text-xs tabular-nums sm:col-span-1 sm:contents sm:text-sm">
        <div className={cell}>
          <dt className={label}>Views</dt>
          <dd className="font-semibold">{num(pg.views)}</dd>
        </div>
        <div className={cell}>
          <dt className={label}>{people}</dt>
          <dd>{num(pg.visitors)}</dd>
        </div>
        <div className={cell}>
          <dt className={label}>Avg</dt>
          <dd>{duration(pg.views ? pg.seconds / pg.views : 0)}</dd>
        </div>
        <div className={cell}>
          <dt className={label}>Total</dt>
          <dd>{duration(pg.seconds)}</dd>
        </div>
      </dl>
    </li>
  );
}

// Views over the period, one ink line; the peak is marked.
function Sparkline({ values, name }: { values: number[]; name: string }) {
  if (values.length < 2) return null;
  const w = 80;
  const h = 24;
  const max = Math.max(1, ...values);
  const step = w / (values.length - 1);
  const y = (v: number) => h - 3 - (v / max) * (h - 6);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const peak = values.indexOf(Math.max(...values));
  const summary = `${name}: ${values.join(", ")} views, oldest first`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={summary} className="block overflow-visible">
      <title>{summary}</title>
      <polygon points={`0,${h} ${pts} ${w},${h}`} style={{ fill: "color-mix(in srgb, var(--foreground) 10%, transparent)" }} />
      <polyline points={pts} style={{ fill: "none", stroke: "var(--foreground)", strokeWidth: 1.5, strokeLinejoin: "round", strokeLinecap: "round" }} />
      {values[peak] > 0 && <circle cx={peak * step} cy={y(values[peak])} r={2.25} style={{ fill: "var(--foreground)" }} />}
    </svg>
  );
}

function CustomDates({ who, start, end, today, earliest }: { who: UsageAudience; start: string; end: string; today: string; earliest: string }) {
  return (
    <Card title="Custom dates" subtitle={`Any dates from ${shortDate(earliest, { year: true })} to today.`}>
      {/* A plain form: the dates go in the address, so the result can be linked. */}
      <form action={PATH} className="flex flex-wrap items-end gap-3">
        {who !== "customers" && <input type="hidden" name="who" value={who} />}
        <input type="hidden" name="range" value="custom" />
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--muted)]">From</span>
          <input type="date" name="from" defaultValue={start} min={earliest} max={today} required className="h-10 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-[var(--muted)]">To</span>
          <input type="date" name="to" defaultValue={end} min={earliest} max={today} required className="h-10 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-sm" />
        </label>
        <button type="submit" className="h-10 rounded-full bg-[var(--foreground)] px-5 text-sm font-semibold text-[var(--background)]">
          Show
        </button>
      </form>
    </Card>
  );
}

function Counted({ report }: { report: UsageReport }) {
  const who = report.audience;
  return (
    <Card title="What's counted" className="text-sm">
      <ul className="list-disc space-y-1.5 pl-5 text-[var(--muted)]">
        <li>A page view is a page opened in a browser. Time counts only while the page is on screen (not a hidden tab or a locked phone), up to 4 hours for one view.</li>
        {who === "customers" ? (
          <li>
            Visitors are different browsers, told apart by a random number the browser keeps (no cookie, no name or account). A visit ends after half an hour
            without a new page. Someone on a phone and then a computer counts twice.
          </li>
        ) : (
          <li>Devices are different browsers. For staff pages the role signed in is kept (cashier, manager...), never who it was.</li>
        )}
        {who === "customers" && report.staffBrowserViews > 0 && (
          <li>
            Left out: {num(report.staffBrowserViews)} view{report.staffBrowserViews === 1 ? "" : "s"} from browsers that have also opened the back office or the
            register, so staff checking the site don&apos;t count as customers.
          </li>
        )}
        {who === "screens" && <li>A screen left on one page for hours counts as one view, with its time capped at 4 hours.</li>}
        <li>Search engines and other robots aren&apos;t counted, and neither are browsers set to ask sites not to track them.</li>
        <li>
          Days run 4 a.m. to 4 a.m. Central, like the other reports.{report.firstDate ? ` Counting started ${shortDate(report.firstDate, { year: true })}.` : ""} Views
          are kept for 13 months. The changes compare with the same number of days just before ({rangeLabel(report.previousStart, report.previousEnd)}).
        </li>
      </ul>
    </Card>
  );
}
