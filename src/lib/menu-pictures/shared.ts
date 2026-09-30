// Menu pictures: the shapes and small helpers the register, the back office
// and the server share. No server or browser code, so any of them can use it.
//
// Every register button shows a picture: a photo someone took or chose, a
// free-to-use photo the server found and stored (Open Food Facts, Openverse,
// Wikimedia Commons), or, when there's neither, a label tile (the item's
// name in bold on its category's color). Whatever the source, a picture is
// always a file in our own "menu-photos" bucket: nothing is shown straight
// from another site.

export const PHOTO_TARGETS = ["item", "category"] as const;
export type PhotoTarget = (typeof PHOTO_TARGETS)[number];

export type FoundSource = "off" | "openverse" | "commons";
export type PictureSource = FoundSource | "upload" | "label";

export const SOURCE_NAMES: Record<FoundSource, string> = {
  off: "Open Food Facts",
  openverse: "Openverse",
  commons: "Wikimedia Commons",
};

// Who made a found picture and under what license: enough to credit it
// ("Photo: Jane Doe, CC BY 2.0 via Openverse (Flickr)") and link back.
export interface PictureCredit {
  title: string | null;
  creator: string | null;
  creatorUrl: string | null;
  license: string; // "CC BY 2.0", "CC BY-SA 3.0", "CC0 1.0", "Public domain"
  licenseUrl: string | null;
  page: string | null; // where it came from
  provider: string | null; // Openverse's own source, e.g. "Flickr"
}

// The picture fields on a menu_items or menu_categories row.
export interface PictureState {
  image_url: string | null;
  image_source: PictureSource | null;
  image_credit: PictureCredit | null;
  image_query: string | null;
  image_index: number | null;
  image_approved_at: string | null;
}

export const NO_PICTURE: PictureState = {
  image_url: null,
  image_source: null,
  image_credit: null,
  image_query: null,
  image_index: null,
  image_approved_at: null,
};

// One search result as the screens see it. The address of the picture on
// its own site stays on the server; the screens load its preview from our
// own /api/menu-pictures/preview, by search and position.
export interface CandidateView {
  source: FoundSource;
  credit: PictureCredit;
}

export type PictureResult = { ok: true; picture: PictureState } | { ok: false; error: string };
export type SearchResult = { ok: true; query: string; candidates: CandidateView[] } | { ok: false; error: string };

export function pictureOf(row: Partial<PictureState> | null | undefined): PictureState {
  return {
    image_url: row?.image_url ?? null,
    image_source: row?.image_source ?? (row?.image_url ? "upload" : null),
    image_credit: row?.image_credit ?? null,
    image_query: row?.image_query ?? null,
    image_index: typeof row?.image_index === "number" ? row.image_index : null,
    image_approved_at: row?.image_approved_at ?? null,
  };
}

export function isFound(source: PictureSource | null | undefined): source is FoundSource {
  return source === "off" || source === "openverse" || source === "commons";
}

// "Photo: Jane Doe, CC BY 2.0 via Openverse (Flickr)". Null for our own
// photos and the label tile, which need no credit.
export function creditLine(source: PictureSource | null | undefined, credit: PictureCredit | null | undefined): string | null {
  if (!isFound(source) || !credit) return null;
  const via = SOURCE_NAMES[source] + (credit.provider && credit.provider !== SOURCE_NAMES[source] ? ` (${credit.provider})` : "");
  return `Photo: ${credit.creator || "unknown"}, ${credit.license} via ${via}`;
}

// Where a candidate's preview comes from: our own server, never the source.
export function previewUrl(query: string, index: number): string {
  return `/api/menu-pictures/preview?q=${encodeURIComponent(query)}&i=${index}`;
}

// ---------- label tiles ----------
// Flat colors, like the rest of the brand (no gradients): one per category,
// chosen to read at a glance on the register, with light or dark type to
// match.

export interface Tone {
  bg: string;
  fg: string;
}

const TONES: Record<string, Tone> = {
  food: { bg: "#c2410c", fg: "#fff7ed" },
  candy: { bg: "#be185d", fg: "#fdf2f8" },
  drinks: { bg: "#0e7490", fg: "#ecfeff" },
  coffee: { bg: "#6f4e37", fg: "#fdf6ec" },
  alcohol: { bg: "#4c1d95", fg: "#f5f3ff" },
  beer: { bg: "#b45309", fg: "#fffbeb" },
  wine: { bg: "#7f1d1d", fg: "#fef2f2" },
  cocktails: { bg: "#5b21b6", fg: "#f5f3ff" },
  shots: { bg: "#78350f", fg: "#fffbeb" },
  tickets: { bg: "#ffc72c", fg: "#14110c" },
};

const TONE_ALIASES: Record<string, string> = {
  grub: "food",
  snacks: "food",
  sweet: "candy",
  sweets: "candy",
  rad: "drinks",
  "soft drinks": "drinks",
  caffe: "coffee",
  "coffee bar": "coffee",
  spirits: "alcohol",
  bar: "alcohol",
  "liquor shots": "shots",
  "tickets and events": "tickets",
  events: "tickets",
};

// For a category nobody picked a color for: one of these, the same one
// every time for the same name.
const SPARE_TONES: Tone[] = [
  { bg: "#1d4ed8", fg: "#eff6ff" },
  { bg: "#0f766e", fg: "#f0fdfa" },
  { bg: "#a21caf", fg: "#fdf4ff" },
  { bg: "#b91c1c", fg: "#fef2f2" },
  { bg: "#4d7c0f", fg: "#f7fee7" },
  { bg: "#334155", fg: "#f8fafc" },
];

function toneKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const k = name.toLowerCase().replace(/\s+/g, " ").trim();
  const key = TONE_ALIASES[k] ?? k;
  return TONES[key] ? key : null;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// A subcategory's own color if it has one (Beer, Wine...), else its parent's.
export function labelTone(category?: string | null, parent?: string | null): Tone {
  const key = toneKey(category) ?? toneKey(parent);
  if (key) return TONES[key];
  const name = (parent || category || "menu").toLowerCase();
  return SPARE_TONES[hash(name) % SPARE_TONES.length];
}
