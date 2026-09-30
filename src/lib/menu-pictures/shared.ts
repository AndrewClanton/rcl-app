// Menu pictures: the shapes and small helpers the register, the back office
// and the server share. No server or browser code, so any of them can use it.
//
// Every register button shows a picture: a photo someone took or chose, a
// free-to-use photo the server found and stored (Pixabay and Pexels when
// their keys are set, Open Food Facts, Openverse, Wikimedia Commons), a text
// icon ("$5" glowing red: lib/menu-pictures/text-icon.ts, drawn by the app),
// or, when there's none of those, a label tile (the item's name in bold on
// its category's color). A photo is always a file in our own "menu-photos"
// bucket: nothing is shown straight from another site.

import { textIconOf, type TextIcon } from "./text-icon";

export { textIconOf, suggestIconText, type TextIcon } from "./text-icon";

export const PHOTO_TARGETS = ["item", "category"] as const;
export type PhotoTarget = (typeof PHOTO_TARGETS)[number];

export type FoundSource = "pixabay" | "pexels" | "off" | "openverse" | "commons";
export type PictureSource = FoundSource | "upload" | "label" | "text";

export const SOURCE_NAMES: Record<FoundSource, string> = {
  pixabay: "Pixabay",
  pexels: "Pexels",
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
  license: string; // "CC BY 2.0", "CC0 1.0", "Public domain", "Pexels License"
  licenseUrl: string | null;
  page: string | null; // where it came from
  provider: string | null; // Openverse's own source, e.g. "Flickr"
}

// The picture fields on a menu_items or menu_categories row. image_text is
// only read when image_source is 'text' (a photo saved over a text icon
// leaves the old one behind, unused).
export interface PictureState {
  image_url: string | null;
  image_source: PictureSource | null;
  image_credit: PictureCredit | null;
  image_query: string | null;
  image_index: number | null;
  image_approved_at: string | null;
  image_text: TextIcon | null;
}

export const NO_PICTURE: PictureState = {
  image_url: null,
  image_source: null,
  image_credit: null,
  image_query: null,
  image_index: null,
  image_approved_at: null,
  image_text: null,
};

// One search result as the screens see it. The address of the picture on
// its own site stays on the server; the screens load its preview from our
// own /api/menu-pictures/preview, by search and position.
export interface CandidateView {
  source: FoundSource;
  credit: PictureCredit;
}

export type PictureResult = { ok: true; picture: PictureState } | { ok: false; error: string };
// `sources`: the libraries this search asked, so the picker can credit them.
export type SearchResult = { ok: true; query: string; candidates: CandidateView[]; sources: FoundSource[] } | { ok: false; error: string };

export function pictureOf(row: (Partial<Omit<PictureState, "image_text">> & { image_text?: unknown }) | null | undefined): PictureState {
  const source = row?.image_source ?? (row?.image_url ? "upload" : null);
  return {
    image_url: row?.image_url ?? null,
    image_source: source,
    image_credit: row?.image_credit ?? null,
    image_query: row?.image_query ?? null,
    image_index: typeof row?.image_index === "number" ? row.image_index : null,
    image_approved_at: row?.image_approved_at ?? null,
    image_text: source === "text" ? textIconOf(row?.image_text) : null,
  };
}

// The text icon a button shows, if that's what it shows.
export function textIconShown(picture: Pick<PictureState, "image_url" | "image_source" | "image_text">): TextIcon | null {
  return !picture.image_url && picture.image_source === "text" ? picture.image_text : null;
}

export function isFound(source: PictureSource | null | undefined): source is FoundSource {
  return source === "pixabay" || source === "pexels" || source === "off" || source === "openverse" || source === "commons";
}

// "Photo: Jane Doe, CC BY 2.0 via Openverse (Flickr)", or the way Pexels
// and Pixabay ask to be credited. Null for our own photos, text icons and
// the label tile, which need no credit.
export function creditLine(source: PictureSource | null | undefined, credit: PictureCredit | null | undefined): string | null {
  if (!isFound(source) || !credit) return null;
  if (source === "pexels") return `Photo by ${credit.creator || "unknown"} on Pexels`;
  if (source === "pixabay") return `Image by ${credit.creator || "unknown"} from Pixabay`;
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
