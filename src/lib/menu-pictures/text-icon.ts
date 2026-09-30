// Text icons: a few big characters on a register button instead of a photo
// ("$5" glowing red for the $5 special), for when no picture says it
// better. Drawn by the app (components/menu/TextIcon.tsx), not stored as a
// file, so they're crisp at any size and show instantly. Pure (no server or
// browser code): the register, the back office and the server all use it.
//
// Stored on the row as image_source 'text' with image_text
// { text, color, style, pulse? }: the color and style are names from the
// lists below, never raw CSS, and textIconOf is the one check everything
// saved or shown goes through.

export const TEXT_ICON_MAX = 16;

export type TextIconStyle = "neon" | "block" | "outline";

export const TEXT_ICON_STYLES: { key: TextIconStyle; name: string }[] = [
  { key: "neon", name: "Neon" },
  { key: "block", name: "Block" },
  { key: "outline", name: "Outline" },
];

// Picked to read at a glance on the register. `glow` is the neon glow and
// the outline, `core` the hot middle of neon letters (tinted, so red reads
// as red and not white), `bg`/`ink` the Block style's fill and letters.
// Flat colors, like the rest of the brand.
export const TEXT_ICON_COLORS = {
  red: { name: "Neon red", glow: "#ff3131", core: "#ffc4c4", bg: "#e11d2a", ink: "#ffffff" },
  gold: { name: "Gold", glow: "#ffc72c", core: "#ffe7a0", bg: "#ffc72c", ink: "#14110c" },
  blue: { name: "Electric blue", glow: "#2ec9ff", core: "#c0efff", bg: "#2ec9ff", ink: "#06121c" },
  green: { name: "Green", glow: "#3dff5a", core: "#c4ffcc", bg: "#3dff5a", ink: "#04160a" },
  pink: { name: "Hot pink", glow: "#ff3fb4", core: "#ffc6ea", bg: "#ff3fb4", ink: "#1a0512" },
  white: { name: "White", glow: "#ffffff", core: "#ffffff", bg: "#ffffff", ink: "#111111" },
} as const;

export type TextIconColor = keyof typeof TEXT_ICON_COLORS;
export const TEXT_ICON_COLOR_KEYS = Object.keys(TEXT_ICON_COLORS) as TextIconColor[];

// The tile behind Neon and Outline letters: near-black, flat.
export const TEXT_ICON_DARK = "#0b0b0e";

export interface TextIcon {
  text: string;
  color: TextIconColor;
  style: TextIconStyle;
  pulse?: boolean; // Neon only: the glow slowly breathes
}

// Characters, as people count them (an emoji is one, mostly), and as
// Postgres's char_length counts them (the migration's check agrees).
export function iconTextLength(text: string): number {
  return Array.from(text).length;
}

// Typed text made safe to keep and show: NFKC ("＄５" is "$5"), no control
// or invisible formatting characters (a joiner inside an emoji stays),
// spaces tidied.
export function cleanIconText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .slice(0, 200)
    .normalize("NFKC")
    .replace(/[\p{Cc}\u2028\u2029]/gu, " ")
    .replace(/(?!\u200d)[\p{Cf}\p{Co}\p{Cs}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const has = (o: object, k: unknown) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);

// The one check: a stored or sent text icon, or null when it isn't one.
export function textIconOf(value: unknown): TextIcon | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const text = cleanIconText(v.text);
  const n = iconTextLength(text);
  if (n < 1 || n > TEXT_ICON_MAX) return null;
  if (!has(TEXT_ICON_COLORS, v.color)) return null;
  const style = TEXT_ICON_STYLES.find((s) => s.key === v.style)?.key;
  if (!style) return null;
  const icon: TextIcon = { text, color: v.color as TextIconColor, style };
  if (style === "neon" && v.pulse === true) icon.pulse = true;
  return icon;
}

// What a text icon for an item might say, best first: a price in its name
// ("$5 Special" → "$5"), else its first word.
export function suggestIconText(name: string): string {
  const clean = cleanIconText(name);
  const price = /\$\s?(\d{1,3})(?:\.(\d{2}))?/.exec(clean);
  if (price) return `$${price[1]}${price[2] && price[2] !== "00" ? `.${price[2]}` : ""}`;
  const first = clean.split(" ").find((w) => /[\p{L}\p{N}]/u.test(w)) ?? clean;
  const word = first.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toUpperCase();
  const chars = Array.from(word);
  return (chars.length <= 8 ? chars : chars.slice(0, 6)).join("") || "?";
}

// A few to tap, for the designer: the suggestion, the price, the whole
// name when it's short, and initials.
export function iconTextSuggestions(name: string, price?: number | null): string[] {
  const clean = cleanIconText(name);
  const out = [suggestIconText(clean)];
  if (typeof price === "number" && Number.isInteger(price) && price > 0 && price < 1000) out.push(`$${price}`);
  const noSizes = clean.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  if (noSizes && iconTextLength(noSizes) <= 12) out.push(noSizes);
  const words = noSizes.split(" ").filter((w) => /^\p{L}/u.test(w));
  if (words.length >= 2 && words.length <= 5) out.push(words.map((w) => Array.from(w)[0]).join(""));
  return [...new Set(out)].filter((t) => textIconOf({ text: t, color: "red", style: "neon" })).slice(0, 4);
}

