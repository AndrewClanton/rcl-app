// The shapes behind the three ready-made invite emails (the designs from
// the Design canvas, page "The invites"). No server code.

export const DESIGN_KEYS = ["royale-is-here", "come-in", "press-play"] as const;
export type DesignKey = (typeof DESIGN_KEYS)[number];

export function isDesignKey(v: unknown): v is DesignKey {
  return typeof v === "string" && (DESIGN_KEYS as readonly string[]).includes(v);
}

// One picture, as render.mjs made it: the file in the email-assets bucket
// and its size in CSS pixels (the file itself is 2x, for retina screens).
export interface PieceFile {
  file: string;
  w: number;
  h: number;
  bytes: number;
}

export interface Piece {
  alt: string;
  altPhone?: string;
  d?: PieceFile; // from the 600-wide desktop design
  m?: PieceFile; // from the 390-wide phone design
}

// The per-person pictures (a first name in the picture). The base is the
// picture without the words; the words are drawn on at open time
// (src/app/api/email/art) where `spec` says.
export type ArtKind = "door" | "profile" | "tape";
export const ART_KINDS: ArtKind[] = ["door", "profile", "tape"];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TabletSpec {
  kind: "tablet";
  screen: Box;
  pad: number;
  icon: string; // the icon's SVG markup, from the design
  iconSize: number;
  gap1: number;
  font: { size: number; lh: number; color: string };
  gap2: number;
  bar: { w: number; h: number; color: string };
  lines: string[]; // "{name}, your first", "check-in!"
  none: string[]; // with no first name
}

export interface TapeSpec {
  kind: "tape";
  tape: Box; // the tape's box before it's turned
  angle: number; // degrees
  text: { x: number; y: number; w: number }; // where the name sits inside the tape
  font: { size: number; lh: number; color: string };
}

export interface ArtVariant {
  base: string; // file name in src/lib/email/designs/art
  hash: string;
  w: number;
  h: number;
  ext: "png" | "jpg";
  generic: string; // the no-name version, in the bucket
  spec: TabletSpec | TapeSpec;
}

export type ArtSpec = Partial<Record<"d" | "m", ArtVariant>>;
