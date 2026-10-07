// Organization invoices (Andrew, 10/7;
// supabase/migrations/20261007010000_org_invoices_impact.sql). No server
// imports: the email, the Back office pages and the check scripts share it.
//
// One document per organization and month, an invoice while something is
// owed and a receipt once it's paid or waived. Each line shows what it was
// worth, what the organization was charged, and what the Royale Cinema
// Project (the 501(c)(3)) covered:
//   - discounted events, rentals and services staff add (Arc of the
//     Ozarks: an event worth $400, charged $50, $350 covered);
//   - the month's comps (day passes and movies) at menu value, all covered;
//   - the monthly fee, when it's invoiced by hand (a Stripe-billed fee is
//     invoiced by Stripe, so it stays off).

export const NONPROFIT = "Royale Cinema Project";
// The legal name (IRS), for footers; the everyday name is NONPROFIT.
export const NONPROFIT_LEGAL = "Royale Cinema Project Co";
// "Royale Cinema Project Co · 501(c)(3) · EIN 99-4086131"
export const nonprofitLine = (ein: string | null) => `${NONPROFIT_LEGAL} · 501(c)(3)${ein ? ` · EIN ${ein}` : ""}`;
export const NONPROFIT_TAGLINE = "Encouraging Community. Enjoying Cinema.";
export const BUSINESS = "Royale Cinema Lounge LLC";
export const ADDRESS = "715 E Broadway St, Joplin, MO 64801";
// settings key for the nonprofit's EIN (a string), blank until it's filled in.
export const EIN_SETTING = "nonprofit_ein";
export const EIN = /^\d{2}-\d{7}$/;

// Who the nonprofit serves (organizations.impact_category,
// community_activities.category), for the Community impact tab.
export type ImpactCategory = "disabilities" | "seniors" | "students" | "neighborhood" | "other";
export const IMPACT_CATEGORIES: { value: ImpactCategory; label: string }[] = [
  { value: "disabilities", label: "People with disabilities" },
  { value: "seniors", label: "Seniors" },
  { value: "students", label: "Students" },
  { value: "neighborhood", label: "Neighborhood screenings" },
  { value: "other", label: "Other" },
];
export const CATEGORY_LABEL = Object.fromEntries(IMPACT_CATEGORIES.map((c) => [c.value, c.label])) as Record<ImpactCategory, string>;
export const isCategory = (v: unknown): v is ImpactCategory => IMPACT_CATEGORIES.some((c) => c.value === v);

export type LineKind = "event" | "rental" | "service";
export type PayStatus = "unpaid" | "paid" | "waived";
export type PaidMethod = "cash" | "check" | "card";

export const LINE_KINDS: { value: LineKind; label: string }[] = [
  { value: "event", label: "Event" },
  { value: "rental", label: "Rental" },
  { value: "service", label: "Service" },
];
export const KIND_LABEL: Record<LineKind, string> = { event: "Event", rental: "Rental", service: "Service" };
export const METHOD_LABEL: Record<PaidMethod, string> = { cash: "cash", check: "check", card: "card" };

export const DESCRIPTION_MAX = 200;
export const MAX_VALUE = 1_000_000;

const cents = (n: number) => Math.round(n * 100) / 100;

export const money = (n: number) => `$${cents(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// "$400", "400.00", "1,600" → 400 / 1600. Null for anything else.
export function parseMoney(raw: unknown): number | null {
  const s = String(raw ?? "").trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n <= MAX_VALUE ? cents(n) : null;
}

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function monthTitle(month: string): string {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// "RCL-202610-3F2A": the month and the start of the organization's id.
export const invoiceNumber = (orgId: string, month: string) => `RCL-${month.replace("-", "")}-${orgId.replace(/-/g, "").slice(0, 4).toUpperCase()}`;

export interface DocLine {
  date: string | null; // null for the month's comps and the fee
  label: string;
  detail: string | null;
  fullValue: number;
  charged: number;
  covered: number;
}

export interface DocTotals {
  fullValue: number;
  charged: number;
  covered: number;
  // What's still owed: the charges while unpaid, else 0.
  due: number;
}

export interface InvoiceDoc {
  orgName: string;
  contactName: string | null;
  month: string;
  number: string;
  status: PayStatus;
  paidMethod: PaidMethod | null;
  paidAt: string | null;
  lines: DocLine[];
  totals: DocTotals;
  // The Stripe payment link, only while it's for the amount due.
  payUrl: string | null;
  // The nonprofit's EIN, once it's filled in.
  ein: string | null;
}

export const coveredOf = (fullValue: number, charged: number) => cents(Math.max(0, fullValue - charged));

export function docLine(l: { date: string | null; label: string; detail?: string | null; fullValue: number; charged: number }): DocLine {
  const fullValue = cents(Number(l.fullValue));
  const charged = cents(Number(l.charged));
  return { date: l.date, label: l.label, detail: l.detail ?? null, fullValue, charged, covered: coveredOf(fullValue, charged) };
}

export function docTotals(lines: DocLine[], status: PayStatus): DocTotals {
  const sum = (k: "fullValue" | "charged" | "covered") => cents(lines.reduce((s, l) => s + l[k], 0));
  const charged = sum("charged");
  return { fullValue: sum("fullValue"), charged, covered: sum("covered"), due: status === "unpaid" ? charged : 0 };
}

// "6 visits, 4 movies"
export function compsDetail(visits: number, movies: number): string {
  return `${visits} ${visits === 1 ? "visit" : "visits"} (day passes), ${movies} ${movies === 1 ? "movie" : "movies"}`;
}

// The invoice is a receipt once nothing is owed.
export const isReceipt = (d: Pick<InvoiceDoc, "status" | "totals">) => d.status !== "unpaid" || d.totals.charged <= 0;

export function statusText(d: Pick<InvoiceDoc, "status" | "paidMethod" | "paidAt" | "totals">): string {
  if (d.status === "waived") return "Waived: nothing to pay";
  if (d.status === "paid") {
    const when = d.paidAt ? ` ${new Date(d.paidAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" })}` : "";
    return `Paid${d.paidMethod ? ` by ${METHOD_LABEL[d.paidMethod]}` : ""}${when}. Thank you!`;
  }
  return d.totals.charged > 0 ? `Amount due: ${money(d.totals.due)}` : "Nothing to pay";
}
