import { STATUS_LABEL, longDate, timeAgo, type RoadmapStatus } from "@/lib/roadmap";

// The pieces What's new (/whats-new) and Back office → Roadmap are both
// drawn with, so the crew's board looks like the one customers see: the
// status tags, the cards, the "#3 in line" tickets, and Just shipped a day
// at a time.
//
// Each card takes its title (a link on What's new, a button in Back office)
// and its "I want this too" spot from the page that draws it, plus `staff`:
// the strip Back office adds under a card. `crop` adds the print kit's crop
// marks, which are for the public site only. No hooks and no server code,
// so a server page and a browser-side screen can both use them.

// What a card needs to know about an item. What's new's items have all of
// it; Back office builds it from its own.
export interface BoardItem {
  status: RoadmapStatus;
  title: string;
  summary: string;
  position: number | null; // "#3 in line", for queued items
  updatedAt: string;
  credit: string | null; // "Jake B.", only with the requester's OK
}

// A red dot that pings: something is happening right now.
export function LivePulse({ small = false }: { small?: boolean }) {
  const size = small ? "h-2.5 w-2.5" : "h-3 w-3";
  return (
    <span className={`relative inline-flex shrink-0 ${size}`} aria-hidden>
      <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-60 motion-safe:animate-ping" />
      <span className={`relative inline-flex rounded-full border-2 border-[var(--foreground)] bg-[var(--accent)] ${size}`} />
    </span>
  );
}

const TAG: Record<RoadmapStatus, string> = {
  idea: "ctag bg-[var(--surface)] !rotate-[-2deg]",
  queued: "ctag ctag-yellow",
  building: "ctag ctag-red",
  reviewing: "ctag ctag-ink",
  live: "ctag ctag-yellow",
  not_doing: "ctag bg-[var(--surface-hover)] text-[var(--muted)]",
};

export function StatusTag({ status, position, className = "" }: { status: RoadmapStatus; position?: number | null; className?: string }) {
  const label = status === "queued" && position ? `#${position} in line` : status === "live" ? "Live ✓" : STATUS_LABEL[status];
  return <span className={`${TAG[status]} !px-2.5 !py-1 !text-[11px] ${className}`}>{label}</span>;
}

// A section's heading: a small kicker over a big title with its count.
// `compact` is a size down, for Back office, where the page's own title
// is smaller than What's new's masthead.
export function SectionHead({
  id,
  kicker,
  title,
  count,
  live = false,
  compact = false,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  count?: number;
  live?: boolean;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`${compact ? "mb-4" : "mb-6"} flex flex-wrap items-end justify-between gap-x-6 gap-y-2`}>
      <div>
        <div className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
          {live && <LivePulse small />}
          {kicker}
        </div>
        <h2 id={id} className={`font-display mt-1 leading-tight ${compact ? "text-2xl sm:text-3xl" : "text-3xl sm:text-4xl"}`}>
          {title}
          {typeof count === "number" && count > 0 && <span className="ml-2 align-middle font-mono text-base text-[var(--muted)] tabular-nums">({count})</span>}
        </h2>
      </div>
      {children}
    </div>
  );
}

