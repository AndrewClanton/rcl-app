import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exactEmail } from "@/lib/email-match";
import {
  addContactToSegment,
  contactInSegment,
  createContact,
  deleteContact,
  findOrCreateSegment,
  getContact,
  listSegmentContacts,
  updateContact,
} from "@/lib/email/resend";

// The members' mailing list lives in Resend as one segment of contacts, and
// our members table decides who is on it. Resend only ever holds the people
// who are subscribed right now: opting out, having your personal info
// removed, or changing your email deletes the old contact.
//
// Kept in step three ways:
//  - right after a change on the website (syncMemberSoon, after the page
//    has answered, so nobody waits on Resend);
//  - a full comparison (reconcileMailingList) every night, from the
//    Mailing list page, and before every send -- this catches changes made
//    anywhere else, like the register's check-in kiosk;
//  - Resend -> us: an unsubscribe link or a spam complaint turns
//    email_opt_in off, through the webhook (api/resend/webhook) or, if that
//    was missed, the next full comparison. Resend can only ever turn
//    someone off here, never on.

export const SEGMENT_NAME = "Royale Insiders (website)";

export function mailingListConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

let segmentCache: string | null = null;

// RESEND_SEGMENT_ID if it's set; otherwise the segment named SEGMENT_NAME,
// made the first time it's needed.
export async function listSegmentId(): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const fromEnv = process.env.RESEND_SEGMENT_ID?.trim();
  if (fromEnv) return { ok: true, id: fromEnv };
  if (segmentCache) return { ok: true, id: segmentCache };
  const r = await findOrCreateSegment(SEGMENT_NAME);
  if (!r.ok) return { ok: false, error: r.error };
  segmentCache = r.data;
  return { ok: true, id: r.data };
}

interface MemberRow {
  id: string;
  name: string;
  email: string | null;
  email_opt_in: boolean | null;
  email_opt_in_changed_at: string | null;
  erased_at: string | null;
}

// On the list: said yes, and it was recorded when (every way of opting in
// stamps email_opt_in_changed_at; the old "on by default" never did), and
// still has an email and their personal info.
export function isSubscribed(m: Pick<MemberRow, "email" | "email_opt_in" | "email_opt_in_changed_at" | "erased_at">): boolean {
  return !!m.email && m.email_opt_in === true && !!m.email_opt_in_changed_at && !m.erased_at;
}

