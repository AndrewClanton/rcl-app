// Spending points (Andrew, 10/7): the rewards catalog's shared rules and the
// vanity perks' own catalogs. No server imports: the customer screen, the
// register, the account pages and the back office all use it.
//
// The catalog itself (what's offered, at how many points) is a table that
// owners and admins edit in Back office -> Points (reward_catalog,
// migration 20261007020000). A vanity perk there names a slot and a key
// into the lists below, and that key is all the database stores and all
// the channel carries: the screen draws and plays its own version of each,
// so nothing typed is ever shown as-is. An unknown key falls back to the
// house default.
//
// Points are worth about 5¢ each (100 points = $5 off), so a reward is
// priced at what it sells for, at that rate: a $2 popcorn is 40 points.
// Spending never lowers what a member has earned: the points history keeps
// both (member_points_totals splits lifetime earned and spent).

import { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";

export type RewardKind = "good" | "discount" | "perk";
export type PerkSlot =
  "sound" | "entrance" | "frame" | "name_color" | "title" | "mobile";

export const POINT_VALUE = REWARD_VALUE / POINTS_PER_REWARD; // $0.05

// What a reward at `dollars` should cost in points.
export function pointsFor(dollars: number): number {
  return Math.max(1, Math.round(dollars / POINT_VALUE));
}

export const KIND_LABEL: Record<RewardKind, string> = {
  good: "Real goods",
  discount: "Money off",
  perk: "Vanity perk",
};

export const SLOT_LABEL: Record<PerkSlot, string> = {
  sound: "Sign-in sound",
  entrance: "Check-in entrance",
  frame: "Card frame",
  name_color: "Name color",
  title: "Title",
  mobile: "Mobile order sound (coming soon)",
};

export interface PerkOption {
  key: string;
  label: string;
}

// The check-in sound that plays instead of the coin (sounds.ts has each one).
export const PERK_SOUNDS: PerkOption[] = [
  { key: "coin", label: "Arcade coin" },
  { key: "projector", label: "Projector roll" },
  { key: "organ", label: "Theater organ" },
  { key: "warp", label: "Sci-fi warp" },
  { key: "drumroll", label: "Drumroll" },
];

// Entrances bought with points (components/flair/PaidEntrance.tsx plays
// them). The free ones (classic, confetti, unicorn, fireworks, reactions)
// stay everyone's, in lib/flair.ts.
export const PAID_ENTRANCES: PerkOption[] = [
  { key: "neon", label: "Neon sign" },
  { key: "vhs", label: "VHS static" },
  { key: "reel", label: "Film reel" },
  { key: "arcade", label: "Retro arcade" },
  { key: "popcorn", label: "Popcorn rain" },
];

export const CARD_FRAMES: PerkOption[] = [
  { key: "marquee", label: "Gold marquee" },
  { key: "filmstrip", label: "Film strip" },
  { key: "neon", label: "Neon tube" },
  { key: "ticket", label: "Ticket stub" },
];

export const NAME_COLORS: PerkOption[] = [
  { key: "gold", label: "Gold shimmer" },
  { key: "rainbow", label: "Rainbow" },
  { key: "neonpink", label: "Neon pink" },
];

export const TITLES: PerkOption[] = [
  { key: "popcorn_royalty", label: "Popcorn Royalty" },
  { key: "front_row", label: "Front Row Regular" },
  { key: "midnight_monster", label: "Midnight Movie Monster" },
  { key: "cinephile", label: "Certified Cinephile" },
  { key: "booth_boss", label: "Booth Boss" },
  { key: "credits_stayer", label: "Stays for the Credits" },
];

// Mobile ordering isn't built yet: the slot exists so a perk can be listed
// as coming soon.
export const MOBILE_SOUNDS: PerkOption[] = [
  { key: "order_up", label: "Order-up sound" },
];

export const PERK_OPTIONS: Record<PerkSlot, PerkOption[]> = {
  sound: PERK_SOUNDS,
  entrance: PAID_ENTRANCES,
  frame: CARD_FRAMES,
  name_color: NAME_COLORS,
  title: TITLES,
  mobile: MOBILE_SOUNDS,
};

export const PAID_ENTRANCE_KEYS = PAID_ENTRANCES.map((e) => e.key);

export function isPerkSlot(x: unknown): x is PerkSlot {
  return typeof x === "string" && x in PERK_OPTIONS;
}

export function perkOption(slot: PerkSlot, key: unknown): PerkOption | null {
  return typeof key === "string"
    ? (PERK_OPTIONS[slot].find((o) => o.key === key) ?? null)
    : null;
}

// What the member shows on their card and at check-in, of what they own:
// keys only, each checked against the lists above (null: the default).
export interface MemberLook {
  sound: string | null;
  frame: string | null;
  nameColor: string | null;
  title: string | null;
}

export const NO_LOOK: MemberLook = {
  sound: null,
  frame: null,
  nameColor: null,
  title: null,
};

export function parseLook(raw: unknown): MemberLook {
  if (!raw || typeof raw !== "object") return NO_LOOK;
  const r = raw as Record<string, unknown>;
  return {
    sound: perkOption("sound", r.sound ?? r.perk_sound)?.key ?? null,
    frame: perkOption("frame", r.frame ?? r.perk_frame)?.key ?? null,
    nameColor:
      perkOption("name_color", r.nameColor ?? r.perk_name_color)?.key ?? null,
    title: perkOption("title", r.title ?? r.perk_title)?.key ?? null,
  };
}

export function titleLabel(key: string | null | undefined): string | null {
  return perkOption("title", key)?.label ?? null;
}

// ---------- the Spend points list ----------

// One reward, as the customer screen lists it for one member.
// owned: a perk they have ("Yours"); until: when a timed one runs out.
// problem: why they can't have it right now (a limit, out of stock),
// besides not having enough points.
export interface RewardOffer {
  id: string;
  name: string;
  description: string | null;
  kind: RewardKind;
  section: GoodSection | null; // reward_catalog.section, for goods
  slot: PerkSlot | null;
  key: string | null;
  days: number | null;
  points: number;
  alcohol: boolean;
  owned: boolean;
  until: string | null;
  soon: boolean;
  problem: string | null;
}

// Cheapest first; perks they own sink to the bottom of their price.
export function sortOffers<
  T extends { points: number; owned?: boolean; name: string },
>(offers: T[]): T[] {
  return [...offers].sort(
    (a, b) =>
      a.points - b.points ||
      Number(!!a.owned) - Number(!!b.owned) ||
      a.name.localeCompare(b.name),
  );
}

// ---------- sections (Andrew, 10/9) ----------
// Spend points and Back office -> Points both list the catalog in four
// sections, each cheapest first: Money off, Food & drinks, Tickets &
// booths, then Make it yours (the perks, by slot: Sounds, Name colors,
// Titles, Card frames, Entrances). A good's section is
// reward_catalog.section (migration 20261009010000), set in Back office;
// blank, it's guessed from the name: a ticket, booth or pass is Tickets &
// booths, anything else Food & drinks.

export type GoodSection = "food" | "tickets";
export type RewardSection = "money" | GoodSection | "looks";

export const SECTION_ORDER: RewardSection[] = [
  "money",
  "food",
  "tickets",
  "looks",
];
export const SECTION_LABEL: Record<RewardSection, string> = {
  money: "Money off",
  food: "Food & drinks",
  tickets: "Tickets & booths",
  looks: "Make it yours",
};

export function isGoodSection(x: unknown): x is GoodSection {
  return x === "food" || x === "tickets";
}

// The guess for a good with no section set.
export function guessGoodSection(name: string): GoodSection {
  return /ticket|booth|pass|seat|rental/i.test(name) ? "tickets" : "food";
}

export function sectionOf(r: {
  kind: RewardKind;
  section?: string | null;
  name: string;
}): RewardSection {
  if (r.kind === "discount") return "money";
  if (r.kind === "perk") return "looks";
  return isGoodSection(r.section) ? r.section : guessGoodSection(r.name);
}

// The perks' groups, in order.
const LOOK_ORDER: PerkSlot[] = [
  "sound",
  "name_color",
  "title",
  "frame",
  "entrance",
  "mobile",
];
export const LOOK_GROUP_LABEL: Record<PerkSlot, string> = {
  sound: "Sounds",
  name_color: "Name colors",
  title: "Titles",
  frame: "Card frames",
  entrance: "Entrances",
  mobile: "Mobile orders",
};

// "Sound: Drumroll" -> prefix "Sound", rest "Drumroll".
function splitPrefix(name: string): { prefix: string | null; rest: string } {
  const m = /^\s*([^:]{1,24}):\s*(.+)$/.exec(name);
  return m
    ? { prefix: m[1].trim(), rest: m[2].trim() }
    : { prefix: null, rest: name };
}

// A reward's name inside its section: a perk drops its "Sound: " prefix.
export function shortName(r: { kind: RewardKind; name: string }): string {
  return r.kind === "perk" ? splitPrefix(r.name).rest : r.name;
}

export interface RewardGroup<T> {
  key: string;
  label: string | null; // null: the section's only group, no sub-header
  items: T[];
}
export interface RewardSectionList<T> {
  section: RewardSection;
  label: string;
  groups: RewardGroup<T>[];
}

// The list in sections (empty ones left out), each cheapest first. The
// sort is stable, so a list already in order keeps its ties' order.
export function groupRewards<
  T extends {
    kind: RewardKind;
    section?: string | null;
    name: string;
    points: number;
  },
>(items: T[], slotOf: (r: T) => PerkSlot | null): RewardSectionList<T>[] {
  return SECTION_ORDER.flatMap((section): RewardSectionList<T>[] => {
    const list = items
      .filter((r) => sectionOf(r) === section)
      .sort((a, b) => a.points - b.points);
    if (!list.length) return [];
    if (section !== "looks")
      return [
        {
          section,
          label: SECTION_LABEL[section],
          groups: [{ key: section, label: null, items: list }],
        },
      ];
    const groups = new Map<string, RewardGroup<T>>();
    for (const slot of LOOK_ORDER)
      groups.set(slot, { key: slot, label: LOOK_GROUP_LABEL[slot], items: [] });
    for (const r of list) {
      const key = slotOf(r) ?? splitPrefix(r.name).prefix ?? "other";
      if (!groups.has(key))
        groups.set(key, {
          key,
          label: key === "other" ? "More" : key,
          items: [],
        });
      groups.get(key)!.items.push(r);
    }
    return [
      {
        section,
        label: SECTION_LABEL[section],
        groups: [...groups.values()].filter((g) => g.items.length),
      },
    ];
  });
}

// The order line a good becomes: "Reward: Personal popcorn (−40 pts)".
export const REWARD_LINE_PREFIX = "Reward: ";
export function rewardLineName(name: string, points: number): string {
  return `${REWARD_LINE_PREFIX}${name} (−${points} pts)`;
}

// ---------- the channel ----------

// The guest tapped Use on a good (or the $5 off), on the customer screen:
// "reward-add", to the register, which checks it with the server and puts
// it on the order. firstName: the one the screen shows, so a register
// that's moved on to someone else ignores it. The register answers
// "reward-added" (RewardAdded).
export interface RewardAdd {
  id: string; // this tap
  rewardId: string;
  firstName: string;
}

export interface RewardAdded {
  id: string;
  ok: boolean;
  message: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRewardAdd(p: unknown): RewardAdd | null {
  if (!p || typeof p !== "object") return null;
  const a = p as Partial<RewardAdd>;
  if (typeof a.id !== "string" || !a.id || a.id.length > 80) return null;
  if (typeof a.rewardId !== "string" || !UUID.test(a.rewardId)) return null;
  if (typeof a.firstName !== "string" || !a.firstName) return null;
  return {
    id: a.id,
    rewardId: a.rewardId,
    firstName: a.firstName.slice(0, 60),
  };
}

export function parseRewardAdded(p: unknown): RewardAdded | null {
  if (!p || typeof p !== "object") return null;
  const a = p as Partial<RewardAdded>;
  if (typeof a.id !== "string" || typeof a.ok !== "boolean") return null;
  return {
    id: a.id,
    ok: a.ok,
    message: typeof a.message === "string" ? a.message.slice(0, 160) : "",
  };
}

export function isUuid(x: unknown): x is string {
  return typeof x === "string" && UUID.test(x);
}
