import type { AdminRoadmapItem } from "@/lib/data/roadmap";
import type { BoardItem } from "@/components/roadmap/board";

// The staff layer on Back office → Roadmap. Each card is drawn the way
// What's new draws it (components/roadmap/board.tsx); under it sits a strip
// only staff see: whether customers see it, member notes, who asked, and
// the button that opens it. Staff-only cards are hatched so they stand
// apart from what's on the public page at a glance.

export function boardItem(item: AdminRoadmapItem, position: number | null = null): BoardItem {
  return {
    status: item.status,
    title: item.title,
    summary: item.summary,
    position,
    updatedAt: item.updatedAt > item.statusChangedAt ? item.updatedAt : item.statusChangedAt,
    credit: item.publicCredit,
  };
}

export function lastChange(items: AdminRoadmapItem[]): string | null {
  return items.reduce<string | null>((max, i) => {
    const t = i.updatedAt > i.statusChangedAt ? i.updatedAt : i.statusChangedAt;
    return !max || t > max ? t : max;
  }, null);
}

// A staff-only card's ground: faint diagonal lines over the card color.
export const STAFF_ONLY_GROUND = "bg-[repeating-linear-gradient(135deg,var(--surface)_0_12px,var(--surface-hover)_12px_14px)]";

export function EyeIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M1.5 10S4.8 4 10 4s8.5 6 8.5 6-3.3 6-8.5 6-8.5-6-8.5-6Z" strokeLinejoin="round" />
      <circle cx="10" cy="10" r="2.5" />
    </svg>
  );
}

export function LockIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <rect x="4" y="9" width="12" height="9" rx="1.5" />
      <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" />
    </svg>
  );
}

// "On the public page" or "Staff only", the same words everywhere.
export function Visibility({ isPublic, className = "" }: { isPublic: boolean; className?: string }) {
  return isPublic ? (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--foreground)] bg-[var(--surface)] px-2.5 py-1 text-xs leading-none font-bold whitespace-nowrap ${className}`}>
      <EyeIcon />
      On the public page
    </span>
  ) : (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--foreground)] px-2.5 py-1 text-xs leading-none font-bold whitespace-nowrap text-[var(--surface)] ${className}`}>
      <LockIcon />
      Staff only
    </span>
  );
}

// Where What's new has "I want this too": how many members want it.
export function VoteTally({ votes, live }: { votes: number; live: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-bold tracking-[0.06em] uppercase tabular-nums ${votes ? "" : "text-[var(--muted)]"}`} title="Members who tapped I want this too">
      <span aria-hidden className="text-sm leading-none">♥</span>
      {votes} {live ? "wanted" : votes === 1 ? "wants" : "want"} this
    </span>
  );
}

// What customers see in that spot, for "As customers see it". A picture of
// the button, not a button: it does nothing here.
export function VoteLook({ votes, open }: { votes: number; open: boolean }) {
  if (!open) {
    if (!votes) return null;
    return (
      <span className="font-mono text-[11px] tracking-[0.06em] text-[var(--muted)] uppercase">
        {votes} {votes === 1 ? "person" : "people"} wanted this
      </span>
    );
  }
  return (
    <span className="inline-flex min-h-10 items-center rounded-[4px] border-2 border-[var(--foreground)] bg-[var(--surface)] px-3 text-[13px] font-bold" aria-label={`I want this too: ${votes}`}>
      <span aria-hidden className="mr-1.5">＋</span>I want this too
      <span className="ml-2 rounded-sm bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[11px] tabular-nums">{votes}</span>
    </span>
  );
}

// The title on a staff card: tap it to open the item.
export function TitleButton({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="text-left text-balance hover:text-[var(--accent)] hover:underline">
      {title}
    </button>
  );
}

function requesterOf(item: AdminRoadmapItem): string | null {
  return item.requester.memberId ? item.requester.memberName : item.requester.name;
}

// The strip under a card. `band` draws it as the card's bottom band (the
// big cards); without it, it's a line inside a row (Just shipped).
// `children` go just before the open button (the queue's arrows).
export function StaffStrip({ item, canEdit, onOpen, band = true, release, children }: { item: AdminRoadmapItem; canEdit: boolean; onOpen: () => void; band?: boolean; release?: string | null; children?: React.ReactNode }) {
  const requester = requesterOf(item);
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[var(--muted)] ${
        band ? "rounded-b-[4px] border-t-2 border-dashed border-[var(--border)] bg-[var(--background)] px-4 py-2.5 sm:px-5" : "mt-3"
      }`}
    >
      <Visibility isPublic={item.isPublic} />
      {item.notes.length > 0 && (
        <span className="font-semibold text-[var(--foreground)]">
          {item.notes.length} member note{item.notes.length === 1 ? "" : "s"}
        </span>
      )}
      {item.internalNotes && (
        <span className="font-semibold text-[var(--foreground)]" title={item.internalNotes}>
          Staff note
        </span>
      )}
      {requester && (
        <span className="min-w-0 truncate">
          Asked by {requester}
          {item.fromSuggestion ? " · from the inbox" : ""}
        </span>
      )}
      {release && <span className="font-mono">v{release}</span>}
      <span className="ml-auto flex items-center gap-2">
        {children}
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--foreground)] hover:border-[var(--foreground)]"
          aria-label={`${canEdit ? "Manage" : "Details for"} ${item.title}`}
        >
          {canEdit ? "Manage" : "Details"}
          <span aria-hidden>›</span>
        </button>
      </span>
    </div>
  );
}
