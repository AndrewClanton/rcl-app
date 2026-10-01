import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  importPreview,
  READY_FILTER,
  type IndyClass,
  type IndyDecision,
  type IndyFillField,
  type IndyImportAs,
  type IndyImportPreview,
  type IndyPreviewRow,
} from "@/lib/indy-rules";

// People from Indy's customer export, waiting to be reviewed and imported
// (see supabase/migrations/20261001140000_indy_accounts.sql and
// src/lib/indy-rules.ts). Service-role reads only -- this holds ~1,500
// people's contact details. Admin-only surfaces.

export type IndyTab = "new" | "fill" | "conflict" | "skip";
export const INDY_TABS: IndyTab[] = ["new", "fill", "conflict", "skip"];
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
  skippedByHand: number; // fill / new / conflict rows a person set to Skip
  // What they said on Indy. Information only: every new member joins with
  // email on, and members already here keep the setting they have with us.
  saidYes: number;
  saidNo: number;
  saidNoNew: number; // said no on Indy, sorted New: they join with email on anyway
  newUnapproved: number; // new rows on the automatic default: they wait for Approve
  toImport: number; // ready for the Import button
  preview: IndyImportPreview; // what pressing Import would do now
  imported: number;
  awaitingReview: number; // conflicts nobody has picked for yet
  consentPending: number; // imported, Indy answer not yet in the email tables
  consentTables: boolean | null; // null: couldn't tell
  // Members removed at their request before the last load. Unless they were
  // linked to Indy, the sort can't recognise them (the removal blanks their
  // email and member_erasures keeps none), so New could hold one. Null when
  // nothing is loaded or it couldn't be counted.
  erasedBeforeLoad: number | null;
  neverMailList: boolean | null; // email_suppressions is there for Import to check
}

// PostgREST's "no such table" (the email-marketing migration isn't applied).
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST205" || error.code === "42P01" || /could not find the table|relation .* does not exist/i.test(error.message ?? "");
}

// Whether a table is there. null when the check itself failed.
async function tableExists(supabase: SupabaseClient, table: string, column: string): Promise<boolean | null> {
  const { error } = await supabase.from(table).select(column).limit(1);
  if (error) return isMissingTable(error) ? false : null;
  return true;
}

// Whether the email-marketing tables (20261001090000_email_marketing.sql)
// are there to receive Indy answers. null when the check itself failed.
export async function consentTablesExist(supabase: SupabaseClient): Promise<boolean | null> {
  for (const table of ["member_email_prefs", "email_consent_log"]) {
    const exists = await tableExists(supabase, table, "member_id");
    if (exists !== true) return exists;
  }
  return true;
}

// Whether the never-mail list (email_suppressions, hashed addresses, from
// the same email-marketing migration) is there for Import to check.
export function neverMailListExists(supabase: SupabaseClient): Promise<boolean | null> {
  return tableExists(supabase, "email_suppressions", "email_hash");
}

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
  const notIn = (q: Q) => q.is("imported_member_id", null).is("imported_at", null).is("erased_at", null);
  const ready = (q: Q) => notIn(q.eq("decision", "import").not("import_as", "is", null)).or(READY_FILTER);
  // New on the automatic default, waiting for Approve.
  const newWaiting = (q: Q) => notIn(q.eq("classification", "new").eq("import_as", "new").eq("decision", "import").is("decided_by", null));
  return { count, notIn, ready, newWaiting };
}

const PREVIEW_COLUMNS = "decision, import_as, planned_fills, decided_by, imported_member_id, imported_at, erased_at";

// Every row set to import and not in yet, for the dry run (no contact
// details: just what decides what Import does).
async function pendingImportRows(supabase: SupabaseClient): Promise<IndyPreviewRow[]> {
  const out: IndyPreviewRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("indy_accounts")
      .select(PREVIEW_COLUMNS)
      .eq("decision", "import")
      .not("import_as", "is", null)
      .is("imported_member_id", null)
      .is("imported_at", null)
      .is("erased_at", null)
      .order("indy_user_id")
      .range(from, from + 999);
    if (error) throw error;
    out.push(...(data as unknown as IndyPreviewRow[]));
    if (data.length < 1000) return out;
  }
}

async function erasuresBeforeLastLoad(supabase: SupabaseClient): Promise<number | null> {
  const { data, error } = await supabase.from("indy_accounts").select("loaded_at").order("loaded_at", { ascending: false }).limit(1);
  if (error || !data?.length) return null;
  const { count, error: countErr } = await supabase
    .from("member_erasures")
    .select("id", { count: "exact", head: true })
    .lt("erased_at", (data[0] as { loaded_at: string }).loaded_at);
  return countErr ? null : (count ?? 0);
}

