"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { consentTablesExist, neverMailListExists } from "@/lib/data/indy";
import {
  fillPlan,
  indyConsentSource,
  NEVER_MAIL_REASON,
  newMemberRow,
  plannedFills,
  READY_FILTER,
  readyToImport,
  SAME_EMAIL_REASON,
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
    .select(
      "indy_user_id, email, first_name, last_name, phone, birthday, said_yes, classification, reasons, email_member_id, phone_member_id, import_as, said_no_review, said_no_decision, imported_member_id, imported_at, erased_at"
    )
    .eq("indy_user_id", indyUserId)
    .maybeSingle();
  if (readErr) return { ok: false, error: "Couldn't read that account. Try again." };
  if (!row) return { ok: false, error: "Couldn't find that account." };
  if (row.imported_member_id || row.imported_at) return { ok: false, error: "Already imported. Change the member on the Members page instead." };
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
    if ((row.reasons ?? []).includes(NEVER_MAIL_REASON)) return { ok: false, error: "That address is on the never-mail list, so it can't be added as a new member." };
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
    .is("imported_member_id", null)
    .is("imported_at", null);
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
    .is("imported_at", null)
    .is("erased_at", null)
    .select("indy_user_id");
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  if (!data?.length) return { ok: false, error: "That account isn't waiting on this any more (already imported, or no longer a said-no)." };
  revalidate();
  return { ok: true };
}

// Every new account still on the automatic default, approved by this
// person: the next Import adds them. Ones skipped by hand stay skipped.
export async function approveAllNewIndy(): Promise<Result<{ count: number }>> {
  const staff = await assertAdmin();
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("indy_accounts")
    .update({ decision: "import", decided_by: staff.employeeId, decided_at: new Date().toISOString() })
    .eq("classification", "new")
    .eq("import_as", "new")
    .eq("decision", "import")
    .is("decided_by", null)
    .is("imported_member_id", null)
    .is("imported_at", null)
    .is("erased_at", null)
    .select("indy_user_id");
  if (error) return { ok: false, error: "Couldn't approve them. Try again." };
  revalidate();
  return { ok: true, count: data?.length ?? 0 };
}

