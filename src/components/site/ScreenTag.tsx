import { isOutdoorRoom, screenLabel } from "@/lib/showing-visibility";

// Which screen a showing is on, with a small icon: "Outdoor screen · weather
// permitting" (a moon over the patio) or the indoor cinema (a screen).
// Reads the room from the rooms table, never the film's title.
export default function ScreenTag({ room, className = "" }: { room: { key?: string | null; name?: string | null } | null | undefined; className?: string }) {
  const outdoor = isOutdoorRoom(room);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        {outdoor ? (
          <>
            <path d="M15.5 3.5a6 6 0 1 0 5 8.5 5 5 0 0 1-5-8.5z" />
            <path d="M3 21h18M6 21v-4M18 21v-4" />
          </>
        ) : (
          <>
            <rect x="3" y="4" width="18" height="12" rx="1.5" />
            <path d="M8 20h8M12 16v4" />
          </>
        )}
      </svg>
      <span>{screenLabel(room)}</span>
    </span>
  );
}