export async function getIndySummary(): Promise<IndySummary> {
  const supabase = createAdminClient();
  const { count, notIn, newWaiting } = counter(supabase);
  const [
    fill,
    fresh,
    conflict,
    skip,
    skippedByHand,
    saidYes,
    saidNo,
    saidNoNew,
    newUnapproved,
    pending,
    imported,
    awaitingReview,
    consentPending,
    consentTables,
    erasedBeforeLoad,
    neverMailList,
  ] = await Promise.all([
    count((q) => q.eq("classification", "fill")),
    count((q) => q.eq("classification", "new")),
    count((q) => q.eq("classification", "conflict")),
    count((q) => q.eq("classification", "skip")),
    count((q) => notIn(q.eq("decision", "skip").neq("classification", "skip"))),
    count((q) => q.eq("said_yes", true)),
    count((q) => q.eq("said_yes", false)),
    count((q) => q.eq("said_yes", false).eq("classification", "new")),
    count(newWaiting),
    pendingImportRows(supabase),
    count((q) => q.not("imported_member_id", "is", null)),
    count((q) => notIn(q.eq("decision", "review"))),
    count((q) => q.not("imported_member_id", "is", null).is("consent_recorded_at", null).is("erased_at", null)),
    consentTablesExist(supabase),
    erasuresBeforeLastLoad(supabase),
    neverMailListExists(supabase),
  ]);
  const preview = importPreview(pending);
  return {
    classes: { fill, new: fresh, conflict, skip },
    skippedByHand,
    saidYes,
    saidNo,
    saidNoNew,
    newUnapproved,
    toImport: preview.ready,
    preview,
    imported,
    awaitingReview,
    consentPending,
    consentTables,
    erasedBeforeLoad,
    neverMailList,
  };
}

// For the link on the Members page. Null when there's nothing loaded, or
// the table isn't there (so that page never fails because of this one).
export async function getIndyOverview(): Promise<{ total: number; imported: number; toImport: number; needsChoice: number } | null> {
  try {
    const { count, notIn, ready, newWaiting } = counter(createAdminClient());
    const [total, imported, toImport, review, unapproved] = await Promise.all([
      count((q) => q),
      count((q) => q.not("imported_member_id", "is", null)),
      count(ready),
      count((q) => notIn(q.eq("decision", "review"))),
      count(newWaiting),
    ]);
    return total > 0 ? { total, imported, toImport, needsChoice: review + unapproved } : null;
  } catch {
    return null;
  }
}

const MATCH = "id, name, email, phone";
const COLUMNS = [
  "indy_user_id, email, first_name, last_name, phone, birthday, indy_created_at, indy_last_visit, indy_membership, indy_type, indy_points, said_yes",
  "classification, reasons, email_member_id, phone_member_id, target_member_id, planned_fills, decision, import_as, decided_by",
  "imported_member_id, erased_at",
  `email_member:members!indy_accounts_email_member_id_fkey(${MATCH})`,
  `phone_member:members!indy_accounts_phone_member_id_fkey(${MATCH})`,
  `target_member:members!indy_accounts_target_member_id_fkey(${MATCH})`,
].join(", ");

export async function getIndyPage(opts: { tab: IndyTab; query?: string; page?: number }): Promise<{ rows: IndyAccount[]; total: number; page: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const supabase = createAdminClient();
  let q = supabase.from("indy_accounts").select(COLUMNS, { count: "exact" });
  // Skip lists the automatic skips and the ones a person skipped (a skip
  // row's decision is always skip).
  q = opts.tab === "skip" ? q.eq("decision", "skip") : q.eq("classification", opts.tab);
  // Commas and parentheses would break the or() filter itself (PostgREST
  // doesn't take a backslash before them), so they become spaces, as in
  // src/lib/data/members.ts. %, _ and \ are escaped for ilike.
  const query = opts.query?.replace(/[,()]/g, " ").replace(/\s+/g, " ").trim();
  if (query) {
    const esc = (s: string) => s.replace(/[%_\\]/g, (c) => `\\${c}`);
    const [first, ...rest] = query.split(" ");
    const whole = esc(query);
    // "Pat Smith" matches first and last name together, too.
    const both = rest.length ? `,and(first_name.ilike.%${esc(first)}%,last_name.ilike.%${esc(rest.join(" "))}%)` : "";
    q = q.or(`first_name.ilike.%${whole}%,last_name.ilike.%${whole}%,email.ilike.%${whole}%${both}`);
  }
  const from = (page - 1) * INDY_PAGE_SIZE;
  // Pseudo-random but stable order, so each page is a fair spot-check.
  const { data, error, count } = await q.order("shuffle").range(from, from + INDY_PAGE_SIZE - 1);
  // Not the raw error: PostgREST's repeats the filter, which holds the search.
  if (error) throw new Error("Couldn't read the Indy accounts.");
  return { rows: (data ?? []) as unknown as IndyAccount[], total: count ?? 0, page };
}
