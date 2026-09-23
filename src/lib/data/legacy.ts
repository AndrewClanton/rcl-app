import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Accounts pulled from the old site, waiting to be reviewed and imported
// (see supabase/migrations/20260923010000_legacy_accounts.sql). Service-
// role reads only -- this holds ~13,000 people's contact details, most of
// them bot signups using strangers' emails. Admin-only surfaces.

export type LegacyGroup = "paying" | "likely_real" | "review" | "bot";
export type LegacyDecision = "import" | "skip" | "review";

export interface LegacyAccount {
  legacy_user_id: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  joined_at: string | null;
  membership_type: string | null;
  membership_duration: string | null;
  membership_is_plus: boolean;
  subscription_type: string | null;
  subscription_billing_status: string | null;
  classification: LegacyGroup;
  reasons: string[];
  decision: LegacyDecision;
  decided_by: string | null;
  imported_member_id: string | null;
}

export interface LegacySummary {
  groups: Record<LegacyGroup, number>;
  toImport: number; // approved, not yet imported
  imported: number;
  awaitingReview: number;
}

export const LEGACY_PAGE_SIZE = 50;

export async function getLegacySummary(): Promise<LegacySummary> {
  const supabase = createAdminClient();
  const base = () => supabase.from("legacy_accounts").select("legacy_user_id", { count: "exact", head: true });
  const count = async (filter: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    const { count, error } = await filter(base());
    if (error) throw error;
    return count ?? 0;
  };
  const [paying, likelyReal, review, bot, toImport, imported, awaitingReview] = await Promise.all([
    count((q) => q.eq("classification", "paying")),
    count((q) => q.eq("classification", "likely_real")),
    count((q) => q.eq("classification", "review")),
    count((q) => q.eq("classification", "bot")),
    count((q) => q.eq("decision", "import").is("imported_member_id", null)),
    count((q) => q.not("imported_member_id", "is", null)),
    count((q) => q.eq("decision", "review")),
  ]);
  return { groups: { paying, likely_real: likelyReal, review, bot }, toImport, imported, awaitingReview };
}

export async function getLegacyPage(opts: { group: LegacyGroup; query?: string; page?: number }): Promise<{ rows: LegacyAccount[]; total: number; page: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const supabase = createAdminClient();
  let q = supabase
    .from("legacy_accounts")
    .select(
      "legacy_user_id, email, first_name, last_name, phone, joined_at, membership_type, membership_duration, membership_is_plus, subscription_type, subscription_billing_status, classification, reasons, decision, decided_by, imported_member_id",
      { count: "exact" }
    )
    .eq("classification", opts.group);
  const query = opts.query?.trim();
  if (query) {
    const escaped = query.replace(/[%_,()]/g, (c) => `\\${c}`);
    q = q.or(`first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,email.ilike.%${escaped}%`);
  }
  const from = (page - 1) * LEGACY_PAGE_SIZE;
  // Pseudo-random but stable order, so each page is a fair spot-check.
  const { data, error, count } = await q.order("shuffle").range(from, from + LEGACY_PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: (data ?? []) as LegacyAccount[], total: count ?? 0, page };
}
