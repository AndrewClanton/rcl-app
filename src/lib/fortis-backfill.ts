// Points for card purchases made before the new system: the rules, in one
// place. No server imports: the loader script (scripts/load-fortis-cards.mjs),
// the Back office screen and scripts/check-fortis-backfill.mjs all use it.
//
// Before mid-September 2026 the Royale took cards through Fortis. Its export
// has one row per card transaction. We keep one row per card (fortis_cards),
// keyed by the card's first six and last four digits -- never more of the
// number -- with what it spent and the days it was used, then match each
// card to a member:
//   1. the email given with the payment equals a member's email,
//   2. the phone given with the payment equals a member's 10-digit phone,
//   3. the name on the card equals exactly one member's name.
// Several members with that name: "needs a pick". No match: "unclaimed",
// kept for when someone claims the card. A card that points at two
// different members needs a pick. Several cards can belong to one member;
// their totals add up. Erased members are never matched.
//
// Nothing is granted here: an owner or admin reviews the matches and presses
// Grant (grant_fortis_backfill in the database writes one points-history row
// per member).

import { SALES_TAX_RATE } from "@/lib/sales-tax";

// ---------- the export ----------

// Fortis status and type ids, as they appear in the export.
//   status 101 Approved, 111 Refunded, 201 Voided, 301 Declined
//   type 20 Sale, 30 Refund
// A sale that's voided later keeps type 20 but turns status 201 (its amount
// goes to 0): it never settled, so it doesn't count. A refund is its own row
// (type 30, status 111) with a positive amount, taken off the card's total.
export const FORTIS_STATUS = { approved: "101", refunded: "111", voided: "201", declined: "301" } as const;
export const FORTIS_TYPE = { sale: "20", refund: "30" } as const;

export type FortisRowKind = "sale" | "refund" | "voided" | "declined" | "other";

export function classifyFortisRow(statusId: string, typeId: string): FortisRowKind {
  const s = statusId.trim();
  const t = typeId.trim();
  if (s === FORTIS_STATUS.declined) return "declined";
  if (s === FORTIS_STATUS.voided) return "voided";
  if (t === FORTIS_TYPE.sale && s === FORTIS_STATUS.approved) return "sale";
  if (t === FORTIS_TYPE.refund && (s === FORTIS_STATUS.refunded || s === FORTIS_STATUS.approved)) return "refund";
  return "other";
}

// What a row counts for, in dollars: the subtotal where the export has one,
// otherwise the amount charged. (In the Royale's export the subtotal only
// appears from May 2026, and always equals the amount charged: Fortis wasn't
// told the tax separately, so both include sales tax. GrantSettings.taxOut
// takes it out.)
export function rowDollars(subtotal: string, amount: string): number {
  const sub = Number(subtotal);
  if (subtotal.trim() !== "" && Number.isFinite(sub) && sub > 0) return sub;
  const amt = Number(amount);
  return Number.isFinite(amt) && amt > 0 ? amt : 0;
}

// "09/21/2026 07:15:03 PM CDT" -> the instant, and the business date it
// belongs to (4 a.m. to 4 a.m. Central: a 1 a.m. drink is the night before).
// The export writes Central wall-clock time with CDT or CST after it.
export function parseFortisTimestamp(s: string): { iso: string; businessDate: string } | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ([AP])M (CDT|CST)$/i);
  if (!m) return null;
  const [, mo, d, y, hh, mi, ss, ap, zone] = m;
  const hour = (Number(hh) % 12) + (ap.toUpperCase() === "P" ? 12 : 0);
  const offset = zone.toUpperCase() === "CDT" ? 5 : 6; // hours behind UTC
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), hour, Number(mi), Number(ss));
  if (Number.isNaN(wall)) return null;
  const iso = new Date(wall + offset * 3_600_000).toISOString();
  const businessDate = new Date(wall - 4 * 3_600_000).toISOString().slice(0, 10);
  return { iso, businessDate };
}

// RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// The card's first six and last four, as one key. Anything else is refused:
// we never keep more of a card number than this.
export function cardKey(firstSix: string, lastFour: string): string | null {
  const a = firstSix.trim();
  const b = lastFour.trim();
  return /^\d{6}$/.test(a) && /^\d{4}$/.test(b) ? a + b : null;
}

// ---------- names ----------

