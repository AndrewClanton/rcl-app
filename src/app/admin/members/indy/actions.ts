"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { consentTablesExist, READY_FILTER } from "@/lib/data/indy";
import {
  fillPlan,
  indyConsentSource,
  newMemberRow,
  plannedFills,
  readyToImport,
  saidNoReview,
  takesIndyConsent,
  type IndyImportRow,
  type IndyMember,
} from "@/lib/indy-rules";

// Returned rather than thrown: production redacts thrown messages, and the
// import's outcome (how many added / filled / sent back) is the whole point.
export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

// What a person can pick for one row. New and fill rows: import or skip. A
// conflict: fill the member the email matched, fill the one the phone
// matched, add them as a new member, or skip.
export type IndyChoice = "import" | "skip" | "fill_email" | "fill_phone" | "new";

function revalidate() {
  revalidatePath("/admin/members/indy");
  revalidatePath("/admin/members");
}

const MEMBER_COLUMNS = "id, name, email, phone, birthday, email_opt_in, email_opt_in_changed_at, indy_user_id, erased_at";

export async function setIndyChoice(indyUserId: string, choice: IndyChoice): Promise<Result<object>> {
  const staff = await assertAdmin();
  const supabase = createAdminClient();
  const { data: row, error: readErr } = await supabase
    .from("indy_accounts")
    .select("indy_user_id, email, first_name, last_name, phone, birthday, said_yes, classification, email_member_id, phone_member_id, import_as, said_no_review, said_no_decision, imported_member_id, erased_at")
    .eq("indy_user_id", indyUserId)
    .maybeSingle();
  if (readErr) return { ok: false, error: "Couldn't read that account. Try again." };
  if (!row) return { ok: false, error: "Couldn't find that account." };
  if (row.imported_member_id) return { ok: false, error: "Already imported. Change the member on the Members page instead." };
  if (row.erased_at) return { ok: false, error: "This person asked to be removed, so they can't be imported." };
  if (row.classification === "skip" && choice !== "skip") return { ok: false, error: "Skipped accounts can't be imported from here." };

  let patch: Record<string, unknown>;
  if (choice === "skip") patch = { decision: "skip" };
  else if (choice === "import") {
    if (!row.import_as) return { ok: false, error: "Pick which member to fill, or add them as new." };
    patch = { decision: "import" };
  } else if (choice === "new") {
    if (!row.email) return { ok: false, error: "This account has no email, so it can't be a new member." };
    if (row.email_member_id) return { ok: false, error: "That email already belongs to a member. Fill the email match instead." };
    patch = { decision: "import", import_as: "new", target_member_id: null, planned_fills: [], said_no_review: false, said_no_decision: null };
  } else {
    const targetId = choice === "fill_email" ? row.email_member_id : row.phone_member_id;
    if (!targetId) return { ok: false, error: choice === "fill_email" ? "No member has this email." : "No single member has this phone number." };
    const { data: member, error } = await supabase.from("members").select(MEMBER_COLUMNS).eq("id", targetId).maybeSingle();
    if (error) return { ok: false, error: "Couldn't read that member. Try again." };
    const m = member as IndyMember | null;
    if (!m || m.erased_at) return { ok: false, error: "That member isn't there any more." };
    if (m.indy_user_id && m.indy_user_id !== row.indy_user_id) return { ok: false, error: "That member is already linked to a different Indy account." };
    // Picking a member can turn this into a "said no on Indy" row (or stop
    // it being one), so that's worked out again here.
    const review = saidNoReview(row, m);
    patch = {
      decision: "import",
      import_as: "fill",
      target_member_id: m.id,
      planned_fills: plannedFills(row, m),
      said_no_review: review,
      said_no_decision: review ? (row.said_no_review && row.said_no_decision ? row.said_no_decision : "pending") : null,
    };
  }

  const { error } = await supabase
    .from("indy_accounts")
    .update({ ...patch, decided_by: staff.employeeId, decided_at: new Date().toISOString() })
    .eq("indy_user_id", indyUserId)
    .is("imported_member_id", null);
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  revalidate();
  return { ok: true };
}