// The first name Resend greets them with ("Hi Sam,"). Resend drops it into
// the email as-is, so anything that could read as HTML or template markup
// is stripped.
export function firstNameOf(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0].replace(/[<>&"'{}\\|]/g, "");
  return first ? first.slice(0, 50) : null;
}

export interface Subscriber {
  id: string;
  name: string;
  email: string;
}

// Everyone who should be on the list. Pages through the table, since the
// database hands back at most 1,000 rows per request.
export async function getSubscribers(): Promise<Subscriber[]> {
  const supabase = createAdminClient();
  const out: Subscriber[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("members")
      .select("id, name, email")
      .eq("email_opt_in", true)
      .not("email_opt_in_changed_at", "is", null)
      .is("erased_at", null)
      .not("email", "is", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error("Couldn't read the members list.");
    out.push(...(data as Subscriber[]));
    if (data.length < 1000) break;
  }
  return out;
}

export async function countSubscribers(): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("email_opt_in", true)
    .not("email_opt_in_changed_at", "is", null)
    .is("erased_at", null)
    .not("email", "is", null);
  if (error) throw new Error("Couldn't count the list.");
  return count ?? 0;
}

// Turns email off for whoever has this address, because they unsubscribed
// through Resend or marked an email as spam. `at` is when that happened, if
// known: a choice they made on our site after it wins.
export async function optOutByEmail(email: string, at: string | null = null): Promise<number> {
  const supabase = createAdminClient();
  const { data: rows, error } = await supabase
    .from("members")
    .select("id, email_opt_in, email_opt_in_changed_at")
    .ilike("email", exactEmail(email))
    .eq("email_opt_in", true);
  if (error) throw new Error("Couldn't read the member.");
  let changed = 0;
  for (const m of rows ?? []) {
    if (at && m.email_opt_in_changed_at && new Date(m.email_opt_in_changed_at).getTime() > new Date(at).getTime()) continue;
    const { data, error: updErr } = await supabase
      .from("members")
      .update({ email_opt_in: false, email_opt_in_changed_at: new Date().toISOString() })
      .eq("id", m.id)
      .eq("email_opt_in", true)
      .select("id");
    if (updErr) throw new Error("Couldn't save the unsubscribe.");
    changed += data?.length ?? 0;
  }
  return changed;
}

type Step = { ok: true } | { ok: false; error: string };

// Makes sure this subscriber is a subscribed contact in the list's segment.
// If Resend says they unsubscribed and we haven't caught up, that wins --
// unless they just said yes again on our site (`freshOptIn`).
async function ensureOnList(m: { email: string; name: string }, segmentId: string, freshOptIn: boolean): Promise<Step & { optedOut?: boolean }> {
  const firstName = firstNameOf(m.name);
  const existing = await getContact(m.email);
  if (!existing.ok && existing.status !== 404) return { ok: false, error: existing.error };
  if (!existing.ok) {
    const made = await createContact({ email: m.email, firstName, segmentId });
    return made.ok ? { ok: true } : { ok: false, error: made.error };
  }
  if (existing.data.unsubscribed && !freshOptIn) {
    await optOutByEmail(m.email);
    const del = await deleteContact(m.email);
    return del.ok ? { ok: true, optedOut: true } : { ok: false, error: del.error };
  }
  if (existing.data.unsubscribed || (existing.data.first_name ?? null) !== firstName) {
    const upd = await updateContact(m.email, { firstName, unsubscribed: false });
    if (!upd.ok) return { ok: false, error: upd.error };
  }
  const inSeg = await contactInSegment(m.email, segmentId);
  if (!inSeg.ok) return { ok: false, error: inSeg.error };
  if (!inSeg.data) {
    const add = await addContactToSegment(m.email, segmentId);
    if (!add.ok) return { ok: false, error: add.error };
  }
  return { ok: true };
}

export interface SyncMemberOptions {
  // Their email before this change, so the old contact goes too.
  previousEmail?: string | null;
  // They just turned email on themselves, so it overrides an older
  // unsubscribe that Resend still has.
  freshOptIn?: boolean;
  // An email address to take off the list outright (personal info removed:
  // the member row no longer has it).
  removeEmail?: string | null;
}

// Brings one member's contact in line with our records. Never throws.
export async function syncMember(memberId: string | null, opts: SyncMemberOptions = {}): Promise<Step> {
  if (!mailingListConfigured()) return { ok: true };
  try {
    const errors: string[] = [];
    const m = memberId
      ? ((await createAdminClient().from("members").select("id, name, email, email_opt_in, email_opt_in_changed_at, erased_at").eq("id", memberId).maybeSingle()).data as MemberRow | null)
      : null;
    const current = m?.email?.trim().toLowerCase() ?? null;
    for (const gone of [opts.previousEmail, opts.removeEmail]) {
      const e = gone?.trim();
      if (e && e.toLowerCase() !== current) {
        const r = await deleteContact(e);
        if (!r.ok) errors.push(r.error);
      }
    }
    if (m?.email) {
      if (isSubscribed(m)) {
        const seg = await listSegmentId();
        if (!seg.ok) errors.push(seg.error);
        else {
          const r = await ensureOnList({ email: m.email.trim(), name: m.name }, seg.id, !!opts.freshOptIn);
          if (!r.ok) errors.push(r.error);
        }
      } else {
        const r = await deleteContact(m.email.trim());
        if (!r.ok) errors.push(r.error);
      }
    }
    return errors.length ? { ok: false, error: errors.join("; ") } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Mailing list sync failed." };
  }
}

// syncMember once the response has gone out, so a click on the website
// never waits on Resend. If it fails, the nightly comparison fixes it.
export function syncMemberSoon(memberId: string | null, opts: SyncMemberOptions = {}): void {
  if (!mailingListConfigured()) return;
  const run = () => syncMember(memberId, opts).then(
    () => undefined,
    () => undefined,
  );
  try {
    after(run);
  } catch {
    // Outside a request (a script): just start it.
    void run();
  }
}

export interface ReconcileResult {
  complete: boolean;
  subscribers: number;
  onResend: number;
  added: number;
  removed: number;
  optedOut: number;
  errors: string[];
}

// The full comparison: everyone who should be on the list is, and nobody
// else. Stops early (complete: false) when `budgetMs` runs out, so a big
// first sync can be finished by running it again. Logged in
// mailing_list_syncs.
export async function reconcileMailingList(trigger: "cron" | "manual" | "send", budgetMs = 40_000): Promise<ReconcileResult> {
  const deadline = Date.now() + budgetMs;
  const result: ReconcileResult = { complete: false, subscribers: 0, onResend: 0, added: 0, removed: 0, optedOut: 0, errors: [] };
  const supabase = createAdminClient();
  const { data: log } = await supabase.from("mailing_list_syncs").insert({ trigger }).select("id").single();

  const finish = async () => {
    if (log) {
      await supabase
        .from("mailing_list_syncs")
        .update({
          finished_at: new Date().toISOString(),
          complete: result.complete,
          subscribers: result.subscribers,
          added: result.added,
          removed: result.removed,
          opted_out: result.optedOut,
          errors: result.errors.length ? result.errors.slice(0, 20).join("; ").slice(0, 2000) : null,
        })
        .eq("id", log.id);
    }
    return result;
  };

  if (!mailingListConfigured()) {
    result.errors.push("RESEND_API_KEY isn't set.");
    return finish();
  }

  let subscribers: Subscriber[];
  try {
    subscribers = await getSubscribers();
  } catch (e) {
    // Never compare against a list we couldn't read: that would remove everyone.
    result.errors.push(e instanceof Error ? e.message : "Couldn't read the members list.");
    return finish();
  }
  const seg = await listSegmentId();
  if (!seg.ok) {
    result.errors.push(seg.error);
    return finish();
  }
  const listed = await listSegmentContacts(seg.id);
  if (!listed.ok) {
    result.errors.push(listed.error);
    return finish();
  }

  const wanted = new Map(subscribers.map((s) => [s.email.trim().toLowerCase(), s]));
  result.onResend = listed.data.length;
  const present = new Set<string>();
  let outOfTime = false;

  try {
    // 1. Take off Resend whoever shouldn't be there.
    for (const c of listed.data) {
      const key = c.email.trim().toLowerCase();
      const s = wanted.get(key);
      if (s && !c.unsubscribed) {
        present.add(key);
        continue;
      }
      if (Date.now() > deadline) {
        outOfTime = true;
        break;
      }
      // Unsubscribed through an email's link (or in Resend's dashboard)
      // and we hadn't caught up: turn it off here too.
      if (c.unsubscribed && s) {
        result.optedOut += await optOutByEmail(c.email);
        wanted.delete(key);
      }
      const del = await deleteContact(c.email);
      if (del.ok) result.removed++;
      else result.errors.push(`${c.email}: ${del.error}`);
    }

    // 2. Add whoever's missing.
    if (!outOfTime) {
      for (const [key, s] of wanted) {
        if (present.has(key)) continue;
        if (Date.now() > deadline) {
          outOfTime = true;
          break;
        }
        const r = await ensureOnList({ email: s.email.trim(), name: s.name }, seg.id, false);
        if (!r.ok) result.errors.push(`${s.email}: ${r.error}`);
        else if (r.optedOut) {
          result.optedOut++;
          wanted.delete(key);
        } else result.added++;
      }
    }
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : "Sync stopped partway.");
  }

  result.subscribers = wanted.size;
  result.complete = !outOfTime && result.errors.length === 0;
  return finish();
}
