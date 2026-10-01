import Link from "next/link";
import type { PublicRoadmapItem } from "@/lib/data/roadmap";
import { STATUS_LABEL, canVote, timeAgo, type RoadmapStatus } from "@/lib/roadmap";
import VoteButton from "./VoteButton";

// The pieces What's new and an item's own page are built from. Server
// components; the vote button is the only browser code in them.

export interface Viewer {
  signedIn: boolean;
  voted: Set<string>;
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

export function SectionHead({ id, kicker, title, count, live = false, children }: { id: string; kicker: string; title: string; count?: number; live?: boolean; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div>
        <div className="flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.12em] text-[var(--muted)] uppercase">
          {live && <LivePulse small />}
          {kicker}
        </div>
        <h2 id={id} className="font-display mt-1 text-3xl leading-tight sm:text-4xl">
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

function Updated({ item, now }: { item: PublicRoadmapItem; now: number }) {
  return (
    <span className="font-mono text-[11px] tracking-[0.04em] text-[var(--muted)] uppercase" title={new Date(item.updatedAt).toLocaleString("en-US", { timeZone: "America/Chicago" })}>
      Updated {timeAgo(item.updatedAt, now)}
    </span>
  );
}

function Vote({ item, viewer, big }: { item: PublicRoadmapItem; viewer: Viewer; big?: boolean }) {
  return <VoteButton itemId={item.id} slug={item.slug} votes={item.votes} voted={viewer.voted.has(item.id)} signedIn={viewer.signedIn} open={canVote(item.status)} big={big} />;
}

function ItemLink({ item, className = "" }: { item: PublicRoadmapItem; className?: string }) {
  return (
    <Link href={`/whats-new/${item.slug}`} className={`hover:text-[var(--accent)] hover:underline ${className}`}>
      {item.title}
    </Link>
  );
}

// Building now: the big cards.
export function BuildingCard({ item, viewer, now }: { item: PublicRoadmapItem; viewer: Viewer; now: number }) {
  return (
    <article className="sheet crop flex flex-col p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2">
          {item.status === "building" && <LivePulse />}
          <StatusTag status={item.status} />
        </span>
        <Updated item={item} now={now} />
      </div>
      <h3 className="font-display mt-4 text-2xl leading-tight text-balance">
        <ItemLink item={item} />
      </h3>
      {item.summary && <p className="mt-2 flex-1 text-[15px] text-[var(--muted)]">{item.summary}</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
        <Credit name={item.credit} />
        <Vote item={item} viewer={viewer} />
      </div>
    </article>
  );
}

// Up next: one numbered row per item, in line order.
export function QueueRow({ item, viewer, now }: { item: PublicRoadmapItem; viewer: Viewer; now: number }) {
  return (
    <li className="sheet flex gap-4 p-4 sm:gap-5 sm:p-5">
      <div className="flex w-14 shrink-0 flex-col items-center sm:w-16">
        <span className="font-display grid h-14 w-14 place-items-center rounded-[4px] border-2 border-[var(--foreground)] bg-[var(--gold)] text-2xl leading-none tabular-nums shadow-[3px_3px_0_var(--foreground)] sm:h-16 sm:w-16 sm:text-3xl">
          #{item.position}
        </span>
        <span className="mt-1.5 font-mono text-[10px] tracking-[0.08em] text-[var(--muted)] uppercase">in line</span>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-xl leading-tight text-balance">
          <ItemLink item={item} />
        </h3>
        {item.summary && <p className="mt-1.5 text-[15px] text-[var(--muted)]">{item.summary}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Vote item={item} viewer={viewer} />
          <Credit name={item.credit} />
          <Updated item={item} now={now} />
        </div>
      </div>
    </li>
  );
}

// Ideas we're considering: compact cards, most wanted first.
export function IdeaCard({ item, viewer }: { item: PublicRoadmapItem; viewer: Viewer }) {
  return (
    <article className="flex flex-col rounded-[6px] border-2 border-dashed border-[var(--foreground)] bg-[var(--surface)] p-4">
      <h3 className="font-display text-lg leading-tight text-balance">
        <ItemLink item={item} />
      </h3>
      {item.summary && <p className="mt-1.5 line-clamp-4 flex-1 text-sm text-[var(--muted)]">{item.summary}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Vote item={item} viewer={viewer} />
        <Credit name={item.credit} className="!text-xs" />
      </div>
    </article>
  );
}

// Just shipped: a changelog line.
export function ShippedRow({ item }: { item: PublicRoadmapItem }) {
  return (
    <li className="flex gap-3 px-4 py-4 sm:px-5">
      <span aria-hidden className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-[var(--foreground)] bg-[var(--gold)] text-xs font-bold">
        ✓
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[17px] leading-snug font-bold">
          <ItemLink item={item} />
        </h3>
        {item.summary && <p className="mt-1 text-[15px] text-[var(--muted)]">{item.summary}</p>}
        {item.credit && <Credit name={item.credit} className="mt-2" />}
      </div>
    </li>
  );
}