// "Honor the no" turns the member's email off at import; "Leave as is"
// keeps it on. Either way nothing changes until Import.
export async function setIndySaidNo(indyUserId: string, decision: "honor" | "leave"): Promise<Result<object>> {
  const staff = await assertAdmin();
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("indy_accounts")
    .update({ said_no_decision: decision, decided_by: staff.employeeId, decided_at: new Date().toISOString() })
    .eq("indy_user_id", indyUserId)
    .eq("said_no_review", true)
    .is("imported_member_id", null)
    .is("erased_at", null)
    .select("indy_user_id");
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  if (!data?.length) return { ok: false, error: "That account isn't waiting on this any more (already imported, or no longer a said-no)." };
  revalidate();
  return { ok: true };
}

// Every new account still on the automatic default, approved by this
// person. Ones skipped by hand stay skipped.
export async function approveAllNewIndy(): Promise<Result<{ count: number }>> {
  const staff = await assertAdmin();
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("indy_accounts")
    .update({ decision: "import", decided_by: staff.employeeId, decided_at: new Date().toISOString() })
    .eq("classification", "new")
    .eq("import_as", "new")
    .is("decided_by", null)
    .is("imported_member_id", null)
    .is("erased_at", null)
    .select("indy_user_id");
  if (error) return { ok: false, error: "Couldn't approve them. Try again." };
  revalidate();
  return { ok: true, count: data?.length ?? 0 };
}

// Honor or leave every "said no" that's still waiting. Ones already set one
// by one keep that choice.
export async function setAllIndySaidNo(decision: "honor" | "leave"): Promise<Result<{ count: number }>> {
  const staff = await assertAdmin();
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("indy_accounts")
    .update({ said_no_decision: decision, decided_by: staff.employeeId, decided_at: new Date().toISOString() })
    .eq("said_no_review", true)
    .eq("said_no_decision", "pending")
    .is("imported_member_id", null)
    .is("erased_at", null)
    .select("indy_user_id");
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  revalidate();
  return { ok: true, count: data?.length ?? 0 };
}

// ---------- Import ----------

const BATCH = 500;
// One press works for about this long, then stops cleanly (the page allows
// the action 120 seconds).
const TIME_BUDGET_MS = 75_000;
const IN_CHUNK = 100; // ids per .in() filter, to keep URLs short

type ImportRow = IndyImportRow & { reasons: string[]; email_member_id: string | null };
const IMPORT_COLUMNS =
  "indy_user_id, email, first_name, last_name, phone, birthday, indy_created_at, said_yes, said_no_review, said_no_decision, decision, import_as, target_member_id, imported_member_id, erased_at, reasons, email_member_id";

interface Mark {
  indy_user_id: string;
  member_id: string | null;
  honored?: boolean;
  consent?: boolean;
}
interface SendBack {
  row: ImportRow;
  reason: string;
  emailMemberId?: string | null;
}
interface Tally {
  added: number;
  filled: number;
  linked: number;
  honored: number;
  keptTheirChoice: number;
  consentRecorded: number;
  sentBack: string[];
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Runs fn over items, a few at a time.
async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    })
  );
}

async function membersWhere(supabase: SupabaseClient, column: "id" | "indy_user_id", values: string[]): Promise<IndyMember[] | null> {
  const out: IndyMember[] = [];
  for (const part of chunks(values, IN_CHUNK)) {
    const { data, error } = await supabase.from("members").select(MEMBER_COLUMNS).in(column, part);
    if (error) return null;
    out.push(...(data as IndyMember[]));
  }
  return out;
}

const label = (r: ImportRow) => r.email ?? ([r.first_name, r.last_name].filter(Boolean).join(" ") || `Indy #${r.indy_user_id}`);