export function Credit({ name, className = "" }: { name: string | null; className?: string }) {
  if (!name) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-bold ${className}`}>
      <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full border-2 border-[var(--foreground)] bg-[var(--gold)] text-[10px] leading-none">
        ★
      </span>
      Suggested by {name}
    </span>
  );
}

export function Updated({ at, now }: { at: string; now: number }) {
  return (
    <span className="font-mono text-[11px] tracking-[0.04em] text-[var(--muted)] uppercase" title={new Date(at).toLocaleString("en-US", { timeZone: "America/Chicago" })}>
      Updated {timeAgo(at, now)}
    </span>
  );
}

// ---------- the board at a glance ----------

export function BoardStat({ k, v, href }: { k: string; v: number; href: string }) {
  return (
    <a href={href} className="spec-cell block transition-colors hover:bg-[var(--surface-hover)]">
      <div className="spec-k">{k}</div>
      <div className="font-display text-3xl leading-none tabular-nums sm:text-4xl">{v}</div>
    </a>
  );
}

// "Live board": an ink bar over four counts that jump to their sections.
// `footer` sits under the counts (Back office puts its public/staff-only
// tally there).
export function LiveBoard({ lastUpdate, now, crop = false, footer, children }: { lastUpdate: string | null; now: number; crop?: boolean; footer?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={`sheet ${crop ? "crop" : ""}`}>
      <div className="spec-head rounded-t-[4px]">
        <span className="inline-flex items-center gap-2">
          <LivePulse small />
          Live board
        </span>
        {lastUpdate && <span className="font-mono text-[10.5px] font-normal tracking-[0.06em] normal-case opacity-80">Last change {timeAgo(lastUpdate, now)}</span>}
      </div>
      <div className="spec-grid !grid-cols-2 sm:!grid-cols-4">{children}</div>
      {footer}
    </div>
  );
}

// ---------- the cards ----------

interface CardProps {
  item: BoardItem;
  title: React.ReactNode;
  vote?: React.ReactNode;
  staff?: React.ReactNode;
  crop?: boolean;
  className?: string;
}

// Building now: the big cards.
export function BuildingCard({ item, now, title, vote, staff, crop = false, className = "" }: CardProps & { now: number }) {
  return (
    <article className={`sheet flex flex-col ${crop ? "crop" : ""} ${className}`}>
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2">
            {item.status === "building" && <LivePulse />}
            <StatusTag status={item.status} />
          </span>
          <Updated at={item.updatedAt} now={now} />
        </div>
        <h3 className="font-display mt-4 text-2xl leading-tight text-balance">{title}</h3>
        {item.summary && <p className="mt-2 flex-1 text-[15px] text-[var(--muted)]">{item.summary}</p>}
        {(item.credit || vote) && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
            <Credit name={item.credit} />
            {vote}
          </div>
        )}
      </div>
      {staff}
    </article>
  );
}

// The gold "#3" ticket an item in line wears.
export const QUEUE_TICKET =
  "font-display grid h-14 w-14 place-items-center rounded-[4px] border-2 border-[var(--foreground)] bg-[var(--gold)] text-2xl leading-none tabular-nums shadow-[3px_3px_0_var(--foreground)] sm:h-16 sm:w-16 sm:text-3xl";

// Up next: one numbered row per item, in line order. `ticket` replaces the
// number (Back office's is the drag handle). The page wraps it in an <li>.
export function QueueCard({ item, now, title, vote, staff, ticket, className = "" }: CardProps & { now: number; ticket?: React.ReactNode }) {
  return (
    <div className={`sheet ${className}`}>
      <div className="flex gap-4 p-4 sm:gap-5 sm:p-5">
        {ticket ?? (
          <div className="flex w-14 shrink-0 flex-col items-center sm:w-16">
            <span className={QUEUE_TICKET}>#{item.position}</span>
            <span className="mt-1.5 font-mono text-[10px] tracking-[0.08em] text-[var(--muted)] uppercase">in line</span>
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-xl leading-tight text-balance">{title}</h3>
          {item.summary && <p className="mt-1.5 text-[15px] text-[var(--muted)]">{item.summary}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {vote}
            <Credit name={item.credit} />
            <Updated at={item.updatedAt} now={now} />
          </div>
        </div>
      </div>
      {staff}
    </div>
  );
}

// Ideas we're considering: compact cards, most wanted first.
export function IdeaCard({ item, title, vote, staff, className = "" }: CardProps) {
  return (
    <article className={`flex flex-col rounded-[6px] border-2 border-dashed border-[var(--foreground)] bg-[var(--surface)] ${className}`}>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-display text-lg leading-tight text-balance">{title}</h3>
        {item.summary && <p className="mt-1.5 line-clamp-4 flex-1 text-sm text-[var(--muted)]">{item.summary}</p>}
        {(item.credit || vote) && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            {vote}
            <Credit name={item.credit} className="!text-xs" />
          </div>
        )}
      </div>
      {staff}
    </article>
  );
}

// Just shipped: a changelog line. `mark` replaces the gold tick.
export function ShippedRow({ item, title, staff, mark, className = "" }: CardProps & { mark?: React.ReactNode }) {
  return (
    <li className={`flex gap-3 px-4 py-4 sm:px-5 ${className}`}>
      {mark ?? (
        <span aria-hidden className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-[var(--foreground)] bg-[var(--gold)] text-xs font-bold">
          ✓
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h3 className="text-[17px] leading-snug font-bold">{title}</h3>
        {item.summary && <p className="mt-1 text-[15px] text-[var(--muted)]">{item.summary}</p>}
        {item.credit && <Credit name={item.credit} className="mt-2" />}
        {staff}
      </div>
    </li>
  );
}

// One day of Just shipped: the date on an ink bar, the releases those
// changes went out in beside it, and the day's rows.
export function ShippedDay({ date, releases, crop = false, children }: { date: string; releases: string[]; crop?: boolean; children: React.ReactNode }) {
  return (
    <section className={`sheet ${crop ? "crop" : ""}`} aria-label={longDate(date)}>
      <h3 className="spec-head rounded-t-[4px]">
        <span>{longDate(date)}</span>
        {releases.length > 0 && <span className="font-mono text-[10.5px] font-normal tracking-[0.08em] opacity-70">Release {releases.join(", ")}</span>}
      </h3>
      <ul className="divide-y divide-[var(--border)]">{children}</ul>
    </section>
  );
}