// ---------- fitting the text to the button ----------
// Advance widths of Archivo Black (the brand's display face, read from the
// font file), in em. Anything else counts as a wide letter.
const WIDTH: Record<string, number> = {
  " ": 0.333, "!": 0.333, '"': 0.5, "#": 0.66, $: 0.667, "%": 1, "&": 0.889, "'": 0.278, "(": 0.389, ")": 0.389, "*": 0.556, "+": 0.66, ",": 0.333,
  "-": 0.333, ".": 0.333, "/": 0.278, ":": 0.333, ";": 0.333, "<": 0.66, "=": 0.66, ">": 0.66, "?": 0.611, "@": 0.74, "[": 0.389, "\\": 0.278,
  "]": 0.389, "^": 0.66, _: 0.5, "`": 0.333, "{": 0.389, "|": 0.278, "}": 0.389, "~": 0.66, "¢": 0.667, "€": 0.667, "£": 0.667, "½": 1, "×": 0.66,
  A: 0.778, B: 0.778, C: 0.778, D: 0.778, E: 0.722, F: 0.667, G: 0.833, H: 0.833, I: 0.389, J: 0.667, K: 0.833, L: 0.667, M: 0.944,
  N: 0.833, O: 0.833, P: 0.722, Q: 0.833, R: 0.778, S: 0.722, T: 0.722, U: 0.833, V: 0.778, W: 1, X: 0.778, Y: 0.778, Z: 0.722,
  a: 0.667, b: 0.667, c: 0.667, d: 0.667, e: 0.667, f: 0.389, g: 0.667, h: 0.667, i: 0.333, j: 0.333, k: 0.667, l: 0.333, m: 1,
  n: 0.667, o: 0.667, p: 0.667, q: 0.667, r: 0.444, s: 0.611, t: 0.444, u: 0.667, v: 0.611, w: 0.944, x: 0.667, y: 0.611, z: 0.556,
};
const DIGIT = 0.667;

function charWidth(ch: string): number {
  if (WIDTH[ch] !== undefined) return WIDTH[ch];
  if (/\d/.test(ch)) return DIGIT;
  const base = ch.normalize("NFD")[0];
  if (WIDTH[base] !== undefined) return WIDTH[base]; // é, ñ
  const cp = ch.codePointAt(0) ?? 0;
  if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0; // emoji joiners and variants
  return cp >= 0x2e80 ? 1.15 : 0.8; // emoji and CJK are wide
}

// A "$" that starts a line, before a number, is set small and raised, like
// a price on a sign: the number is what the eye reads. Its size, and how
// far it's lifted (in its own em) so its top meets the top of the digits:
// Archivo Black's "$" reaches 0.756em and its digits 0.688em, so
// (0.688 - 0.756 × 0.58) / 0.58.
export const DOLLAR_SCALE = 0.58;
export const DOLLAR_RAISE = 0.43;

export const raisesDollar = (line: string) => /^\$\d/.test(line);

function lineWidth(line: string): number {
  let w = 0;
  const chars = Array.from(line);
  chars.forEach((ch, i) => (w += charWidth(ch) * (i === 0 && raisesDollar(line) ? DOLLAR_SCALE : 1)));
  return w;
}

// All sizes are a share of the button's width: the text stays inside
// AVAIL of it (room for the glow), one line at most ONE_LINE, two lines at
// most TWO_LINES each.
const AVAIL = 0.8;
const ONE_LINE = 0.66;
const TWO_LINES = 0.42;

export interface IconTextFit {
  lines: string[];
  size: number; // font size as a share of the button's width
}

export function fitIconText(text: string): IconTextFit {
  const t = cleanIconText(text) || "?";
  const one = Math.min(ONE_LINE, AVAIL / Math.max(lineWidth(t), 0.01));
  let best: IconTextFit = { lines: [t], size: one };
  const chars = Array.from(t);
  // Two lines: at a space, or anywhere in one long word that would
  // otherwise be tiny.
  const breaks: number[] = [];
  chars.forEach((ch, i) => ch === " " && breaks.push(i));
  if (!breaks.length && one < 0.13 && chars.length >= 8) for (let i = 3; i <= chars.length - 3; i++) breaks.push(i);
  for (const i of breaks) {
    const a = chars.slice(0, i).join("").trim();
    const b = chars.slice(chars[i] === " " ? i + 1 : i).join("").trim();
    if (!a || !b) continue;
    const size = Math.min(TWO_LINES, AVAIL / Math.max(lineWidth(a), lineWidth(b), 0.01));
    if (size > best.size * 1.1 && (best.lines.length === 1 || size > best.size)) best = { lines: [a, b], size };
  }
  best.size = Math.round(best.size * 1000) / 1000;
  return best;
}