// A row the import can't do right now goes back to Conflict with the reason,
// for a person to pick again (and so the next batch doesn't pick it up).
async function sendBack(supabase: SupabaseClient, b: SendBack): Promise<boolean> {
  const { error } = await supabase
    .from("indy_accounts")
    .update({
      classification: "conflict",
      decision: "review",
      import_as: null,
      target_member_id: null,
      planned_fills: [],
      said_no_review: false,
      said_no_decision: null,
      reasons: [b.reason, ...b.row.reasons.filter((x) => x !== b.reason)],
      email_member_id: b.emailMemberId ?? b.row.email_member_id,
      decided_by: null,
      decided_at: null,
    })
    .eq("indy_user_id", b.row.indy_user_id)
    .is("imported_member_id", null);
  return !error;
}

async function importBatch(supabase: SupabaseClient, rows: ImportRow[], taken: Map<string, string>, now: string, tally: Tally): Promise<string | null> {
  // A member already carrying one of these Indy ids is a batch that went in
  // but wasn't marked (a timeout, say): mark it now instead of adding twice.
  const already = await membersWhere(supabase, "indy_user_id", rows.map((r) => r.indy_user_id));
  const targetIds = [...new Set(rows.map((r) => (r.import_as === "fill" ? r.target_member_id : null)).filter((id): id is string => !!id))];
  const targetList = await membersWhere(supabase, "id", targetIds);
  if (!already || !targetList) return "Couldn't read the members to fill.";
  const linkedTo = new Map(already.filter((m) => !m.erased_at).map((m) => [m.indy_user_id as string, m]));
  const targets = new Map(targetList.map((m) => [m.id, m]));

  const marks: Mark[] = [];
  const backs: SendBack[] = [];
  const fills: { row: ImportRow; memberId: string; plan: ReturnType<typeof fillPlan> }[] = [];
  const inserts: ImportRow[] = [];

  const adding = new Set<string>(); // emails being added in this batch
  const filling = new Set<string>(); // members being filled in this batch
  for (const row of rows) {
    const linked = linkedTo.get(row.indy_user_id);
    if (row.import_as === "new") {
      if (linked) marks.push({ indy_user_id: row.indy_user_id, member_id: linked.id });
      else if (!row.email) backs.push({ row, reason: "no email to add them with" });
      else if (taken.has(row.email)) backs.push({ row, reason: "someone with this email joined since the load", emailMemberId: taken.get(row.email) });
      else if (adding.has(row.email)) backs.push({ row, reason: "another Indy account with this email is being added" });
      else {
        adding.add(row.email);
        inserts.push(row);
      }
      continue;
    }
    if (!row.target_member_id) {
      backs.push({ row, reason: "no member picked to fill" });
      continue;
    }
    if (linked && linked.id !== row.target_member_id) {
      backs.push({ row, reason: "this Indy account is already linked to a different member" });
      continue;
    }
    if (filling.has(row.target_member_id)) {
      backs.push({ row, reason: "another Indy account is filling the same member" });
      continue;
    }
    const plan = fillPlan(row, targets.get(row.target_member_id), now);
    if (plan.problem) backs.push({ row, reason: plan.problem });
    else {
      filling.add(row.target_member_id);
      fills.push({ row, memberId: row.target_member_id, plan });
    }
  }

  // Fill in what's still empty on members who are already here. The link
  // only goes on a member with none, so one can never be overwritten.
  let failed = false;
  await eachLimit(fills, 8, async ({ row, memberId, plan }) => {
    if (failed) return;
    if (Object.keys(plan.patch).length) {
      let update = supabase.from("members").update(plan.patch).eq("id", memberId).is("erased_at", null);
      if (plan.patch.indy_user_id) update = update.is("indy_user_id", null);
      const { data, error } = await update.select("id");
      if (error?.code === "23505") {
        backs.push({ row, reason: "this Indy account is already linked to a different member" });
        return;
      }
      if (error) {
        failed = true;
        return;
      }
      if (!data.length) {
        backs.push({ row, reason: "that member changed while importing (linked elsewhere or removed)" });
        return;
      }
    }
    marks.push({ indy_user_id: row.indy_user_id, member_id: memberId, honored: plan.honored });
    if (plan.filled.length) tally.filled++;
    else tally.linked++;
    if (plan.honored) tally.honored++;
    if (plan.keptTheirChoice) tally.keptTheirChoice++;
  });

  // New free Insiders. A clash on email means someone joined since the
  // load (or since this press read the member list): that row goes back.
  if (!failed && inserts.length) {
    const { data, error } = await supabase.from("members").insert(inserts.map((r) => newMemberRow(r, now))).select("id, indy_user_id, email");
    if (!error) {
      for (const m of data) {
        marks.push({ indy_user_id: m.indy_user_id, member_id: m.id });
        taken.set(m.email.toLowerCase(), m.id);
      }
      tally.added += data.length;
    } else if (error.code === "23505") {
      for (const row of inserts) {
        const { data: one, error: oneErr } = await supabase.from("members").insert(newMemberRow(row, now)).select("id").single();
        if (!oneErr) {
          marks.push({ indy_user_id: row.indy_user_id, member_id: one.id });
          taken.set(row.email as string, one.id);
          tally.added++;
        } else if (oneErr.code === "23505") {
          const byIndy = /indy_user_id/.test(oneErr.message ?? "");
          backs.push({ row, reason: byIndy ? "this Indy account is already linked to a member" : "someone with this email joined since the load" });
        } else {
          failed = true;
          break;
        }
      }
    } else failed = true;
  }

  // Mark what went in, even after a failure, so a re-run doesn't redo it.
  for (const part of chunks(marks, BATCH)) {
    const { error } = await supabase.rpc("mark_indy_accounts", { p_rows: part });
    if (error) return "Members were changed, but marking them imported failed. Run the import again to finish.";
  }
  for (const b of backs) {
    if (!(await sendBack(supabase, b))) return "Couldn't send a row back for review. Run the import again.";
    tally.sentBack.push(`${label(b.row)} (${b.reason})`);
  }
  return failed ? "Stopped partway: a member couldn't be saved. Run the import again to continue; it picks up where it left off." : null;
}

