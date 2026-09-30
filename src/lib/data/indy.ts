import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { IndyClass, IndyDecision, IndyFillField, IndyImportAs, IndySaidNo } from "@/lib/indy-rules";

// People from Indy's customer export, waiting to be reviewed and imported
// (see supabase/migrations/20261001120000_indy_accounts.sql and
// src/lib/indy-rules.ts). Service-role reads only -- this holds ~1,500
// people's contact details. Admin-only surfaces.

export type IndyTab = "new" | "fill" | "conflict" | "said_no" | "skip";
export const INDY_TABS: IndyTab[] = ["new", "fill", "conflict", "said_no", "skip"];
export const INDY_PAGE_SIZE = 50;

// A member an Indy row matched, as the review shows it.
export interface IndyMatch {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface IndyAccount {
  indy_user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  birthday: string | null;
  indy_created_at: string | null;
  indy_last_visit: string | null;
  indy_membership: string | null;
  indy_type: string | null;
  indy_points: number | null;
  said_yes: boolean;
  classification: IndyClass;
  reasons: string[];
  email_member_id: string | null;
  phone_member_id: string | null;
  target_member_id: string | null;
  planned_fills: IndyFillField[];
  said_no_review: boolean;
  said_no_decision: IndySaidNo | null;
  decision: IndyDecision;
  import_as: IndyImportAs | null;
  decided_by: string | null;
  imported_member_id: string | null;
  erased_at: string | null;
  email_member: IndyMatch | null;
  phone_member: IndyMatch | null;
  target_member: IndyMatch | null;
}

export interface IndySummary {
  classes: Record<IndyClass, number>;
  saidYes: number;
  saidNo: number;
  saidNoReview: number; // said no on Indy, opted in here only by the old default
  saidNoPending: number; // ...and still waiting for Honor or Leave
  newUnapproved: number; // new rows on the automatic default, not yet approved by a person
  toImport: number; // ready for the Import button
  imported: number;
  awaitingReview: number; // conflicts nobody has picked for yet
  consentPending: number; // imported, Indy answer not yet in the email tables
  consentTables: boolean | null; // null: couldn't tell
}

// PostgREST's "no such table" (the email-marketing migration isn't applied).
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST205" || error.code === "42P01" || /could not find the table|relation .* does not exist/i.test(error.message ?? "");
}

// Whether the email-marketing tables (20261001090000_email_marketing.sql)
// are there to receive Indy answers. null when the check itself failed.
export async function consentTablesExist(supabase: SupabaseClient): Promise<boolean | null> {
  for (const table of ["member_email_prefs", "email_consent_log"]) {
    const { error } = await supabase.from(table).select("member_id").limit(1);
    if (error) return isMissingTable(error) ? false : null;
  }
  return true;
}

// Approved, not in yet, and not a "said no" still waiting for a choice.
// Mirrors readyToImport in src/lib/indy-rules.ts.
export const READY_FILTER = "said_no_review.eq.false,said_no_decision.in.(honor,leave)";

// Counts rows of indy_accounts matching a filter.
function counter(supabase: SupabaseClient) {
  const base = () => supabase.from("indy_accounts").select("indy_user_id", { count: "exact", head: true });
  type Q = ReturnType<typeof base>;
  const count = async (filter: (q: Q) => Q) => {
    const { count, error } = await filter(base());
    if (error) throw error;
    return count ?? 0;
  };
  // Not imported yet and not removed.
  const notIn = (q: Q) => q.is("imported_member_id", null).is("erased_at", null);
  const ready = (q: Q) => notIn(q.eq("decision", "import").not("import_as", "is", null)).or(READY_FILTER);
  return { count, notIn, ready };
}

