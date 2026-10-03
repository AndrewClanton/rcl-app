import { salesTaxOn } from "@/lib/sales-tax";

// Tax-free register orders: why one went without tax, and how Reports, the
// Sales tax tab and the nightly email describe it. Everything is taxed
// (lib/sales-tax.ts) unless the register's "Tax exempt" box is ticked, which
// takes a manager PIN and one of these reasons (saved on the order:
// migration 20261003200000_tax_exempt_reason.sql).
// (No server imports: the register uses it too.)

export const TAX_EXEMPT_REASONS = {
  certificate: "Tax-exempt certificate",
  courtesy: "Courtesy: we covered the tax",
  other: "Other",
} as const;
export type TaxExemptReason = keyof typeof TAX_EXEMPT_REASONS;
export const TAX_EXEMPT_NOTE_MAX = 200;

export function isTaxExemptReason(r: unknown): r is TaxExemptReason {
  return typeof r === "string" && Object.prototype.hasOwnProperty.call(TAX_EXEMPT_REASONS, r);
}

// What the register sends with a tax-free order (and keeps on a tab).
export interface TaxExemptMark {
  reason: TaxExemptReason;
  note: string | null; // certificate number, or what "other" means
  markedBy: string | null; // employee id: the cashier on the register
  approvedBy: string | null; // employee id: the manager whose PIN approved it
  at: string; // ISO time it was approved
}

// One tax-free order as Reports list it.
export interface TaxFreeOrder {
  id: string;
  orderNumber: number;
  at: string; // when it was finished
  sales: number; // what was sold, after discounts, before tip
  taxNotCharged: number; // the sales tax on it (lib/sales-tax.ts)
  reason: TaxExemptReason | null; // null: marked before reasons were recorded
  note: string | null;
  markedBy: string | null; // first name; for older orders, who rang it
  approvedBy: string | null; // first name
}

// The order columns behind it ("*" on orders includes them once the
// migration is in; before, they're simply missing).
export interface TaxFreeOrderRow {
  id: string;
  order_number: number;
  completed_at: string;
  status: string;
  tax_free: boolean;
  tip: number;
  total: number;
  employee?: { name: string } | null; // who rang it
  tax_exempt_reason?: string | null;
  tax_exempt_note?: string | null;
  tax_exempt_marked_by?: string | null;
  tax_exempt_approved_by?: string | null;
  // Their names, looked up on the server (data/tax-free-names.ts).
  tax_exempt_marker?: { name: string } | null;
  tax_exempt_approver?: { name: string } | null;
}

const firstName = (name: string | null | undefined) => (name ? name.trim().split(/\s+/)[0] || name : null);

// Completed tax-free orders, oldest first.
export function taxFreeOrders(rows: TaxFreeOrderRow[]): TaxFreeOrder[] {
  return rows
    .filter((o) => o.tax_free && o.status === "completed")
    .map((o) => {
      const sales = Math.round((Number(o.total) - Number(o.tip)) * 100) / 100;
      const reason = isTaxExemptReason(o.tax_exempt_reason) ? o.tax_exempt_reason : null;
      return {
        id: o.id,
        orderNumber: Number(o.order_number),
        at: o.completed_at,
        sales,
        taxNotCharged: salesTaxOn(sales),
        reason,
        note: o.tax_exempt_note?.trim() || null,
        // Before reasons were recorded (or with no cashier picked): who rang the order.
        markedBy: firstName(o.tax_exempt_marker?.name ?? o.employee?.name),
        approvedBy: firstName(o.tax_exempt_approver?.name),
      };
    })
    .sort((a, b) => a.at.localeCompare(b.at));
}

// Employee ids named on tax-free orders, to look their names up.
export function taxFreeStaffIds(rows: TaxFreeOrderRow[]): string[] {
  const ids = new Set<string>();
  for (const o of rows) {
    if (!o.tax_free) continue;
    if (o.tax_exempt_marked_by) ids.add(o.tax_exempt_marked_by);
    if (o.tax_exempt_approved_by) ids.add(o.tax_exempt_approved_by);
  }
  return [...ids];
}

const money = (n: number) => `$${n.toFixed(2)}`;

// "Courtesy", "Tax-exempt certificate #12345", "Other: church group".
export function taxExemptWhy(o: Pick<TaxFreeOrder, "reason" | "note">): string {
  if (!o.reason) return "no reason recorded";
  if (o.reason === "courtesy") return "Courtesy";
  if (o.reason === "certificate") return o.note ? `Tax-exempt certificate #${o.note.replace(/^#/, "")}` : "Tax-exempt certificate";
  return o.note ? `Other: ${o.note}` : "Other";
}

// "Oct 2, 8:41 PM · $5.00 · $0.44 not charged · marked by Andrew · Courtesy"
// (an older order: "· rung by Andrew · no reason recorded").
export function taxFreeLine(o: TaxFreeOrder): string {
  const when = new Date(o.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
  const who = o.reason
    ? `marked by ${o.markedBy ?? "someone"}${o.approvedBy && o.approvedBy !== o.markedBy ? `, approved by ${o.approvedBy}` : ""}`
    : o.markedBy
      ? `rung by ${o.markedBy}`
      : "cashier not recorded";
  return [when, money(o.sales), `${money(o.taxNotCharged)} not charged`, who, taxExemptWhy(o)].join(" · ");
}

// "1 tax-free order today: $0.44 of tax not charged."
export function taxFreeCallout(orders: TaxFreeOrder[], when = "today"): string | null {
  if (!orders.length) return null;
  const notCharged = orders.reduce((s, o) => s + o.taxNotCharged, 0);
  return `${orders.length} tax-free order${orders.length === 1 ? "" : "s"} ${when}: ${money(Math.round(notCharged * 100) / 100)} of tax not charged.`;
}