const TITLES = new Set(["mr", "mrs", "ms", "miss", "mx", "dr"]);
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
// Names a card carries when it isn't a person's: a tap usually sends
// "CARDHOLDER/VISA", and gift and prepaid cards say so.
const GENERIC = /\b(card ?holder|customer|valued|gift|prepaid|instant issue|branded|debit|credit card|visa|mastercard|discover|amex|contactless|paywave)\b/;

// Everyday short forms that aren't just the start of the name (those --
// Chris for Christopher, Matt for Matthew -- are caught without a list).
const NICKNAMES: Record<string, string[]> = {
  jacob: ["jake"],
  james: ["jim", "jimmy", "jamie"],
  william: ["bill", "billy", "willie", "liam"],
  robert: ["bob", "bobby", "robbie", "bert"],
  michael: ["mike", "mikey", "mick"],
  thomas: ["tom", "tommy"],
  richard: ["rick", "ricky", "dick", "rich", "richie"],
  john: ["jack"],
  jonathan: ["jack", "johnny"],
  joseph: ["joe", "joey"],
  anthony: ["tony"],
  andrew: ["andy", "drew"],
  katherine: ["kate", "katie", "kathy"],
  kathryn: ["kate", "katie", "kathy"],
  catherine: ["cathy", "kate", "katie"],
  elizabeth: ["liz", "lizzie", "beth", "betsy", "libby", "eliza"],
  margaret: ["meg", "maggie", "peggy"],
  rebecca: ["becky", "becca"],
  patricia: ["patty", "trish", "tricia"],
  victoria: ["vicky", "tori"],
  cynthia: ["cindy"],
  edward: ["ed", "eddie", "ted", "ned"],
  theodore: ["ted", "teddy"],
  charles: ["charlie", "chuck"],
  henry: ["hank", "harry"],
  harold: ["harry", "hal"],
  lawrence: ["larry"],
  gerald: ["jerry"],
  jerome: ["jerry"],
  stephen: ["steve"],
  susan: ["sue", "suzy", "susie"],
  deborah: ["debbie"],
  debra: ["debbie"],
  daniel: ["danny"],
  david: ["dave", "davey"],
  donald: ["donnie"],
  kenneth: ["kenny"],
  timothy: ["timmy"],
  ronald: ["ronnie"],
  nathan: ["nate"],
  nathaniel: ["nate"],
  francis: ["frank"],
  frederick: ["freddie"],
  abigail: ["abby"],
  amanda: ["mandy"],
  eugene: ["gene"],
  samuel: ["sammy"],
  samantha: ["sammy"],
  benjamin: ["benny"],
  nicholas: ["nicky"],
  zachary: ["zack"],
  jennifer: ["jenny"],
  jessica: ["jessie"],
  allison: ["allie", "ally"],
  madison: ["maddie"],
  gabriel: ["gabe"],
  leonard: ["len", "lenny"],
  angela: ["angie"],
  melissa: ["missy"],
  christina: ["tina"],
  alexandra: ["lexi"],
};
const NICK_PAIRS = new Set(Object.entries(NICKNAMES).flatMap(([full, nicks]) => nicks.flatMap((n) => [`${full}|${n}`, `${n}|${full}`])));

// Could two different first names be the same person? Chris and Christopher
// (one starts the other, 3 letters or more), or a short form on the list.
export function similarFirstNames(a: string, b: string): boolean {
  if (a === b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.startsWith(short)) return true;
  return NICK_PAIRS.has(`${a}|${b}`);
}

