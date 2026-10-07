"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertAdmin } from "@/lib/auth";
import { DESCRIPTION_MAX, MONTH, parseMoney, type LineKind, type PaidMethod, type PayStatus } from "@/lib/org-invoices";
import { makeOrgPayLink, sendOrgInvoice, setInvoiceFee, setInvoiceStatus } from "@/lib/org-invoice-server";

// Back office → Organizations → invoices (lib/org-invoices.ts). Owners and
// admins.

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const KINDS: LineKind[] = ["event", "rental", "service"];

function refresh(orgId: string) {
  revalidatePath(`/admin/organizations/${orgId}`);
  revalidatePath(`/admin/organizations/${orgId}/invoice`);
  revalidatePath("/admin/impact");
}

export interface LineFields {
  date: string;
  kind: LineKind;
  description: string;
  fullValue: string;
  charged: string;
  people: string;
}

export async function addInvoiceLine(orgId: string, f: LineFields): Promise<Result> {
  const staff = await assertAdmin();
  if (!UUID.test(orgId)) return { ok: false, error: "Couldn't find that organization." };
  const date = String(f.date ?? "");
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) return { ok: false, error: "Pick the date." };
  if (!KINDS.includes(f.kind)) return { ok: false, error: "Pick event, rental or service." };
  const description = String(f.description ?? "").trim().replace(/\s+/g, " ");
  if (!description || description.length > DESCRIPTION_MAX) return { ok: false, error: `Describe it (up to ${DESCRIPTION_MAX} characters).` };
  const full = parseMoney(f.fullValue);
  if (full === null) return { ok: false, error: "The full value should be a dollar amount, like 400." };
  const charged = parseMoney(f.charged);
  if (charged === null) return { ok: false, error: "The amount charged should be a dollar amount, like 50 (or 0)." };
  if (charged > full) return { ok: false, error: "The amount charged can't be more than the full value." };
  const rawPeople = String(f.people ?? "").trim();
  const people = rawPeople ? Number(rawPeople) : null;
  if (people !== null && (!Number.isInteger(people) || people < 0 || people > 10000)) return { ok: false, error: "People should be a whole number (or blank)." };
  const { error } = await createAdminClient().from("org_invoice_lines").insert({
    organization_id: orgId,
    service_date: date,
    kind: f.kind,
    description,
    full_value: full,
    amount_charged: charged,
    people,
    created_by: staff.employeeId,
    created_by_name: staff.name.slice(0, 120),
  });
  if (error) return { ok: false, error: "Couldn't add it. Try again." };
  refresh(orgId);
  return { ok: true };
}

export async function deleteInvoiceLine(orgId: string, lineId: string): Promise<Result> {
  await assertAdmin();
  if (!UUID.test(orgId) || !UUID.test(lineId)) return { ok: false, error: "Couldn't find that line." };
  const { error } = await createAdminClient().from("org_invoice_lines").delete().eq("id", lineId).eq("organization_id", orgId);
  if (error) return { ok: false, error: "Couldn't remove it. Try again." };
  refresh(orgId);
  return { ok: true };
}

const okMonth = (orgId: string, month: string) => UUID.test(orgId) && MONTH.test(month);

export async function markInvoice(orgId: string, month: string, status: PayStatus, method: PaidMethod | null): Promise<Result> {
  const staff = await assertAdmin();
  if (!okMonth(orgId, month)) return { ok: false, error: "Couldn't find that invoice." };
  if (!["unpaid", "paid", "waived"].includes(status)) return { ok: false, error: "Pick a status." };
  if (method !== null && !["cash", "check", "card"].includes(method)) return { ok: false, error: "Pick cash, check or card." };
  const r = await setInvoiceStatus(orgId, month, status, method, staff);
  if (r.ok) refresh(orgId);
  return r;
}

export async function includeMonthlyFee(orgId: string, month: string, include: boolean): Promise<Result> {
  const staff = await assertAdmin();
  if (!okMonth(orgId, month)) return { ok: false, error: "Couldn't find that invoice." };
  const r = await setInvoiceFee(orgId, month, !!include, staff);
  if (r.ok) refresh(orgId);
  return r;
}

export async function emailInvoice(orgId: string, month: string, email: string): Promise<Result<{ to: string }>> {
  const staff = await assertAdmin();
  if (!okMonth(orgId, month)) return { ok: false, error: "Couldn't find that invoice." };
  const r = await sendOrgInvoice(orgId, month, String(email ?? "").trim() || null, staff);
  if (r.ok) refresh(orgId);
  return r;
}

export async function payByCardLink(orgId: string, month: string): Promise<Result<{ url: string }>> {
  const staff = await assertAdmin();
  if (!okMonth(orgId, month)) return { ok: false, error: "Couldn't find that invoice." };
  const r = await makeOrgPayLink(orgId, month, staff);
  if (r.ok) refresh(orgId);
  return r;
}
