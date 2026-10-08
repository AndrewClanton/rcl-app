// Check-in flair: what plays on the customer screen when staff confirm a
// member's check-in (and, gently, on their shared profile page). A member
// picks a favorite color, an entrance effect and, for Floating reactions, a
// sticker, on the Profile tab of their account.
//
// Everything is a key into the catalogs below. That's all the database
// stores and all the register sends to the screen: the screen looks each
// key up here and plays its own animation (components/flair/), so nothing a
// member typed and nothing off the channel is ever drawn as-is. An unknown
// key falls back (classic, the default color, a heart) rather than failing.
//
// No server imports: the account page, the register, the customer screen
// and scripts/check-member-profile.mjs all use it.

export type FlairColorKey = "gold" | "pink" | "red" | "orange" | "lime" | "mint" | "teal" | "sky" | "purple" | "silver";

export interface FlairColor {
  key: FlairColorKey;
  label: string;
  hex: string; // reads on the screen's ink (#14110c), and ink text reads on it
}

// Picked to read on the dark check-in screen: bright, but not so pale that
// the ink type of the check-in banner washes out on them.
export const FLAIR_COLORS: FlairColor[] = [
  { key: "gold", label: "RCL gold", hex: "#ffc72c" },
  { key: "pink", label: "Bubblegum pink", hex: "#ff6fb5" },
  { key: "red", label: "Marquee red", hex: "#ff5a5f" },
  { key: "orange", label: "Tangerine", hex: "#ff9a3c" },
  { key: "lime", label: "Lime", hex: "#b5e853" },
  { key: "mint", label: "Mint", hex: "#5fe3b0" },
  { key: "teal", label: "Teal", hex: "#2ec4c9" },
  { key: "sky", label: "Sky blue", hex: "#6cb8ff" },
  { key: "purple", label: "Purple", hex: "#b58cff" },
  { key: "silver", label: "Silver screen", hex: "#d6dbe3" },
];

// A member who hasn't picked one gets Royale Cinema's own.
export const DEFAULT_FLAIR_COLOR: FlairColor = FLAIR_COLORS[0];

// The free ones everyone can pick, and the ones bought with points
// (lib/rewards.ts PAID_ENTRANCES; a member picks those only once they own
// them, checked on the server).
export type FreeEffectKey = "classic" | "confetti" | "unicorn" | "fireworks" | "reactions";
export type PaidEffectKey = "neon" | "vhs" | "reel" | "arcade" | "popcorn";
export type FlairEffectKey = FreeEffectKey | PaidEffectKey;
// What actually plays: their effect, or the birthday-week party.
export type EntranceKey = FlairEffectKey | "party";

export interface FlairEffect {
  key: FlairEffectKey;
  label: string;
  blurb: string;
  paid?: boolean; // unlocked with points
}

export const FLAIR_EFFECTS: FlairEffect[] = [
  { key: "classic", label: "Classic", blurb: "Royale Cinema's check-in banner, in your color. Nothing flying around." },
  { key: "confetti", label: "Confetti", blurb: "Two confetti cannons, in your color." },
  { key: "unicorn", label: "Unicorn run", blurb: "A unicorn gallops across the screen, trailing sparkles. Its mane is your color." },
  { key: "fireworks", label: "Fireworks", blurb: "A few rockets go up and burst in your color." },
  { key: "reactions", label: "Floating reactions", blurb: "Stickers float up and fade away, like reactions on a live video. Pick yours below." },
  { key: "neon", label: "Neon sign", blurb: "Your name buzzes on in neon, in your color.", paid: true },
  { key: "vhs", label: "VHS static", blurb: "Static and tracking lines, then PLAY.", paid: true },
  { key: "reel", label: "Film reel", blurb: "A film leader counts down 3, 2, 1.", paid: true },
  { key: "arcade", label: "Retro arcade", blurb: "PLAYER 1 READY, in pixels.", paid: true },
  { key: "popcorn", label: "Popcorn rain", blurb: "It rains popcorn.", paid: true },
];

export const FREE_EFFECTS = FLAIR_EFFECTS.filter((e) => !e.paid);

export function isPaidEffect(key: unknown): key is PaidEffectKey {
  return FLAIR_EFFECTS.some((e) => e.paid && e.key === key);
}

export type StickerKey = "heart" | "popcorn" | "star" | "reel" | "ticket" | "sparkle" | "mix";

export interface FlairSticker {
  key: StickerKey;
  label: string;
}