// Lowercase words with accents, apostrophes and punctuation gone.
function words(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .toLowerCase()
    .replace(/['\u2019`]/g, "")
    .replace(/[^a-z]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function stripTitlesAndSuffixes(ws: string[]): string[] {
  const out = [...ws];
  while (out.length > 2 && TITLES.has(out[0])) out.shift();
  while (out.length > 2 && SUFFIXES.has(out[out.length - 1])) out.pop();
  return out;
}

export interface NormalizedName {
  display: string; // "John A Smith": for staff screens, never matched on
  key: string | null; // "john smith": first and last word, what matching compares
  full: string | null; // "john a smith": every word but titles and suffixes, for confidence
}

// A name as people write it ("John Smith Jr.", "Smith, John") or as a card
// carries it ("SMITH/JOHN A", "SMITH/JOHN A.MR"), reduced to its first and
// last word. Middle names and initials, case, punctuation, titles and Jr/Sr
// don't matter. No key for a single word, an initial for a first or last
// name, or a card's stand-in name ("VALUED CUSTOMER").
export function normalizeName(raw: string | null | undefined): NormalizedName {
  const none: NormalizedName = { display: "", key: null, full: null };
  let s = (raw ?? "").trim();
  if (!s) return none;
  if (s.includes("/")) {
    // Card track format: LAST/FIRST MIDDLE.TITLE
    const at = s.indexOf("/");
    const last = s.slice(0, at);
    const rest = s.slice(at + 1).replace(/\.\s*(mr|mrs|ms|miss|dr)\.?\s*$/i, "");
    s = `${rest} ${last}`;
  } else if (s.includes(",")) {
    const at = s.indexOf(",");
    const before = s.slice(0, at);
    const after = s.slice(at + 1);
    const afterWords = words(after);
    // "John Smith, Jr." keeps its order; "Smith, John" turns around.
    s = afterWords.length && afterWords.every((w) => SUFFIXES.has(w)) ? `${before} ${after}` : `${after} ${before}`;
  }
  const ws = stripTitlesAndSuffixes(words(s));
  if (!ws.length) return none;
  const display = ws.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  if (GENERIC.test(ws.join(" "))) return { display, key: null, full: null };
  const first = ws[0];
  const last = ws[ws.length - 1];
  if (ws.length < 2 || first.length < 2 || last.length < 2) return { display, key: null, full: null };
  return { display, key: `${first} ${last}`, full: ws.join(" ") };
}

// Two names with the same first and last word: do the middles fit? Yes when
// either has none, or each middle word starts the same as the other's
// ("John A Smith" and "John Allen Smith"). "John A Smith" and "John B Smith"
// don't.
export function middlesFit(fullA: string, fullB: string): boolean {
  const a = fullA.split(" ").slice(1, -1);
  const b = fullB.split(" ").slice(1, -1);
  if (!a.length || !b.length) return true;
  if (a.length !== b.length) return a[0][0] === b[0][0];
  return a.every((w, i) => w.startsWith(b[i]) || b[i].startsWith(w));
}

// The 10-digit phone, from however it was written. Null if it isn't one.
export function phoneDigits10(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
}

export function cleanEmail(raw: string | null | undefined): string | null {
  const e = (raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) ? e : null;
}

// ---------- one row per card ----------

export interface FortisRow {
  statusId: string;
  typeId: string;
  firstSix: string;
  lastFour: string;
  holderName: string;
  amount: string;
  subtotal: string;
  createdTs: string;
  email: string;
  phone: string;
  brand: string;
}

export interface CardAggregate {
  cardKey: string;
  brand: string | null;
  holderName: string | null; // the name it carried most, cleaned up
  nameKeys: string[]; // every name it carried, most used first
  nameFulls: string[]; // the same names with middle initials, for "exact"
  email: string | null;
  phone: string | null;
  saleCount: number;
  refundCount: number;
  salesTotal: number;
  refundsTotal: number;
  firstAt: string | null;
  lastAt: string | null;
  visitDates: string[]; // distinct business dates with an approved sale, oldest first
}

export interface AggregateStats {
  rows: number;
  sales: number;
  refunds: number;
  voided: number;
  declined: number;
  other: number;
  noCard: number;
  badDate: number;
  salesDollars: number;
  refundDollars: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

function mostCommon<T>(counts: Map<T, number>): T[] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

export function aggregateFortisRows(rows: FortisRow[]): { cards: CardAggregate[]; stats: AggregateStats } {
  const stats: AggregateStats = { rows: rows.length, sales: 0, refunds: 0, voided: 0, declined: 0, other: 0, noCard: 0, badDate: 0, salesDollars: 0, refundDollars: 0 };
  interface Acc {
    brand: Map<string, number>;
    display: Map<string, number>;
    keys: Map<string, number>;
    fulls: Map<string, number>;
    emails: Map<string, number>;
    phones: Map<string, number>;
    saleCount: number;
    refundCount: number;
    salesTotal: number;
    refundsTotal: number;
    firstAt: string | null;
    lastAt: string | null;
    dates: Set<string>;
  }
  const byCard = new Map<string, Acc>();
  const bump = (m: Map<string, number>, k: string | null) => {
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  };

  for (const r of rows) {
    const kind = classifyFortisRow(r.statusId, r.typeId);
    if (kind === "voided" || kind === "declined" || kind === "other") {
      stats[kind]++;
      continue;
    }
    const key = cardKey(r.firstSix, r.lastFour);
    if (!key) {
      stats.noCard++;
      continue;
    }
    const when = parseFortisTimestamp(r.createdTs);
    if (!when) {
      stats.badDate++;
      continue;
    }
    const acc: Acc = byCard.get(key) ?? {
      brand: new Map(),
      display: new Map(),
      keys: new Map(),
      fulls: new Map(),
      emails: new Map(),
      phones: new Map(),
      saleCount: 0,
      refundCount: 0,
      salesTotal: 0,
      refundsTotal: 0,
      firstAt: null,
      lastAt: null,
      dates: new Set(),
    };
    byCard.set(key, acc);
    const dollars = rowDollars(r.subtotal, r.amount);
    if (kind === "refund") {
      stats.refunds++;
      stats.refundDollars += dollars;
      acc.refundCount++;
      acc.refundsTotal += dollars;
      continue;
    }
    stats.sales++;
    stats.salesDollars += dollars;
    acc.saleCount++;
    acc.salesTotal += dollars;
    acc.dates.add(when.businessDate);
    if (!acc.firstAt || when.iso < acc.firstAt) acc.firstAt = when.iso;
    if (!acc.lastAt || when.iso > acc.lastAt) acc.lastAt = when.iso;
    bump(acc.brand, r.brand.trim().toLowerCase() || null);
    const n = normalizeName(r.holderName);
    if (n.key) {
      bump(acc.display, n.display);
      bump(acc.keys, n.key);
      bump(acc.fulls, n.full);
    }
    bump(acc.emails, cleanEmail(r.email));
    bump(acc.phones, phoneDigits10(r.phone));
  }

  const cards: CardAggregate[] = [];
  for (const [key, a] of byCard) {
    if (a.saleCount === 0) continue; // a refund with no sale on file: nothing to credit
    cards.push({
      cardKey: key,
      brand: mostCommon(a.brand)[0] ?? null,
      holderName: mostCommon(a.display)[0] ?? null,
      nameKeys: mostCommon(a.keys),
      nameFulls: mostCommon(a.fulls),
      email: mostCommon(a.emails)[0] ?? null,
      phone: mostCommon(a.phones)[0] ?? null,
      saleCount: a.saleCount,
      refundCount: a.refundCount,
      salesTotal: cents(a.salesTotal),
      refundsTotal: cents(a.refundsTotal),
      firstAt: a.firstAt,
      lastAt: a.lastAt,
      visitDates: [...a.dates].sort(),
    });
  }
  stats.salesDollars = cents(stats.salesDollars);
  stats.refundDollars = cents(stats.refundDollars);
  cards.sort((x, y) => (x.cardKey < y.cardKey ? -1 : 1));
  return { cards, stats };
}

// ---------- matching ----------

export interface MemberForMatch {
  id: string;
  name: string;
  email: string | null;
  phoneDigits: string | null;
  erased: boolean;
}

export interface MemberIndex {
  byEmail: Map<string, string[]>;
  byPhone: Map<string, string[]>;
  byName: Map<string, string[]>;
  byLastName: Map<string, { first: string; id: string }[]>;
  fullName: Map<string, string | null>; // member id -> normalized full name
}

export function buildMemberIndex(members: MemberForMatch[]): MemberIndex {
  const idx: MemberIndex = { byEmail: new Map(), byPhone: new Map(), byName: new Map(), byLastName: new Map(), fullName: new Map() };
  const add = (m: Map<string, string[]>, k: string | null, id: string) => {
    if (!k) return;
    const list = m.get(k) ?? [];
    if (!list.includes(id)) list.push(id);
    m.set(k, list);
  };
  for (const m of members) {
    if (m.erased) continue; // never matched
    const n = normalizeName(m.name);
    add(idx.byEmail, cleanEmail(m.email), m.id);
    add(idx.byPhone, phoneDigits10(m.phoneDigits), m.id);
    add(idx.byName, n.key, m.id);
    idx.fullName.set(m.id, n.full);
    if (n.key) {
      const [first, last] = n.key.split(" ");
      idx.byLastName.set(last, [...(idx.byLastName.get(last) ?? []), { first, id: m.id }]);
    }
  }
  return idx;
}

export type MatchStatus = "matched" | "needs_pick" | "unclaimed";
// For a match: what matched. For "needs a pick": why -- email, phone or
// name (more than one member fits), or similar (no exact name, but a
// member with the same last name goes by a short form of it, like Jake for
// Jacob: never matched on its own, a person confirms). "picked": chosen by
// staff in Back office.
export type MatchKind = "email" | "phone" | "name" | "similar" | "picked";
// high: email or phone, or the name on the card and the member's agree all
// the way through (a middle initial on one side only is fine). medium: the
// middle names disagree ("John A Smith" and "John B Smith"), or the card
// carried more than one name. "Approve all exact matches" takes high only.
export type MatchConfidence = "high" | "medium";

export interface MatchResult {
  status: MatchStatus;
  kind: MatchKind | null;
  confidence: MatchConfidence | null;
  memberId: string | null;
  candidates: string[]; // for needs_pick: who it could be
}

export interface CardForMatch {
  email: string | null;
  phone: string | null;
  nameKeys: string[];
  nameFulls: string[];
}

const UNCLAIMED: MatchResult = { status: "unclaimed", kind: null, confidence: null, memberId: null, candidates: [] };

function pick(kind: MatchKind, candidates: Iterable<string>): MatchResult {
  return { status: "needs_pick", kind, confidence: null, memberId: null, candidates: [...new Set(candidates)].sort() };
}

export function matchCard(card: CardForMatch, idx: MemberIndex): MatchResult {
  // 1-2. Email, then phone. Both point somewhere: they have to agree.
  const byEmail = card.email ? (idx.byEmail.get(cleanEmail(card.email) ?? "") ?? []) : [];
  const phone = phoneDigits10(card.phone);
  const byPhone = phone ? (idx.byPhone.get(phone) ?? []) : [];
  if (byEmail.length || byPhone.length) {
    const all = [...new Set([...byEmail, ...byPhone])];
    if (all.length === 1) return { status: "matched", kind: byEmail.length ? "email" : "phone", confidence: "high", memberId: all[0], candidates: [] };
    return pick(byEmail.length ? "email" : "phone", all);
  }
  // 3. The name on the card. Every name it carried counts (a card can show
  // up with and without a middle initial); they all have to lead to one member.
  const ids = new Set<string>();
  for (const k of card.nameKeys) for (const id of idx.byName.get(k) ?? []) ids.add(id);
  if (ids.size === 0) {
    // No exact name: a member with the same last name who goes by a short
    // form of the first is worth a look, never a match by itself.
    const similar = new Set<string>();
    for (const k of card.nameKeys) {
      const [first, last] = k.split(" ");
      for (const m of idx.byLastName.get(last) ?? []) if (similarFirstNames(first, m.first)) similar.add(m.id);
    }
    return similar.size ? pick("similar", similar) : UNCLAIMED;
  }
  if (ids.size > 1) return pick("name", ids);
  const [memberId] = [...ids];
  const memberFull = idx.fullName.get(memberId) ?? null;
  const oneName = card.nameKeys.length === 1;
  const fits = !!memberFull && card.nameFulls.length > 0 && card.nameFulls.every((f) => middlesFit(f, memberFull));
  return { status: "matched", kind: "name", confidence: oneName && fits ? "high" : "medium", memberId, candidates: [] };
}

// ---------- stored matches ----------

export type CardDecision = "pending" | "approved" | "skipped";

// What fortis_cards keeps about a card's match (snake_case, as stored).
export interface StoredMatch {
  decision: CardDecision;
  match_status: MatchStatus;
  match_kind: MatchKind | null;
  match_confidence: MatchConfidence | null;
  matched_member_id: string | null;
  candidate_member_ids: string[];
  matched_at: string | null;
  granted_at: string | null;
  erased_at: string | null;
}

// Whether matching may (re)decide a card: never once granted, never after
// its member's info was removed, never over a person's approve, skip or
// pick -- unless the member that decision pointed at is gone.
export function shouldRematch(r: Pick<StoredMatch, "decision" | "matched_member_id" | "granted_at" | "erased_at">): boolean {
  if (r.granted_at || r.erased_at) return false;
  if (r.decision === "pending") return true;
  return r.decision === "approved" && !r.matched_member_id;
}

export function sameMatch(r: Pick<StoredMatch, "decision" | "match_status" | "match_kind" | "match_confidence" | "matched_member_id" | "candidate_member_ids">, m: MatchResult): boolean {
  return (
    r.decision === "pending" &&
    r.match_status === m.status &&
    r.match_kind === m.kind &&
    r.match_confidence === m.confidence &&
    r.matched_member_id === m.memberId &&
    [...(r.candidate_member_ids ?? [])].sort().join() === m.candidates.join()
  );
}

// The columns to write for a fresh automatic match.
export function matchColumns(m: MatchResult, nowIso: string, previousMatchedAt: string | null = null) {
  return {
    match_status: m.status,
    match_kind: m.kind,
    match_confidence: m.confidence,
    matched_member_id: m.memberId,
    candidate_member_ids: m.candidates,
    matched_at: m.status === "matched" ? (previousMatchedAt ?? nowIso) : null,
    decision: "pending" as CardDecision,
    decided_by: null,
    decided_at: null,
  };
}

// ---------- points ----------

export interface GrantSettings {
  rate: number; // points per $1
  cap: number | null; // most points one member can get from this, all grants together
  taxOut: boolean; // count dollars before sales tax, the way points work today
}

// 1 point per $1 before tax, the same as a purchase today; no cap.
export const DEFAULT_GRANT_SETTINGS: GrantSettings = { rate: 1, cap: null, taxOut: true };

export const BACKFILL_NOTE = "Points from card purchases before the new system";

export function validSettings(s: GrantSettings): boolean {
  return Number.isFinite(s.rate) && s.rate > 0 && s.rate <= 10 && (s.cap === null || (Number.isFinite(s.cap) && s.cap >= 0 && s.cap <= 100_000));
}

// Whole points for a member's dollars, before any cap.
export function pointsForDollars(dollars: number, s: GrantSettings): number {
  const base = Math.max(0, dollars) / (s.taxOut ? 1 + SALES_TAX_RATE : 1);
  // The tiny epsilon keeps $10.50 at 1/pt from rounding down on float error.
  return Math.round(base * s.rate + 1e-9);
}

// A member's points with the cap applied, counting what earlier grants gave.
export function cappedPoints(dollars: number, s: GrantSettings, alreadyGranted = 0): number {
  const p = pointsForDollars(dollars, s);
  if (s.cap === null) return p;
  return Math.max(0, Math.min(p, Math.floor(s.cap) - alreadyGranted));
}

export interface PlanCard {
  id: string;
  memberId: string;
  dollars: number; // net: sales less refunds
}

export interface PlanMember {
  memberId: string;
  dollars: number;
  points: number;
  cards: { id: string; points: number }[]; // each card's share; adds up to points
}

// One entry per member: their cards' dollars added up, turned into points,
// capped, and split back across the cards (largest share last takes the
// rounding) so each card records what it gave. A card with nothing left
// after refunds gives 0 but is still marked granted.
export function planGrant(cards: PlanCard[], s: GrantSettings, alreadyGranted: Map<string, number> = new Map()): PlanMember[] {
  const byMember = new Map<string, PlanCard[]>();
  for (const c of cards) byMember.set(c.memberId, [...(byMember.get(c.memberId) ?? []), c]);
  const plan: PlanMember[] = [];
  for (const [memberId, list] of byMember) {
    const dollars = cents(list.reduce((sum, c) => sum + Math.max(0, c.dollars), 0));
    const points = cappedPoints(dollars, s, alreadyGranted.get(memberId) ?? 0);
    const sorted = [...list].sort((a, b) => Math.max(0, a.dollars) - Math.max(0, b.dollars) || (a.id < b.id ? -1 : 1));
    let left = points;
    const shares = sorted.map((c, i) => {
      const share = i === sorted.length - 1 ? left : dollars > 0 ? Math.floor((points * Math.max(0, c.dollars)) / dollars) : 0;
      left -= share;
      return { id: c.id, points: share };
    });
    plan.push({ memberId, dollars, points, cards: shares });
  }
  plan.sort((a, b) => b.points - a.points || (a.memberId < b.memberId ? -1 : 1));
  return plan;
}

export function planTotals(plan: PlanMember[]): { members: number; points: number; dollars: number } {
  return {
    members: plan.filter((p) => p.points > 0).length,
    points: plan.reduce((s, p) => s + p.points, 0),
    dollars: cents(plan.reduce((s, p) => s + p.dollars, 0)),
  };
}
