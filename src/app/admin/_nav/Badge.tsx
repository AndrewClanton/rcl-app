import type { NavBadge } from "@/lib/data/backoffice";

// A count on a menu row or a card: plain ink for information, amber for
// something to deal with, red for something broken right now.
export default function Badge({ badge, className = "" }: { badge?: NavBadge | null; className?: string }) {
  if (!badge) return null;
  const tone = badge.tone === "warn" ? "bo-badge-warn" : badge.tone === "danger" ? "bo-badge-danger" : "";
  return (
    <span className={`bo-badge ${tone} ${className}`} title={badge.title}>
      <span aria-hidden>{badge.text}</span>
      <span className="sr-only">{badge.title}</span>
    </span>
  );
}