// Each imported member's Indy answer, into the email-marketing tables: the
// consent source where none better is recorded, and a log entry (plus an
// opt-out entry for an honored "no"). Rows imported before those tables
// existed are caught up here too. Returns an error message, or null.
async function recordConsent(supabase: SupabaseClient, employeeId: string, deadline: number, tally: Tally): Promise<string | null> {
  const now = new Date().toISOString();
  while (Date.now() < deadline) {
    const { data, error } = await supabase
      .from("indy_accounts")
      .select("indy_user_id, imported_member_id, said_yes, indy_created_at, said_no_honored_at, import_as")
      .not("imported_member_id", "is", null)
      .is("consent_recorded_at", null)
      .is("erased_at", null)
      .order("indy_user_id")
      .limit(BATCH);
    if (error) return "Couldn't read which Indy answers still need recording.";
    const rows = data as { indy_user_id: string; imported_member_id: string; said_yes: boolean; indy_created_at: string | null; said_no_honored_at: string | null; import_as: string | null }[];
    if (!rows.length) return null;

    const sources = new Map<string, string>();
    for (const part of chunks(rows.map((r) => r.imported_member_id), IN_CHUNK)) {
      const { data: prefs, error: prefsErr } = await supabase.from("member_email_prefs").select("member_id, consent_source").in("member_id", part);
      if (prefsErr) return "Couldn't read email preferences.";
      for (const p of prefs) sources.set(p.member_id, p.consent_source);
    }
    const prefs = rows
      .filter((r) => takesIndyConsent(sources.get(r.imported_member_id)))
      .map((r) => ({ member_id: r.imported_member_id, consent_source: indyConsentSource(r.said_yes), consent_at: r.indy_created_at ?? now, updated_at: now }));
    if (prefs.length) {
      const { error: upErr } = await supabase.from("member_email_prefs").upsert(prefs, { onConflict: "member_id" });
      if (upErr) return "Couldn't save email preferences.";
    }
    const log = rows.flatMap((r) => {
      const answer = r.said_yes ? "yes" : "no";
      const entry = { member_id: r.imported_member_id, action: "import", source: "indy_import", detail: { indy_answer: answer, ...(r.import_as === "new" ? { new_member: true } : {}) }, by_employee: employeeId };
      return r.said_no_honored_at ? [entry, { ...entry, action: "opt_out", detail: { indy_answer: answer } }] : [entry];
    });
    const { error: logErr } = await supabase.from("email_consent_log").insert(log);
    if (logErr) return "Couldn't write the email consent log.";
    const { error: markErr } = await supabase.rpc("mark_indy_accounts", { p_rows: rows.map((r) => ({ indy_user_id: r.indy_user_id, member_id: null, consent: true })) });
    if (markErr) return "Answers were recorded, but marking them failed. Run the import again to finish.";
    tally.consentRecorded += rows.length;
  }
  return null;
}

