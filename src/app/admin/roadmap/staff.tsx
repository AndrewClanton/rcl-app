import type { AdminRoadmapItem } from "@/lib/data/roadmap";
import type { BoardItem } from "@/components/roadmap/board";

// The staff layer on Back office → Roadmap: under each card (drawn by
// components/roadmap/board.tsx) sits a strip with its notes, who asked,
// and the button that opens it.

export function boardItem(item: AdminRoadmapItem, position: number | null = null): BoardItem {
  return {
    status: item.status,
    title: item.title,
    summary: item.summary,
    position,
    updatedAt: item.updatedAt > item.statusChangedAt ? item.updatedAt : item.statusChangedAt,
  };
}

export function lastChange(items: AdminRoadmapItem[]): string | null {
  return items.reduce<string | null>((max, i) => {
    const t = i.updatedAt > i.statusChangedAt ? i.updatedAt : i.statusChangedAt;
    return !max || t > max ? t : max;
  }, null);
}

// The title on a card: tap it to open the item.
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
      {item.internalNotes && (
        <span className="font-semibold text-[var(--foreground)]" title={item.internalNotes}>
          Internal note
        </span>
      )}
      {item.notes.length > 0 && (
        <span className="font-semibold text-[var(--foreground)]">
          {item.notes.length} member note{item.notes.length === 1 ? "" : "s"}
        </span>
      )}
      {requester && <span className="min-w-0 truncate">Asked by {requester}</span>}
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