export async function getIndySummary(): Promise<IndySummary> {
  const supabase = createAdminClient();
  const { count, notIn, ready } = counter(supabase);
  const [fill, fresh, conflict, skip, saidYes, saidNo, saidNoReview, saidNoPending, newUnapproved, toImport, imported, awaitingReview, consentPending, consentTables] =
    await Promise.all([
      count((q) => q.eq("classification", "fill")),
      count((q) => q.eq("classification", "new")),
      count((q) => q.eq("classification", "conflict")),
      count((q) => q.eq("classification", "skip")),
      count((q) => q.eq("said_yes", true)),
      count((q) => q.eq("said_yes", false)),
      count((q) => q.eq("said_no_review", true)),
      count((q) => notIn(q.eq("said_no_review", true).eq("said_no_decision", "pending"))),
      count((q) => notIn(q.eq("classification", "new").eq("decision", "import").is("decided_by", null))),
      count(ready),
      count((q) => q.not("imported_member_id", "is", null)),
      count((q) => notIn(q.eq("decision", "review"))),
      count((q) => q.not("imported_member_id", "is", null).is("consent_recorded_at", null).is("erased_at", null)),
      consentTablesExist(supabase),
    ]);
  return {
    classes: { fill, new: fresh, conflict, skip },
    saidYes,
    saidNo,
    saidNoReview,
    saidNoPending,
    newUnapproved,
    toImport,
    imported,
    awaitingReview,
    consentPending,
    consentTables,
  };
}

// For the link on the Members page. Null when there's nothing loaded, or
// the table isn't there (so that page never fails because of this one).
export async function getIndyOverview(): Promise<{ total: number; imported: number; toImport: number; needsChoice: number } | null> {
  try {
    const { count, notIn, ready } = counter(createAdminClient());
    const [total, imported, toImport, review, saidNo] = await Promise.all([
      count((q) => q),
      count((q) => q.not("imported_member_id", "is", null)),
      count(ready),
      count((q) => notIn(q.eq("decision", "review"))),
      count((q) => notIn(q.eq("said_no_review", true).eq("said_no_decision", "pending"))),
    ]);
    return total > 0 ? { total, imported, toImport, needsChoice: review + saidNo } : null;
  } catch {
    return null;
  }
}

const MATCH = "id, name, email, phone";
const COLUMNS = [
  "indy_user_id, email, first_name, last_name, phone, birthday, indy_created_at, indy_last_visit, indy_membership, indy_type, indy_points, said_yes",
  "classification, reasons, email_member_id, phone_member_id, target_member_id, planned_fills, said_no_review, said_no_decision, decision, import_as, decided_by",
  "imported_member_id, erased_at",
  `email_member:members!indy_accounts_email_member_id_fkey(${MATCH})`,
  `phone_member:members!indy_accounts_phone_member_id_fkey(${MATCH})`,
  `target_member:members!indy_accounts_target_member_id_fkey(${MATCH})`,
].join(", ");

export async function getIndyPage(opts: { tab: IndyTab; query?: string; page?: number }): Promise<{ rows: IndyAccount[]; total: number; page: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const supabase = createAdminClient();
  let q = supabase.from("indy_accounts").select(COLUMNS, { count: "exact" });
  q = opts.tab === "said_no" ? q.eq("said_no_review", true) : q.eq("classification", opts.tab);
  const query = opts.query?.trim();
  if (query) {
    const esc = (s: string) => s.replace(/[%_,()\\]/g, (c) => `\\${c}`);
    const [first, ...rest] = query.split(/\s+/);
    const whole = esc(query);
    // "Pat Smith" matches first and last name together, too.
    const both = rest.length ? `,and(first_name.ilike.%${esc(first)}%,last_name.ilike.%${esc(rest.join(" "))}%)` : "";
    q = q.or(`first_name.ilike.%${whole}%,last_name.ilike.%${whole}%,email.ilike.%${whole}%${both}`);
  }
  const from = (page - 1) * INDY_PAGE_SIZE;
  // Pseudo-random but stable order, so each page is a fair spot-check.
  const { data, error, count } = await q.order("shuffle").range(from, from + INDY_PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: (data ?? []) as unknown as IndyAccount[], total: count ?? 0, page };
}
