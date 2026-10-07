import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgStatement } from "@/lib/data/organizations";
import type { OrgRow } from "@/lib/orgs-server";
import {
  EIN_SETTING,
  compsDetail,
  docLine,
  docTotals,
  invoiceNumber,
  KIND_LABEL,
  monthRange,
  type DocLine,
  type InvoiceDoc,
  type LineKind,
  type PaidMethod,
  type PayStatus,
} from "@/lib/org-invoices";

// One organization's month as an invoice (lib/org-invoices.ts): the lines
// staff added, the comps from the statement, the fee when it's invoiced by
// hand, the payment status, and who it was emailed to.

export interface InvoiceLineRow {
  id: string;
  date: string;
  kind: LineKind;
  description: string;
  fullValue: number;
  charged: number;
  people: number | null;
  addedBy: string | null;
}

export interface InvoiceRow {
  status: PayStatus;
  paid_method: PaidMethod | null;
  paid_at: string | null;
  status_by_name: string | null;
  include_fee: boolean | null;
  pay_link_id: string | null;
  pay_link_url: string | null;
  pay_link_amount: number | null;
  updated_at: string;
}

export interface InvoiceSend {
  id: string;
  email: string;
  kind: "invoice" | "receipt";
  amountDue: number;
  covered: number;
  sentByName: string | null;
  at: string;
}

export interface OrgInvoice {
  org: OrgRow;
  month: string;
  lines: InvoiceLineRow[];
  compDays: { date: string; visits: number; movies: number; value: number }[];
  comps: { visits: number; movies: number; value: number };
  includeFee: boolean;
  invoice: InvoiceRow | null;
  // The payment link is for the amount due now (else it needs a new one).
  payLinkCurrent: boolean;
  doc: InvoiceDoc;
  sends: InvoiceSend[];
}

// The nonprofit's EIN from settings, or null while it's blank.
export async function nonprofitEin(): Promise<string | null> {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", EIN_SETTING).maybeSingle();
  const v = typeof data?.value === "string" ? data.value.trim() : "";
  return v || null;
}

const LINE_COLUMNS = "id, service_date, kind, description, full_value, amount_charged, people, created_by_name";

function toLine(l: Record<string, unknown>): InvoiceLineRow {
  return {
    id: l.id as string,
    date: l.service_date as string,
    kind: l.kind as LineKind,
    description: l.description as string,
    fullValue: Number(l.full_value),
    charged: Number(l.amount_charged),
    people: l.people == null ? null : Number(l.people),
    addedBy: (l.created_by_name as string | null) ?? null,
  };
}

const INVOICE_COLUMNS = "status, paid_method, paid_at, status_by_name, include_fee, pay_link_id, pay_link_url, pay_link_amount, updated_at";

// The fee goes on a hand-invoiced organization's invoice unless staff took
// it off; a Stripe-billed fee is invoiced by Stripe.
export const feeByDefault = (org: Pick<OrgRow, "stripe_subscription_id" | "monthly_fee">) => !org.stripe_subscription_id && Number(org.monthly_fee) > 0;

export async function getOrgInvoice(orgId: string, month: string): Promise<OrgInvoice | null> {
  const db = createAdminClient();
  const { from, to } = monthRange(month);
  const [statement, lines, inv, sends, ein] = await Promise.all([
    getOrgStatement(orgId, month),
    db
      .from("org_invoice_lines")
      .select(LINE_COLUMNS)
      .eq("organization_id", orgId)
      .gte("service_date", from)
      .lte("service_date", to)
      .order("service_date")
      .order("created_at"),
    db.from("org_invoices").select(INVOICE_COLUMNS).eq("organization_id", orgId).eq("month", month).maybeSingle(),
    db
      .from("org_invoice_sends")
      .select("id, email, kind, amount_due, covered, sent_by_name, created_at")
      .eq("organization_id", orgId)
      .eq("month", month)
      .order("created_at", { ascending: false })
      .limit(50),
    nonprofitEin(),
  ]);
  if (!statement) return null;
  if (lines.error) throw new Error(lines.error.message);
  if (inv.error) throw new Error(inv.error.message);
  const org = statement.org;
  const invoice = inv.data ? ({ ...inv.data, pay_link_amount: inv.data.pay_link_amount == null ? null : Number(inv.data.pay_link_amount) } as InvoiceRow) : null;

  const lineRows = (lines.data ?? []).map(toLine);

  const byDay = new Map<string, { visits: number; movies: number; value: number }>();
  for (const d of statement.days) byDay.set(d.date, { visits: d.people, movies: 0, value: 0 });
  for (const r of statement.rows) {
    const d = byDay.get(r.date) ?? { visits: 0, movies: 0, value: 0 };
    if (r.kind === "movie") d.movies++;
    d.value += r.amount;
    byDay.set(r.date, d);
  }
  const compDays = [...byDay.entries()].map(([date, d]) => ({ date, ...d, value: Math.round(d.value * 100) / 100 })).sort((a, b) => a.date.localeCompare(b.date));
  const comps = {
    visits: statement.comps,
    movies: statement.rows.filter((r) => r.kind === "movie").length,
    value: Math.round(statement.value * 100) / 100,
  };
  const includeFee = invoice?.include_fee ?? feeByDefault(org);
  const status: PayStatus = invoice?.status ?? "unpaid";

  const docLines: DocLine[] = lineRows.map((l) =>
    docLine({ date: l.date, label: `${KIND_LABEL[l.kind]}: ${l.description}`, detail: l.people ? `${l.people} ${l.people === 1 ? "person" : "people"}` : null, fullValue: l.fullValue, charged: l.charged }),
  );
  if (comps.visits > 0 || comps.value > 0) {
    docLines.push(docLine({ date: null, label: "Comps: day passes and movies", detail: compsDetail(comps.visits, comps.movies), fullValue: comps.value, charged: 0 }));
  }
  if (includeFee) docLines.push(docLine({ date: null, label: "Monthly organization fee", detail: null, fullValue: org.monthly_fee, charged: org.monthly_fee }));
  const totals = docTotals(docLines, status);
  const payLinkCurrent = !!invoice?.pay_link_url && invoice.pay_link_amount === totals.due && totals.due > 0;

  return {
    org,
    month,
    lines: lineRows,
    compDays,
    comps,
    includeFee,
    invoice,
    payLinkCurrent,
    doc: {
      orgName: org.name,
      contactName: org.contact_name,
      month,
      number: invoiceNumber(org.id, month),
      status,
      paidMethod: invoice?.paid_method ?? null,
      paidAt: invoice?.paid_at ?? null,
      lines: docLines,
      totals,
      payUrl: payLinkCurrent && status === "unpaid" ? invoice!.pay_link_url : null,
      ein,
    },
    sends: (sends.data ?? []).map((s) => ({
      id: s.id as string,
      email: s.email as string,
      kind: s.kind as "invoice" | "receipt",
      amountDue: Number(s.amount_due),
      covered: Number(s.covered),
      sentByName: (s.sent_by_name as string | null) ?? null,
      at: s.created_at as string,
    })),
  };
}

// The organization page's list: this month's lines.
export async function invoiceLinesBetween(orgId: string, from: string, to: string): Promise<InvoiceLineRow[]> {
  const { data, error } = await createAdminClient()
    .from("org_invoice_lines")
    .select(LINE_COLUMNS)
    .eq("organization_id", orgId)
    .gte("service_date", from)
    .lte("service_date", to)
    .order("service_date");
  if (error) throw new Error(error.message);
  return (data ?? []).map(toLine);
}
