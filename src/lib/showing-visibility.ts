// Who a showing is listed for (screenings.visibility, migration
// 20261005020000_screening_visibility.sql):
//   public  -- the website, the lobby TVs, emails: as always.
//   members -- only signed-in members on the website, the members' email,
//              and in-building TVs that already show members-only titles
//              (the ramp). Never the open web: no search markup, no sitemap.
//   private -- a private group's showing (Easter Seals' noon matinee): never
//              listed anywhere outside Back office and the register, and
//              never sold online. Staff ring it up at the register.
// The MPLC rule (mplc.ts) sits on top: an older title is never public,
// whatever its showing says.
//
// No server imports, so client components and plain-node scripts can use it.

export type ShowingVisibility = "public" | "members" | "private";

export const SHOWING_VISIBILITIES: ShowingVisibility[] = ["public", "members", "private"];

export const VISIBILITY_LABEL: Record<ShowingVisibility, string> = {
  public: "Public",
  members: "Members only",
  private: "Private",
};

// Fail closed: anything that isn't a known value (a row read without the
// column, a typo) is treated as private.
export function visibilityOf(s: { visibility?: string | null }): ShowingVisibility {
  const v = s.visibility;
  return v === "public" || v === "members" || v === "private" ? v : "private";
}

// The spreadsheet's naming convention: a suffix on the title says who the
// showing is for, with or without parentheses, any capitalization:
//   "Beetlejuice 2 (member screening)" / "(members only)"            -> members
//   "Beetlejuice 2 (private event do not list)" / "(private)" / "(do not list)" -> private
// The suffix comes off the title, so the film still matches its movie.
const SUFFIX =
  /\s*[-–—:]?\s*[([]?\s*(members?'?\s+screening|members?\s+only|private\s+event(?:[\s,;:–—-]*do\s*n[o']?t\s+list)?|private|do\s*n[o']?t\s+list)\s*[)\]]?\s*$/i;

export function parseShowingTitle(raw: string): { title: string; visibility: ShowingVisibility } {
  const text = raw.trim();
  const m = SUFFIX.exec(text);
  if (!m || m.index === 0) return { title: text, visibility: "public" };
  const what = m[1].toLowerCase();
  // A bare trailing "Private" could be the film's own title ("Saving
  // Private..."), so on its own it needs brackets or a dash: "X (private)",
  // "X - private".
  if (what === "private" && !/[([\-–—:]/.test(m[0])) return { title: text, visibility: "public" };
  return { title: text.slice(0, m.index).trim(), visibility: what.startsWith("member") ? "members" : "private" };
}

// ---------- which screen ----------

// From the rooms table: the patio's outdoor screen is the room whose key or
// name says outdoor. Everything else is the indoor cinema.
export function isOutdoorRoom(room: { key?: string | null; name?: string | null } | null | undefined): boolean {
  if (!room) return false;
  return /outdoor/i.test(room.key ?? "") || /outdoor/i.test(room.name ?? "");
}

export const OUTDOOR_SCREEN_LABEL = "Outdoor screen · weather permitting";

// "Outdoor screen · weather permitting", or the room's own short name
// ("Indoor Cinema").
export function screenLabel(room: { key?: string | null; name?: string | null } | null | undefined): string {
  if (isOutdoorRoom(room)) return OUTDOOR_SCREEN_LABEL;
  return (room?.name ?? "").split(" — ")[0] || "Indoor Cinema";
}