export const FLAIR_STICKERS: FlairSticker[] = [
  { key: "heart", label: "Hearts" },
  { key: "popcorn", label: "Popcorn" },
  { key: "star", label: "Stars" },
  { key: "reel", label: "Film reels" },
  { key: "ticket", label: "Tickets" },
  { key: "sparkle", label: "Sparkles" },
  { key: "mix", label: "A mix" },
];

export const DEFAULT_STICKER: StickerKey = "heart";

export interface Flair {
  color: FlairColor | null; // null: they haven't picked (DEFAULT_FLAIR_COLOR plays)
  effect: FlairEffectKey;
  sticker: StickerKey;
}

// Keys only, for the database and the channel.
export interface FlairKeys {
  color: FlairColorKey | null;
  effect: FlairEffectKey;
  sticker: StickerKey;
}

export const CLASSIC: Flair = { color: null, effect: "classic", sticker: DEFAULT_STICKER };

const COLOR_BY_KEY = new Map<string, FlairColor>(FLAIR_COLORS.map((c) => [c.key, c]));
const EFFECT_KEYS = new Set<string>(FLAIR_EFFECTS.map((e) => e.key));
const STICKER_KEYS = new Set<string>(FLAIR_STICKERS.map((s) => s.key));

export function flairColor(key: unknown): FlairColor | null {
  return typeof key === "string" ? (COLOR_BY_KEY.get(key) ?? null) : null;
}

export function isFlairEffect(key: unknown): key is FlairEffectKey {
  return typeof key === "string" && EFFECT_KEYS.has(key);
}

export function isSticker(key: unknown): key is StickerKey {
  return typeof key === "string" && STICKER_KEYS.has(key);
}

// Anything (a members row's flair_* columns, or the channel's `flair`) as
// flair from the catalogs. Never throws; unknown keys fall back.
export function parseFlair(raw: unknown): Flair {
  if (!raw || typeof raw !== "object") return CLASSIC;
  const r = raw as Record<string, unknown>;
  const color = r.color ?? r.flair_color;
  const effect = r.effect ?? r.flair_effect;
  const sticker = r.sticker ?? r.flair_sticker;
  return {
    color: flairColor(color),
    effect: isFlairEffect(effect) ? effect : "classic",
    sticker: isSticker(sticker) ? sticker : DEFAULT_STICKER,
  };
}

export function flairKeys(f: Flair): FlairKeys {
  return { color: f.color?.key ?? null, effect: f.effect, sticker: f.sticker };
}

export function flairHex(f: Pick<Flair, "color">): string {
  return (f.color ?? DEFAULT_FLAIR_COLOR).hex;
}

// A member with nothing picked: the check-in looks the way it always has.
export function isClassic(f: Flair): boolean {
  return f.effect === "classic" && !f.color;
}

// What plays at a check-in: the birthday party in their birthday week
// (unless they turned it off), their own effect otherwise.
export function entranceFor(f: Flair, partyWeek: boolean): EntranceKey {
  return partyWeek ? "party" : f.effect;
}

export function isEntrance(key: unknown): key is EntranceKey {
  return key === "party" || isFlairEffect(key);
}

// ---------- colors ----------

function channels(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0xffc72c;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

// Part of the way from one color to another (t = 0 is `a`, 1 is `b`).
export function mixHex(a: string, b: string, t: number): string {
  const x = channels(a);
  const y = channels(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

export const tint = (hex: string, t: number) => mixHex(hex, "#ffffff", t);
export const shade = (hex: string, t: number) => mixHex(hex, "#14110c", t);

// "#ff6fb5" -> "255, 111, 181", for rgba() in CSS.
export function rgbTriplet(hex: string): string {
  return channels(hex).join(", ");
}

// Confetti and firework colors built around theirs: the color itself most,
// a lighter and a deeper version, white, and a touch of gold (cream if gold
// is their color).
export function effectPalette(hex: string): string[] {
  const accent = hex.toLowerCase() === DEFAULT_FLAIR_COLOR.hex ? "#f3ecd9" : DEFAULT_FLAIR_COLOR.hex;
  return [hex, hex, tint(hex, 0.45), shade(hex, 0.28), "#ffffff", accent];
}

// Balloons and confetti for the birthday party: theirs plus the house mix.
export function partyPalette(hex: string): string[] {
  return [hex, "#ffc72c", "#ff5a5f", "#6cb8ff", "#5fe3b0", "#ff6fb5", "#b58cff"].filter((c, i, all) => all.indexOf(c) === i);
}

// How long each entrance runs on screen, at most (the component clears
// itself then). Nothing here holds up the check-in: the layers never take
// a tap.
export const ENTRANCE_MS = 3600;
export const STILL_MS = 1800; // the short, still version for reduced motion
