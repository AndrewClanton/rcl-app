import Link from "next/link";
import DrillLink from "./DrillLink";

// The building blocks every Reports screen is made of: cards, big numbers
// with their change from last time, simple bar charts, and the period
// arrows. Plain server components (no browser code), styled with the back
// office's own colors. Color means something here: green is up, red is
// down; everything else is ink on paper. A figure given an `href` opens
// its drill-down (the Day report's DayDrill) when tapped.

const TAPPABLE = "transition-colors hover:border-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--foreground)]";

function Chevron() {
  return (
    <span aria-hidden className="text-sm leading-none text-[var(--muted)]">
      ›
    </span>
  );
}

export function money(n: number, opts: { cents?: boolean } = {}) {
  const cents = opts.cents ?? true;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
}

// $1.2K / $12K for chart labels, where space is tight.
export function compactMoney(n: number) {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(Math.abs(n) >= 10_000 ? 0 : 1)}K`;
  return `$${Math.round(n)}`;
}

export function num(n: number) {
  return n.toLocaleString("en-US");
}

export function Card({ title, subtitle, action, children, className = "" }: { title?: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {title && <h3 className="text-base font-semibold">{title}</h3>}
          {action && <div className="ml-auto text-sm">{action}</div>}
          {subtitle && <p className="w-full text-xs text-[var(--muted)]">{subtitle}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

// Change from the period before: ▲ 12% (green) or ▼ 8% (red). Nothing when
// there's nothing to compare.
export function Delta({ now, before, className = "" }: { now: number; before: number | null | undefined; className?: string }) {
  if (before === null || before === undefined) return null;
  if (Math.abs(before) < 0.005) {
    if (Math.abs(now) < 0.005) return null;
    return <span className={`text-xs font-semibold text-[var(--muted)] ${className}`}>new</span>;
  }
  const pct = ((now - before) / Math.abs(before)) * 100;
  if (Math.abs(pct) < 0.5) return <span className={`text-xs font-semibold text-[var(--muted)] ${className}`}>no change</span>;
  const up = pct > 0;
  return (
    <span className={`whitespace-nowrap text-xs font-semibold tabular-nums ${up ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"} ${className}`}>
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      <span className="sr-only">{up ? "up" : "down"}</span> {Math.abs(pct) >= 999 ? ">999" : Math.round(Math.abs(pct))}%
    </span>
  );
}

// One figure. `hero` is the one number a screen leads with.
export function Stat({
  label,
  value,
  now,
  before,
  beforeText,
  sub,
  hero = false,
  href,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  now?: number;
  before?: number | null;
  beforeText?: string;
  sub?: React.ReactNode;
  hero?: boolean;
  href?: string;
  className?: string;
}) {
  const box = `min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 ${hero ? "sm:py-4" : ""} ${className}`;
  const inside = (
    <>
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-[var(--muted)]">
        {label}
        {href && <Chevron />}
      </div>
      <div className={`mt-0.5 font-bold leading-tight ${hero ? "text-4xl sm:text-5xl" : "text-2xl"}`}>{value}</div>
      {(now !== undefined || sub) && (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs text-[var(--muted)]">
          {now !== undefined && <Delta now={now} before={before} />}
          {beforeText && before !== null && before !== undefined && <span>{beforeText}</span>}
          {sub && <span>{sub}</span>}
        </div>
      )}
    </>
  );
  return href ? (
    <DrillLink href={href} className={`block ${box} ${TAPPABLE}`}>
      {inside}
    </DrillLink>
  ) : (
    <div className={box}>{inside}</div>
  );
}