// Copies every approved, not-yet-imported Indy account into members:
// - a fill fills only what's still empty on that member (phone, birthday, a
//   placeholder name), never the email, and links the Indy account;
// - a new account becomes a free Insider, with email on or off as they
//   answered on Indy (a recorded choice, dated when they gave it);
// - an existing member's email setting changes only for a "no" marked
//   Honor, and only if they're still opted in by the old default.
// Points, visits, photos, addresses and paid plans are not imported. No
// logins are created and no email is sent. Works in batches of 500 for
// about 75 seconds a press; safe to run again, it picks up where it left off.
export async function importApprovedIndyAccounts(): Promise<Result<Tally & { remaining: number; consent: "recorded" | "waiting" | "unknown" }>> {
  const staff = await assertAdmin();
  const supabase = createAdminClient();
  const deadline = Date.now() + TIME_BUDGET_MS;
  const now = new Date().toISOString();
  const tally: Tally = { added: 0, filled: 0, linked: 0, honored: 0, keptTheirChoice: 0, consentRecorded: 0, sentBack: [] };

  // Emails already taken by a member (an erased member's is blanked).
  const taken = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("members").select("id, email").not("email", "is", null).order("id").range(from, from + 999);
    if (error) return { ok: false, error: "Couldn't read existing members. Nothing was changed." };
    for (const m of data) taken.set(m.email.trim().toLowerCase(), m.id);
    if (data.length < 1000) break;
  }

  let stopped: string | null = null;
  while (!stopped && Date.now() < deadline) {
    const { data, error } = await supabase
      .from("indy_accounts")
      .select(IMPORT_COLUMNS)
      .eq("decision", "import")
      .not("import_as", "is", null)
      .is("imported_member_id", null)
      .is("erased_at", null)
      .or(READY_FILTER)
      .order("indy_user_id")
      .limit(BATCH);
    if (error) {
      stopped = "Couldn't read the approved accounts.";
      break;
    }
    const rows = (data as ImportRow[]).filter(readyToImport);
    if (!rows.length) break;
    stopped = await importBatch(supabase, rows, taken, now, tally);
  }

  const tables = await consentTablesExist(supabase);
  if (!stopped && tables === true) stopped = await recordConsent(supabase, staff.employeeId, deadline, tally);

  const ready = await supabase
    .from("indy_accounts")
    .select("indy_user_id", { count: "exact", head: true })
    .eq("decision", "import")
    .not("import_as", "is", null)
    .is("imported_member_id", null)
    .is("erased_at", null)
    .or(READY_FILTER);
  const unrecorded =
    tables === true
      ? await supabase
          .from("indy_accounts")
          .select("indy_user_id", { count: "exact", head: true })
          .not("imported_member_id", "is", null)
          .is("consent_recorded_at", null)
          .is("erased_at", null)
      : { count: 0 };
  revalidate();

  const done = [
    tally.added && `added ${tally.added}`,
    tally.filled && `filled details on ${tally.filled}`,
    tally.linked && `linked ${tally.linked}`,
    tally.honored && `turned email off for ${tally.honored}`,
  ].filter(Boolean);
  if (stopped) return { ok: false, error: `${stopped}${done.length ? ` (Before stopping: ${done.join(", ")}.)` : ""}` };
  return {
    ok: true,
    ...tally,
    remaining: (ready.count ?? 0) + (unrecorded.count ?? 0),
    consent: tables === true ? "recorded" : tables === false ? "waiting" : "unknown",
  };
}
