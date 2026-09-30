import type { ReactNode } from "react";

// A menu category's icon, for the register's category tabs and section
// headings (and beside categories in Back office → Menu): a line drawing of
// what's in it, which reads at tab size where a tiny photo doesn't. Drawn in
// currentColor, in the same style as the back office's own icons
// (src/app/admin/_nav/icons.tsx). Picked by the category's key or label; a
// category nobody drew one for gets a tag.

type IconName = "food" | "candy" | "drinks" | "coffee" | "alcohol" | "beer" | "wine" | "cocktails" | "shots" | "tickets" | "movies" | "other";

const ALIASES: Record<string, IconName> = {
  food: "food",
  grub: "food",
  snacks: "food",
  popcorn: "food",
  candy: "candy",
  sweet: "candy",
  sweets: "candy",
  drinks: "drinks",
  rad: "drinks",
  "soft drinks": "drinks",
  soda: "drinks",
  coffee: "coffee",
  caffe: "coffee",
  "coffee bar": "coffee",
  alcohol: "alcohol",
  spirits: "alcohol",
  bar: "alcohol",
  beer: "beer",
  wine: "wine",
  cocktails: "cocktails",
  cocktail: "cocktails",
  "liquor shots": "shots",
  "liquor-shots": "shots",
  shots: "shots",
  tickets: "tickets",
  "tickets and events": "tickets",
  "tickets-and-events": "tickets",
  events: "tickets",
  movies: "movies",
};

const PATHS: Record<IconName, ReactNode> = {
  // A striped popcorn box, popped corn on top.
  food: (
    <>
      <path d="M5.5 10h13l-1.6 11H7.1z" />
      <path d="M10 10l.4 11M14 10l-.4 11" />
      <path d="M6.5 10a2.2 2.2 0 0 1 2-3.4 2.6 2.6 0 0 1 4.6-1.4 2.4 2.4 0 0 1 4.3 1.6A2 2 0 0 1 17.5 10" />
    </>
  ),
  // A wrapped sweet.
  candy: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M8.6 10 4 7.5v9L8.6 14M15.4 10 20 7.5v9L15.4 14" />
    </>
  ),
  // A fountain cup with its lid and straw.
  drinks: (
    <>
      <path d="M6.5 8.5h11l-1.3 12.5H7.8z" />
      <path d="M5.5 8.5h13" />
      <path d="M12.5 8.5 14.5 3H18" />
    </>
  ),
  // A mug with steam.
  coffee: (
    <>
      <path d="M4.5 10h11v4.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z" />
      <path d="M15.5 11.5h1.8a2.2 2.2 0 0 1 0 4.4h-2.1" />
      <path d="M8 3.5c-.8 1 .8 2 0 3M11.5 3.5c-.8 1 .8 2 0 3" />
    </>
  ),
  // A bottle with a label.
  alcohol: (
    <>
      <path d="M10 2.5h4V6l2 3v11.5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9l2-3z" />
      <path d="M8 12.5h8v5H8z" />
    </>
  ),
  // A beer mug with a head of foam.
  beer: (
    <>
      <path d="M5.5 9h10v11a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1z" />
      <path d="M15.5 11.5h2a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-2" />
      <path d="M5.5 9a2.2 2.2 0 0 1 1.8-3.2 2.8 2.8 0 0 1 4.9-.6A2.3 2.3 0 0 1 15.5 9" />
      <path d="M9 12.5v5M12 12.5v5" />
    </>
  ),
  // A wine glass, poured.
  wine: (
    <>
      <path d="M7.5 3h9l.3 4.5a4.8 4.8 0 0 1-9.6 0z" />
      <path d="M7.4 7h9.2" />
      <path d="M12 12.3V20M8.5 20.5h7" />
    </>
  ),
  // A martini glass with an olive.
  cocktails: (
    <>
      <path d="M4 4.5h16l-8 8.5z" />
      <path d="M12 13v7M8.5 20.5h7" />
      <circle cx="14.5" cy="7.5" r="1.3" />
    </>
  ),
  // Two shot glasses.
  shots: (
    <>
      <path d="M3.5 8h7.5l-1.2 12.5H4.7z" />
      <path d="M13 8h7.5l-1.2 12.5h-5.1z" />
      <path d="M4 12h6.5M13.5 12H20" />
    </>
  ),
  // An admission ticket.
  tickets: (
    <>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V14a2 2 0 0 0 0-4z" />
      <path d="M15 6.5v1.5M15 11v2M15 16v1.5" />
    </>
  ),
  // A strip of film.
  movies: (
    <>
      <path d="M4.5 4h15v16h-15z" />
      <path d="M8.5 4v16M15.5 4v16" />
      <path d="M4.5 8h4M4.5 12h4M4.5 16h4M15.5 8h4M15.5 12h4M15.5 16h4" />
    </>
  ),
  // A price tag.
  other: (
    <>
      <path d="M3.5 12.3V4.5a1 1 0 0 1 1-1h7.8l8.7 8.7a1 1 0 0 1 0 1.4l-7.4 7.4a1 1 0 0 1-1.4 0z" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
};

function iconFor(keyOrLabel: (string | null | undefined)[]): IconName {
  for (const k of keyOrLabel) {
    const name = ALIASES[(k ?? "").toLowerCase().replace(/\s+/g, " ").trim()];
    if (name) return name;
  }
  return "other";
}

export default function CategoryIcon({
  category,
  label,
  size = 22,
  className = "",
}: {
  category?: string | null; // its key ("food")
  label?: string | null; // its name ("Food"), when the key doesn't say
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      {PATHS[iconFor([category, label])]}
    </svg>
  );
}
