// Series tags: one optional tag on a showing or a house event (Trivia,
// Horror Month, Midweek Movies...), picked from a short managed list
// (event_series, migration 20261009040000_event_badges.sql; Back office ->
// Badges -> Series tags). Event badges can say "came to Trivia" or "came to
// 5 Trivia nights" with it (lib/badges/attendance.ts).
//
// No server imports: the Showtimes forms, the calendar sync and the
// backfill script use it too.

export const DEFAULT_SERIES = ["Trivia", "Horror Month", "Midweek Movies", "Members' Showing", "Outdoor", "Comedy", "Book Swap"] as const;

export const MEMBERS_SHOWING = "Members' Showing";

// Words in a title that make a built-in tag obvious, besides its own name.
const ALIASES: Record<string, RegExp> = {
  Trivia: /\btrivia\b|\bquiz\b/,
  "Horror Month": /\bhorror month\b|\bhorrorfest\b|\bhalloween horror\b/,
  "Midweek Movies": /\bmid-?week\b/,
  "Members' Showing": /\bmembers?'?\s*(showing|screening|only|night)\b/,
  Outdoor: /\boutdoor\b|\bunder the stars\b|\bpatio (movie|screen)/,
  Comedy: /\bcomedy\b|\bstand-?up\b|\bcomedian/,
  "Book Swap": /\bbook swap\b|\bbook exchange\b/,
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// The tag a title makes obvious, or null. `tags`: the managed list (the
// ones switched on); a tag added by a manager matches by its own name.
// "Trivia Night: 90s Movies" -> Trivia. "Comedy Night" -> Comedy.
export function guessSeries(title: string | null | undefined, tags: readonly string[] = DEFAULT_SERIES): string | null {
  const t = norm(title ?? "");
  if (!t) return null;
  for (const tag of tags) {
    const alias = ALIASES[tag];
    if (alias?.test(t)) return tag;
    const own = norm(tag)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/'/g, "'?");
    if (own.length >= 3 && new RegExp(`\\b${own}\\b`).test(t)) return tag;
  }
  return null;
}

// A tag as typed by a manager: trimmed, single spaces, 2-40 characters.
export function cleanSeriesName(s: unknown): string | null {
  const v = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return v.length >= 2 && v.length <= 40 ? v : null;
}