// ◀ title ▶, with room for shortcuts underneath.
export function PeriodNav({ title, subtitle, prev, next, children }: { title: React.ReactNode; subtitle?: React.ReactNode; prev: string | null; next: string | null; children?: React.ReactNode }) {
  const arrow = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-sm transition-colors";
  return (
    <div className="space-y-3">
      {/* On a wide screen the arrows stay close to the title instead of
          at the far edges. */}
      <div className="flex items-center gap-2 sm:gap-3 lg:mx-auto lg:max-w-2xl">
        {prev ? (
          <Link href={prev} className={`${arrow} hover:border-[var(--foreground)]`} aria-label="Earlier">
            ◀
          </Link>
        ) : (
          <span className={`${arrow} opacity-30`} aria-hidden>
            ◀
          </span>
        )}
        <div className="min-w-0 flex-1 text-center">
          <h2 className="text-lg font-bold leading-tight sm:text-xl">{title}</h2>
          {subtitle && <div className="mt-0.5 text-xs text-[var(--muted)] sm:text-sm">{subtitle}</div>}
        </div>
        {next ? (
          <Link href={next} className={`${arrow} hover:border-[var(--foreground)]`} aria-label="Later">
            ▶
          </Link>
        ) : (
          <span className={`${arrow} opacity-30`} aria-hidden>
            ▶
          </span>
        )}
      </div>
      {children && <div className="flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  );
}

// A small pill link: "This week", "Last month".
export function Pill({ href, active = false, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${active ? "border-[var(--foreground)] bg-[var(--foreground)] font-semibold text-[var(--background)]" : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--foreground)]"}`}
    >
      {children}
    </Link>
  );
}

// A choice of a few: Film week | Calendar week | Month | Custom.
export function Segmented({ items }: { items: { href: string; label: string; active: boolean }[] }) {
  return (
    <div className="flex max-w-full overflow-x-auto rounded-full border border-[var(--border)] bg-[var(--surface)] p-1 [scrollbar-width:none]">
      {items.map((it) => (
        <Link
          key={it.label}
          href={it.href}
          aria-current={it.active ? "page" : undefined}
          className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors ${it.active ? "bg-[var(--foreground)] font-semibold text-[var(--background)]" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`}
        >
          {it.label}
        </Link>
      ))}
    </div>
  );
}

export interface Column {
  key: string;
  label: string; // under the bar
  value: number;
  title: string; // on hover and for screen readers
  href?: string;
  strong?: boolean; // the one to look at (today, the best day)
}

// Upright bars, one per day or hour. The tallest (or the ones marked
// strong) are in ink, the rest lighter; the top value is written on it.
export function Columns({ columns, height = 128, format = (n: number) => compactMoney(n), labelEvery = 1, emptyText = "Nothing yet." }: { columns: Column[]; height?: number; format?: (n: number) => string; labelEvery?: number; emptyText?: string }) {
  const max = Math.max(0, ...columns.map((c) => c.value));
  if (max <= 0) return <p className="py-6 text-center text-sm text-[var(--muted)]">{emptyText}</p>;
  const top = columns.findIndex((c) => c.value === max);
  const gap = columns.length > 40 ? "gap-px" : "gap-[2px]";
  return (
    <div>
      <div className={`flex items-end ${gap}`} style={{ height }}>
        {columns.map((c, i) => {
          const pct = c.value > 0 ? Math.max(3, (c.value / max) * 100) : 0;
          const bar = (
            <span className="flex h-full w-full items-end justify-center">
              <span className="relative block w-full max-w-6" style={{ height: c.value > 0 ? `${pct}%` : "2px" }}>
                <span className={`block h-full w-full rounded-t-[4px] ${c.strong || i === top ? "rpt-bar-strong" : "rpt-bar"}`} style={{ opacity: c.value > 0 ? 1 : 0.5 }} />
                {i === top && (
                  // Just above the bar; kept inside the chart at either end.
                  <span
                    className={`absolute bottom-full mb-0.5 whitespace-nowrap text-[11px] font-semibold tabular-nums ${i < columns.length * 0.2 ? "left-0" : i >= columns.length * 0.8 ? "right-0" : "left-1/2 -translate-x-1/2"}`}
                  >
                    {format(c.value)}
                  </span>
                )}
              </span>
            </span>
          );
          return c.href ? (
            <Link key={c.key} href={c.href} prefetch={false} title={c.title} aria-label={c.title} className="flex h-full min-w-0 flex-1 pt-4 hover:opacity-80">
              {bar}
            </Link>
          ) : (
            <div key={c.key} title={c.title} aria-label={c.title} role="img" className="flex h-full min-w-0 flex-1 pt-4">
              {bar}
            </div>
          );
        })}
      </div>
      <div className={`mt-1 flex ${gap} overflow-hidden border-t border-[var(--border)] pt-1`}>
        {columns.map((c, i) => (
          <span key={c.key} className="min-w-0 flex-1 whitespace-nowrap text-center text-[10px] leading-tight text-[var(--muted)] sm:text-[11px]">
            {/* Every nth, leaving off one too close to the end to fit. */}
            {i % labelEvery === 0 && (labelEvery === 1 || i < columns.length - labelEvery / 2) ? c.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

// Sideways bars with the figure at the end: sales by category, and the like.
export function BarList({
  rows,
  format = (n: number) => money(n),
  showShare = true,
}: {
  rows: { label: string; value: number; detail?: string; href?: string }[];
  format?: (n: number) => string;
  showShare?: boolean;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const inside = (
          <>
            <div className="flex items-baseline gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {r.label}
                {r.detail && <span className="ml-1.5 text-xs text-[var(--muted)]">{r.detail}</span>}
              </span>
              {showShare && total > 0 && <span className="text-xs tabular-nums text-[var(--muted)]">{Math.round((Math.max(0, r.value) / total) * 100)}%</span>}
              <span className="w-24 text-right font-semibold tabular-nums">{format(r.value)}</span>
              {r.href && <Chevron />}
            </div>
            <div className="mt-1 h-2 rounded-full bg-[var(--surface-hover)]">
              <div className="rpt-bar-strong h-2 rounded-full" style={{ width: max > 0 ? `${Math.max(1, (Math.max(0, r.value) / max) * 100)}%` : 0 }} />
            </div>
          </>
        );
        return (
          <li key={r.label}>
            {r.href ? (
              <DrillLink href={r.href} className="-mx-1.5 block rounded-md px-1.5 py-0.5 hover:bg-[var(--surface-hover)]">
                {inside}
              </DrillLink>
            ) : (
              inside
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Parts of a whole on one line (cash, card, online), with a key underneath.
export function SplitBar({ parts, format = (n: number) => money(n) }: { parts: { label: string; value: number; href?: string }[]; format?: (n: number) => string }) {
  const shown = parts.filter((p) => p.value > 0.004);
  const total = shown.reduce((s, p) => s + p.value, 0);
  const shades = ["rpt-bar-strong", "rpt-bar-mid", "rpt-bar", "rpt-bar-light"];
  if (total <= 0) return <p className="text-sm text-[var(--muted)]">Nothing yet.</p>;
  // The key goes four across only when its card is wide enough (a
  // container query), so a narrow card in a row of three keeps two.
  return (
    <div className="@container">
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
        {shown.map((p, i) => (
          <div key={p.label} className={shades[i % shades.length]} style={{ width: `${(p.value / total) * 100}%` }} title={`${p.label}: ${format(p.value)}`} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm @md:grid-cols-4">
        {shown.map((p, i) => {
          const inside = (
            <>
              <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
                <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${shades[i % shades.length]}`} />
                {p.label} · {Math.round((p.value / total) * 100)}%{p.href && <Chevron />}
              </div>
              <div className="font-semibold tabular-nums">{format(p.value)}</div>
            </>
          );
          return (
            <li key={p.label} className="min-w-0">
              {p.href ? (
                <DrillLink href={p.href} className="-mx-1.5 block rounded-md px-1.5 py-0.5 hover:bg-[var(--surface-hover)]">
                  {inside}
                </DrillLink>
              ) : (
                inside
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Best sellers, most money first.
export function TopItems({ items }: { items: { name: string; qty: number; revenue: number; options: string; href?: string }[] }) {
  return (
    <ol className="divide-y divide-[var(--border)] text-sm">
      {items.map((it, i) => {
        const inside = (
          <>
            <span className="w-5 shrink-0 text-right text-xs tabular-nums text-[var(--muted)]">{i + 1}</span>
            <span className="min-w-0 flex-1">
              {it.name}
              {it.options && <span className="block truncate text-xs text-[var(--muted)]">{it.options}</span>}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{num(it.qty)} sold</span>
            <span className="w-20 shrink-0 text-right font-semibold tabular-nums">{money(it.revenue)}</span>
            {it.href && <Chevron />}
          </>
        );
        return (
          <li key={it.name}>
            {it.href ? (
              <DrillLink href={it.href} className="-mx-1.5 flex items-baseline gap-3 rounded-md px-1.5 py-2 hover:bg-[var(--surface-hover)]">
                {inside}
              </DrillLink>
            ) : (
              <div className="flex items-baseline gap-3 py-2">{inside}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// Label on the left, figure on the right, one per line.
export function Rows({ rows }: { rows: { label: React.ReactNode; value: React.ReactNode; muted?: boolean; strong?: boolean; key?: string; href?: string }[] }) {
  return (
    <dl className="divide-y divide-[var(--border)] text-sm">
      {rows.map((r, i) => {
        const cls = `flex items-baseline justify-between gap-3 py-1.5 ${r.muted ? "text-[var(--muted)]" : ""} ${r.strong ? "font-semibold" : ""}`;
        return r.href ? (
          // The link is the row (a term and its figure can't sit inside a link).
          <div key={r.key ?? i}>
            <DrillLink href={r.href} className={`${cls} -mx-1.5 rounded-md px-1.5 hover:bg-[var(--surface-hover)]`}>
              <span className="min-w-0">{r.label}</span>
              <span className="flex shrink-0 items-baseline gap-1.5 text-right tabular-nums">
                {r.value}
                <Chevron />
              </span>
            </DrillLink>
          </div>
        ) : (
          <div key={r.key ?? i} className={cls}>
            <dt className="min-w-0">{r.label}</dt>
            <dd className="shrink-0 text-right tabular-nums">{r.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}