// Honor or leave every "said no" that's still waiting. Ones already set one
// by one keep that choice, and skipped ones stay skipped.
export async function setAllIndySaidNo(decision: "honor" | "leave"): Promise<Result<{ count: number }>> {
  const staff = await assertAdmin();
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("indy_accounts")
    .update({ said_no_decision: decision, decided_by: staff.employeeId, decided_at: new Date().toISOString() })
    .eq("said_no_review", true)
    .eq("said_no_decision", "pending")
    .neq("decision", "skip")
    .is("imported_member_id", null)
    .is("imported_at", null)
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

const HASH_CHUNK = 50; // never-mail hashes per .in() filter (64 characters each)

type ImportRow = IndyImportRow & { reasons: string[]; email_member_id: string | null };
const IMPORT_COLUMNS =
  "indy_user_id, email, first_name, last_name, phone, birthday, indy_created_at, said_yes, said_no_review, said_no_decision, decision, import_as, target_member_id, classification, decided_by, imported_member_id, imported_at, erased_at, reasons, email_member_id";

interface Mark {
  indy_user_id: string;
  member_id: string | null;
  honored?: boolean;
  consent?: boolean;
  // The fields this press wrote on a member who was already here, kept so
  // a wrong fill can be undone exactly.
  filled?: string[];
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

// The never-mail list keys an address as sha256(lower(trim(email))) in hex,
// the same as the email-marketing migration works it out in SQL.
const emailHash = (email: string) => createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex");

// Which of these addresses are on the never-mail list. Null if it couldn't
// be read.
async function onNeverMailList(supabase: SupabaseClient, emails: string[]): Promise<Set<string> | null> {
  const byHash = new Map(emails.map((e) => [emailHash(e), e]));
  const found = new Set<string>();
  for (const part of chunks([...byHash.keys()], HASH_CHUNK)) {
    const { data, error } = await supabase.from("email_suppressions").select("email_hash").in("email_hash", part);
    if (error) return null;
    for (const s of data as { email_hash: string }[]) {
      const email = byHash.get(s.email_hash);
      if (email) found.add(email);
    }
  }
  return found;
}

// The live member who has this email, if any (for a row sent back because
// someone with its email joined), so the conflict offers "Fill email match".
async function memberWithEmail(supabase: SupabaseClient, email: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("members")
    .select("id, email")
    .ilike("email", email.replace(/[%_\\]/g, (c) => `\\${c}`))
    .is("erased_at", null)
    .limit(5);
  if (error) return null;
  return (data as { id: string; email: string | null }[]).find((m) => (m.email ?? "").trim().toLowerCase() === email)?.id ?? null;
}

interface ImportContext {
  now: string;
  taken: Map<string, string>; // email -> member id, for every live member with an email
  indyEmails: Map<string, Set<string>>; // email -> the Indy accounts with it (not skipped, not removed)
  neverMailList: boolean; // email_suppressions is there to check
  tally: Tally;
}

async function importBatch(supabase: SupabaseClient, rows: ImportRow[], ctx: ImportContext): Promise<string | null> {
  const { now, taken, indyEmails, tally } = ctx;
  // A member already carrying one of these Indy ids is a batch that went in
  // but wasn't marked (a timeout, say): mark it now instead of adding twice.
  const already = await membersWhere(supabase, "indy_user_id", rows.map((r) => r.indy_user_id));
  const targetIds = [...new Set(rows.map((r) => (r.import_as === "fill" ? r.target_member_id : null)).filter((id): id is string => !!id))];
  const targetList = await membersWhere(supabase, "id", targetIds);
  if (!already || !targetList) return "Couldn't read the members to fill.";
  const linkedTo = new Map(already.filter((m) => !m.erased_at).map((m) => [m.indy_user_id as string, m]));
  const targets = new Map(targetList.map((m) => [m.id, m]));
  // Nobody on the never-mail list (they asked us to stop, or were removed
  // after unsubscribing) comes back as a new member.
  const newEmails = rows.filter((r) => r.import_as === "new" && r.email).map((r) => r.email as string);
  const suppressed = ctx.neverMailList && newEmails.length ? await onNeverMailList(supabase, newEmails) : new Set<string>();
  if (!suppressed) return "Couldn't check the never-mail list.";

  const marks: Mark[] = [];
  const backs: SendBack[] = [];
  const fills: { row: ImportRow; member: IndyMember; plan: ReturnType<typeof fillPlan> }[] = [];
  const inserts: ImportRow[] = [];

  const adding = new Set<string>(); // emails being added in this batch
  const filling = new Set<string>(); // members being filled in this batch
  for (const row of rows) {
    const linked = linkedTo.get(row.indy_user_id);
    if (row.import_as === "new") {
      const sharedWith = [...(indyEmails.get(row.email ?? "") ?? [])].filter((id) => id !== row.indy_user_id);
      if (linked) marks.push({ indy_user_id: row.indy_user_id, member_id: linked.id });
      else if (!row.email) backs.push({ row, reason: "no email to add them with" });
      else if (suppressed.has(row.email)) backs.push({ row, reason: NEVER_MAIL_REASON });
      else if (taken.has(row.email)) backs.push({ row, reason: "someone with this email joined since the load", emailMemberId: taken.get(row.email) });
      // Another Indy account with this email is in Members or on its way
      // (filling a member with no email, say): adding this one could give one
      // person two members. Someone who picked "Add as new" on the conflict
      // has seen that, so only the automatic sort is held back.
      else if (row.classification === "new" && sharedWith.length) backs.push({ row, reason: SAME_EMAIL_REASON });
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
    const member = targets.get(row.target_member_id);
    const plan = fillPlan(row, member, now);
    if (plan.problem || !member) backs.push({ row, reason: plan.problem ?? "the matched member is gone" });
    else {
      filling.add(row.target_member_id);
      fills.push({ row, member, plan });
    }
  }

  // Fill in what's still empty on members who are already here. Each field
  // is written only if it's still what was read a moment ago, so a phone,
  // birthday or name the member (or staff) put in since is never
  // overwritten, and an honored "no" never overrides a choice they just
  // made. The link only goes on a member with none.
  let failed = false;
  await eachLimit(fills, 8, async ({ row, member, plan }) => {
    if (failed) return;
    if (Object.keys(plan.patch).length) {
      let update = supabase.from("members").update(plan.patch).eq("id", member.id).is("erased_at", null);
      if ("indy_user_id" in plan.patch) update = update.is("indy_user_id", null);
      if ("phone" in plan.patch) update = member.phone === null ? update.is("phone", null) : update.eq("phone", member.phone);
      if ("birthday" in plan.patch) update = update.is("birthday", null);
      if ("name" in plan.patch) update = member.name === null ? update.is("name", null) : update.eq("name", member.name);
      if ("email_opt_in" in plan.patch) update = update.is("email_opt_in_changed_at", null);
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
        backs.push({ row, reason: "that member changed while importing; pick again" });
        return;
      }
    }
    marks.push({ indy_user_id: row.indy_user_id, member_id: member.id, honored: plan.honored, filled: plan.filled });
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
          if (/indy_user_id/.test(oneErr.message ?? "")) backs.push({ row, reason: "this Indy account is already linked to a member" });
          else backs.push({ row, reason: "someone with this email joined since the load", emailMemberId: await memberWithEmail(supabase, row.email as string) });
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

// Copies every ready, not-yet-imported Indy account into members:
// - a fill fills only what's still empty on that member (phone, birthday, a
//   placeholder name), never the email, and links the Indy account;
// - a new account a person approved becomes a free Insider, with email on
//   or off as they answered on Indy (a recorded choice, dated when they gave
//   it), unless its address is on the never-mail list or another Indy
//   account shares it (those go back to Conflict);
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
  // Which Indy accounts share an email (skipped and removed ones aside).
  const indyEmails = new Map<string, Set<string>>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("indy_accounts")
      .select("indy_user_id, email")
      .not("email", "is", null)
      .neq("decision", "skip")
      .is("erased_at", null)
      .order("indy_user_id")
      .range(from, from + 999);
    if (error) return { ok: false, error: "Couldn't read the Indy accounts. Nothing was changed." };
    for (const r of data as { indy_user_id: string; email: string }[]) {
      const email = r.email.trim().toLowerCase();
      indyEmails.set(email, (indyEmails.get(email) ?? new Set<string>()).add(r.indy_user_id));
    }
    if (data.length < 1000) break;
  }
  const neverMailList = await neverMailListExists(supabase);
  if (neverMailList === null) return { ok: false, error: "Couldn't check the never-mail list. Nothing was changed." };
  const ctx: ImportContext = { now, taken, indyEmails, neverMailList, tally };

  let stopped: string | null = null;
  while (!stopped && Date.now() < deadline) {
    const { data, error } = await supabase
      .from("indy_accounts")
      .select(IMPORT_COLUMNS)
      .eq("decision", "import")
      .not("import_as", "is", null)
      .is("imported_member_id", null)
      .is("imported_at", null)
      .is("erased_at", null)
      .or(READY_FILTER)
      .order("indy_user_id")
      .limit(BATCH);
    if (error) {
      stopped = "Couldn't read the accounts ready to import.";
      break;
    }
    const rows = (data as unknown as ImportRow[]).filter(readyToImport);
    if (!rows.length) break;
    stopped = await importBatch(supabase, rows, ctx);
  }

  const tables = await consentTablesExist(supabase);
  if (!stopped && tables === true) stopped = await recordConsent(supabase, staff.employeeId, deadline, tally);

  const ready = await supabase
    .from("indy_accounts")
    .select("indy_user_id", { count: "exact", head: true })
    .eq("decision", "import")
    .not("import_as", "is", null)
    .is("imported_member_id", null)
    .is("imported_at", null)
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
