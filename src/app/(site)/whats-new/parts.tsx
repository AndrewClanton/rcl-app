import Link from "next/link";
import type { PublicRoadmapItem } from "@/lib/data/roadmap";
import { canVote } from "@/lib/roadmap";
import { BuildingCard as BuildingCardShell, IdeaCard as IdeaCardShell, QueueCard, ShippedRow as ShippedRowShell } from "@/components/roadmap/board";
import VoteButton from "./VoteButton";

// The pieces What's new and an item's own page are built from. The cards
// themselves are shared with Back office → Roadmap (components/roadmap/
// board.tsx), so the crew's board looks like this one; here they get their
// links, the vote button and the print kit's crop marks. Server components;
// the vote button is the only browser code in them.

export { Credit, LivePulse, SectionHead, StatusTag } from "@/components/roadmap/board";

export interface Viewer {
  signedIn: boolean;
  voted: Set<string>;
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
  return <BuildingCardShell item={item} now={now} title={<ItemLink item={item} />} vote={<Vote item={item} viewer={viewer} />} crop />;
}

// Up next: one numbered row per item, in line order.
export function QueueRow({ item, viewer, now }: { item: PublicRoadmapItem; viewer: Viewer; now: number }) {
  return (
    <li>
      <QueueCard item={item} now={now} title={<ItemLink item={item} />} vote={<Vote item={item} viewer={viewer} />} />
    </li>
  );
}

// Ideas we're considering: compact cards, most wanted first.
export function IdeaCard({ item, viewer }: { item: PublicRoadmapItem; viewer: Viewer }) {
  return <IdeaCardShell item={item} title={<ItemLink item={item} />} vote={<Vote item={item} viewer={viewer} />} />;
}

// Just shipped: a changelog line.
export function ShippedRow({ item }: { item: PublicRoadmapItem }) {
  return <ShippedRowShell item={item} title={<ItemLink item={item} />} />;
}
