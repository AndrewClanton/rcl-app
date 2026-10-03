// Rewind: finding a regular's old Fortis card from what they can read off
// their banking app -- the last 4 of the card and the date and amount of a
// purchase or two -- so staff can give them the points for visits they
// didn't know counted. No server imports: the Back office screen, its
// actions, the loader (scripts/load-fortis-cards.mjs) and
// scripts/check-fortis-backfill.mjs all use it.
//
// Most taps carried no name, so the name match in fortis-backfill.ts can't
// place them. On the Royale's export (5,904 approved sales), a day and an
// exact amount alone point at one card 59% of the time; with the last 4,
// every time. Two purchases on exact days: 96%; with days off by one
// (posting dates): 92%.
//
// What counts as the purchase's day: the business date it was rung up on
// (4 a.m. to 4 a.m. Central) or its Central calendar date, which differ
// only between midnight and 4 a.m. -- the bank shows the calendar date.
// Banks often show the posting date instead, a day or two after the visit:
// with "posting dates" on, the purchase can be on the day entered or up to
// 2 days before it. Only sales count; a refund is not a purchase.

import { BACKFILL_NOTE, cardKey as cardKeyOf, classifyFortisRow, parseFortisTimestamp, type FortisRow, type GrantSettings } from "@/lib/fortis-backfill";

export const MAX_PURCHASES = 3;
export const POSTING_DAYS = 2;
// Lookups per staff member: enough for a busy night at the bar, not enough
// to walk the card list.
export const LOOKUP_LIMIT = { max: 30, windowSeconds: 600 } as const;
// More than this many cards fit: list the first ones and ask for more.
export const MAX_SHOWN = 12;

// ---------- reading what was typed ----------

