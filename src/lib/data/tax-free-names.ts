import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { taxFreeStaffIds, type TaxFreeOrderRow } from "@/lib/tax-exempt";

// Puts the names of who marked and who approved each tax-free order on the
// order rows (tax_exempt_marker, tax_exempt_approver), for Reports' list of
// tax-free orders (lib/tax-exempt.ts). One lookup, only when there are any.
// Looked up rather than joined, so Reports keep working before the
// tax-exempt migration (20261003200000) is applied. Never throws: without
// names the list still shows each order and why.
export async function attachTaxExemptNames(rows: TaxFreeOrderRow[]): Promise<void> {
  const ids = taxFreeStaffIds(rows);
  if (!ids.length) return;
  const { data, error } = await createAdminClient().from("employees").select("id, name").in("id", ids);
  if (error) {
    console.warn("tax-free orders: staff names not read:", error.message);
    return;
  }
  const name = new Map((data ?? []).map((e) => [e.id as string, { name: e.name as string }]));
  for (const o of rows) {
    if (!o.tax_free) continue;
    o.tax_exempt_marker = name.get(o.tax_exempt_marked_by ?? "") ?? null;
    o.tax_exempt_approver = name.get(o.tax_exempt_approved_by ?? "") ?? null;
  }
}