// "$8", "8", "8.00", "8.5", ".50", "1,234.56" -> cents. Null for anything
// else: no negatives, no more than 2 decimals, commas only between
// thousands ("8,00" is refused, not read as $800). Up to $10,000.
export function parseAmountCents(raw: string | null | undefined): number | null {
  let s = String(raw ?? "").trim();
  s = s.replace(/^\$\s*/, "");
  if (s.includes(",")) {
    if (!/^\d{1,3}(,\d{3})+(\.\d{0,2})?$/.test(s)) return null;
    s = s.replace(/,/g, "");
  }
  const m = s.match(/^(\d*)(?:\.(\d{0,2}))?$/);
  if (!m || (m[1] === "" && !m[2])) return null;
  const cents = Number(m[1] || "0") * 100 + Number(((m[2] ?? "") + "00").slice(0, 2));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 1_000_000 ? cents : null;
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const CENTRAL = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" });

// The Central calendar date of an instant: "2026-09-22T06:30:00Z" -> "2026-09-22".
export function centralDate(iso: string): string {
  const parts = Object.fromEntries(CENTRAL.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export interface LookupPurchase {
  date: string; // YYYY-MM-DD, as the bank shows it
  cents: number;
}

export interface LookupInput {
  lastFour: string | null;
  purchases: LookupPurchase[];
  postingDates: boolean;
}

// What the form sends: strings, as typed.
export interface LookupForm {
  lastFour: string;
  purchases: { date: string; amount: string }[];
  postingDates: boolean;
}

export function readLookup(form: LookupForm): { ok: true; input: LookupInput } | { ok: false; error: string } {
  const lastFourRaw = String(form?.lastFour ?? "").trim();
  if (lastFourRaw && !/^\d{4}$/.test(lastFourRaw)) return { ok: false, error: "The last 4 should be the four digits at the end of the card number." };
  const rows = Array.isArray(form?.purchases) ? form.purchases : [];
  const purchases: LookupPurchase[] = [];
  for (let i = 0; i < rows.length; i++) {
    const date = String(rows[i]?.date ?? "").trim();
    const amount = String(rows[i]?.amount ?? "").trim();
    if (!date && !amount) continue;
    const which = rows.length > 1 ? `Purchase ${i + 1}` : "The purchase";
    if (!date || !amount) return { ok: false, error: `${which} needs both a date and an amount.` };
    if (!isIsoDate(date) || date < "2000-01-01") return { ok: false, error: `${which}: that date doesn't look right.` };
    const cents = parseAmountCents(amount);
    if (cents === null) return { ok: false, error: `${which}: enter the amount in dollars and cents, like 23.45.` };
    purchases.push({ date, cents });
  }
  if (!purchases.length) return { ok: false, error: "Enter the date and amount of one purchase from their bank app." };
  if (purchases.length > MAX_PURCHASES) return { ok: false, error: `Up to ${MAX_PURCHASES} purchases.` };
  return { ok: true, input: { lastFour: lastFourRaw || null, purchases, postingDates: !!form?.postingDates } };
}

// ---------- matching ----------

export interface SaleForLookup {
  id: string;
  cardKey: string; // first six + last four
  businessDate: string;
  amountCents: number;
  createdAt: string;
  kind: "sale" | "refund";
}

// The days a purchase entered as `date` may have happened on.
export function purchaseWindow(date: string, postingDates: boolean): { from: string; to: string } {
  return { from: addDays(date, postingDates ? -POSTING_DAYS : 0), to: date };
}

// The business dates to ask the database for: the window, and the day
// before it (a sale rung up after midnight belongs to the business day
// before its calendar date).
export function businessDateRange(date: string, postingDates: boolean): { from: string; to: string } {
  const w = purchaseWindow(date, postingDates);
  return { from: addDays(w.from, -1), to: w.to };
}

export function saleFits(sale: SaleForLookup, p: LookupPurchase, postingDates: boolean): boolean {
  if (sale.kind !== "sale" || sale.amountCents !== p.cents) return false;
  const w = purchaseWindow(p.date, postingDates);
  const inWindow = (d: string) => d >= w.from && d <= w.to;
  return inWindow(sale.businessDate) || inWindow(centralDate(sale.createdAt));
}

// Can each purchase be a different sale? (Two purchases typed the same are
// two visits, not one counted twice.) options[i]: the sales purchase i fits.
export function distinctSales(options: string[][]): boolean {
  const used = new Set<string>();
  const go = (i: number): boolean => {
    if (i === options.length) return true;
    for (const id of options[i]) {
      if (used.has(id)) continue;
      used.add(id);
      if (go(i + 1)) return true;
      used.delete(id);
    }
    return false;
  };
  return go(0);
}

// The cards with a sale for every purchase (each a different sale), and
// the last 4 if given. Sorted by card key; the caller adds the details.
export function matchCards(sales: SaleForLookup[], input: LookupInput): string[] {
  const byCard = new Map<string, Map<string, SaleForLookup>>();
  for (const s of sales) {
    if (s.kind !== "sale") continue;
    if (input.lastFour && s.cardKey.slice(-4) !== input.lastFour) continue;
    const m = byCard.get(s.cardKey) ?? new Map<string, SaleForLookup>();
    m.set(s.id, s);
    byCard.set(s.cardKey, m);
  }
  const out: string[] = [];
  for (const [key, m] of byCard) {
    const list = [...m.values()];
    const options = input.purchases.map((p) => list.filter((s) => saleFits(s, p, input.postingDates)).map((s) => s.id));
    if (options.every((o) => o.length > 0) && distinctSales(options)) out.push(key);
  }
  return out.sort();
}

export type LookupVerdict = "found" | "several" | "none";

export function verdictFor(cards: number): LookupVerdict {
  return cards === 1 ? "found" : cards > 1 ? "several" : "none";
}

// ---------- after it's found ----------

// What a found card's match is now, for the screen.
export type LookupStatus = "unclaimed" | "needs_pick" | "matched" | "granted" | "skipped" | "removed";

export function lookupStatus(c: {
  granted_at: string | null;
  erased_at: string | null;
  decision: string;
  match_status: string;
  matched_member_id: string | null;
}): LookupStatus {
  if (c.granted_at) return "granted";
  if (c.erased_at) return "removed";
  if (c.decision === "skipped") return "skipped";
  if (c.match_status === "matched" && c.matched_member_id) return "matched";
  if (c.match_status === "needs_pick") return "needs_pick";
  return "unclaimed";
}

// Who a found card may be assigned to from the lookup. Never a granted card
// or one whose member's info was removed. A manager can't undo an owner's
// or admin's skip, or move a card a person already approved for someone
// else (only confirm it for that member); an owner or admin can, as
// "Someone else…" in the list does.
export type AssignRule = "open" | "same_member" | "no";

export function assignRule(status: LookupStatus, approved: boolean, isAdmin: boolean): AssignRule {
  if (status === "granted" || status === "removed") return "no";
  if (isAdmin) return "open";
  if (status === "skipped") return "no";
  if (status === "matched" && approved) return "same_member";
  return "open";
}

export function mayAssignTo(rule: AssignRule, matchedMemberId: string | null, memberId: string): boolean {
  return rule === "open" || (rule === "same_member" && matchedMemberId === memberId);
}

// "March 2023", from a YYYY-MM-DD (read at noon UTC so no timezone moves it).
export function monthYear(date: string | null | undefined): string {
  if (!date || !isIsoDate(date.slice(0, 10))) return "";
  return new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// "1 point per $1 before tax", for the confirm step.
export function settingsLabel(s: GrantSettings): string {
  const rate = `${s.rate.toLocaleString("en-US")} point${s.rate === 1 ? "" : "s"} per $1${s.taxOut ? " before tax" : ""}`;
  return s.cap === null ? rate : `${rate}, up to ${s.cap.toLocaleString("en-US")} per member`;
}

// The points-history note: "... (card ending 1234)".
export function lookupGrantNote(lastFours: string[]): string {
  const l = [...new Set(lastFours)].sort();
  if (!l.length) return BACKFILL_NOTE;
  const list = l.length === 1 ? l[0] : `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}`;
  return `${BACKFILL_NOTE} (card${l.length === 1 ? "" : "s"} ending ${list})`;
}

// ---------- loading ----------

export interface FortisSaleRow {
  fortisId: string;
  cardKey: string;
  businessDate: string;
  amountCents: number; // as charged
  createdAt: string;
  kind: "sale" | "refund";
}

// One row per approved sale or refund in the export, for fortis_sales.
// `gone`: Fortis ids that are in the file but aren't a sale or refund (any
// more): a sale voided since an earlier load comes out.
export function fortisSaleRows(rows: (FortisRow & { id: string })[]): { sales: FortisSaleRow[]; gone: string[]; skipped: number } {
  const sales: FortisSaleRow[] = [];
  const gone: string[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const r of rows) {
    const id = String(r.id ?? "").trim();
    const kind = classifyFortisRow(r.statusId, r.typeId);
    if (kind !== "sale" && kind !== "refund") {
      if (id) gone.push(id);
      continue;
    }
    const key = cardKeyOf(r.firstSix, r.lastFour);
    const when = parseFortisTimestamp(r.createdTs);
    const cents = Math.round(Number(r.amount) * 100);
    if (!id || seen.has(id) || !key || !when || !Number.isFinite(cents) || cents <= 0) {
      skipped++;
      continue;
    }
    seen.add(id);
    sales.push({ fortisId: id, cardKey: key, businessDate: when.businessDate, amountCents: cents, createdAt: when.iso, kind });
  }
  return { sales, gone: gone.filter((id) => !seen.has(id)), skipped };
}
