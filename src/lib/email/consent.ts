import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashEmail } from "./hash";
import { cancelEmail } from "./resend";
import { PREF_CATEGORIES, type ConsentSource, type PrefCategory } from "./types";

// Every change to who gets marketing email goes through here, so each one
// is stamped, recorded in email_consent_log (the CAN-SPAM evidence trail)
// and takes effect at once: an opt-out also cancels anything already
// waiting to go to that person.
//
// members.email_opt_in is the master switch (the kiosk, account page,
// erase and staff already use it); member_email_prefs holds the
// categories, the pause, where consent came from and engagement.

export type ConsentWriteSource =
  | "one_click" // the mailbox's own Unsubscribe button (RFC 8058)
  | "prefs_page" // the unsubscribe page, from an email link
  | "account" // their account page, signed in
  | "kiosk"
  | "join_form"
  | "checkout"
  | "claim"
  | "staff"
  | "webhook" // a spam complaint reported by the mailbox provider
  | "indy_import"
  | "sunset";

// Where a "yes" came from, for the prefs row.
const CONSENT_FOR: Partial<Record<ConsentWriteSource, ConsentSource>> = {
  prefs_page: "account",
  account: "account",
  kiosk: "kiosk",
  join_form: "join_form",
  checkout: "checkout",
  claim: "claim",
  staff: "staff",
};

// A person saying yes again themselves, on our site, clears a complaint, a
// manual block or an "unsubscribed, then removed" entry on their address.
// Only where the address is proven theirs: signed in to their account (whose
// email they can't change there), or the signed link from one of our emails.
// Not the join form, the kiosk or checkout, where anyone can type anyone's
// address. Staff can't do this for them, and a hard bounce only clears when
// the address changes.
const SELF_SERVE: ReadonlySet<ConsentWriteSource> = new Set(["account", "prefs_page"]);
const LIFTED_BY_SELF_SERVE = ["complaint", "manual", "unsubscribed"];

export type ConsentResult = { ok: true; changed: boolean } | { ok: false; error: string };

export interface Prefs extends Record<PrefCategory, boolean> {
  pausedUntil: string | null;
  consentSource: ConsentSource;
  consentAt: string | null;
  engagement: "active" | "reconfirm_sent" | "dormant";
  lastEngagedAt: string | null;
}

export const DEFAULT_PREFS: Prefs = {
  lineup: true,
  alerts: true,
  events: true,
  offers: true,
  rewards: true,
  pausedUntil: null,
  consentSource: "unknown",
  consentAt: null,
  engagement: "active",
  lastEngagedAt: null,
};

// What the preference page shows: the master switch, the categories, and
// the pause (only while it lasts).
export interface EmailState {
  optIn: boolean;
  prefs: Record<PrefCategory, boolean>;
  pausedUntil: string | null;
}

export async function emailStateFor(memberId: string): Promise<EmailState> {
  const [{ data: m }, p] = await Promise.all([createAdminClient().from("members").select("email_opt_in").eq("id", memberId).maybeSingle(), getPrefs(memberId)]);
  const paused = p.pausedUntil && Date.parse(p.pausedUntil) > Date.now() ? p.pausedUntil : null;
  return { optIn: m?.email_opt_in !== false, prefs: { lineup: p.lineup, alerts: p.alerts, events: p.events, offers: p.offers, rewards: p.rewards }, pausedUntil: paused };
}

export async function getPrefs(memberId: string): Promise<Prefs> {
  const { data } = await createAdminClient()
    .from("member_email_prefs")
    .select("lineup, alerts, events, offers, rewards, paused_until, consent_source, consent_at, engagement, last_engaged_at")
    .eq("member_id", memberId)
    .maybeSingle();
  if (!data) return { ...DEFAULT_PREFS };
  return {
    lineup: data.lineup,
    alerts: data.alerts,
    events: data.events,
    offers: data.offers,
    rewards: data.rewards,
    pausedUntil: data.paused_until,
    consentSource: data.consent_source,
    consentAt: data.consent_at,
    engagement: data.engagement,
    lastEngagedAt: data.last_engaged_at,
  };
}

async function log(entry: { memberId: string | null; emailHash?: string | null; action: string; source: string; detail?: Record<string, unknown>; byEmployee?: string | null }) {
  const { error } = await createAdminClient()
    .from("email_consent_log")
    .insert({
      member_id: entry.memberId,
      email_hash: entry.emailHash ?? null,
      action: entry.action,
      source: entry.source,
      detail: entry.detail ?? {},
      by_employee: entry.byEmployee ?? null,
    });
  if (error) throw new Error("Couldn't record the email choice.");
}

async function upsertPrefs(memberId: string, fields: Record<string, unknown>) {
  const { error } = await createAdminClient()
    .from("member_email_prefs")
    .upsert({ member_id: memberId, ...fields, updated_at: new Date().toISOString() }, { onConflict: "member_id" });
  if (error) throw new Error("Couldn't save the email settings.");
}

// Anything queued here or scheduled at Resend for this member stops (only
// the given kinds of email, when `categories` is passed). A scheduled email
// Resend already sent can't be stopped, and that's fine. One Resend
// couldn't call back just now (busy, or not answering) is marked on its row
// and tried again on the next cron run (retryPendingCancels), as long as
// it's still ahead.
export const CANCEL_RETRY = "Cancel pending at Resend: ";

export async function cancelPendingSends(memberId: string, why: string, categories?: readonly string[]): Promise<number> {
  const admin = createAdminClient();
  const { data: found } = await admin.from("email_sends").select("id, status, resend_email_id, deliver_at, campaign_id").eq("member_id", memberId).in("status", ["queued", "scheduled"]);
  let rows = found ?? [];
  if (categories && rows.length) {
    const ids = [...new Set(rows.map((r) => r.campaign_id as string))];
    const { data: camps } = await admin.from("email_campaigns").select("id, category").in("id", ids);
    const wanted = new Set(((camps ?? []) as { id: string; category: string }[]).filter((c) => categories.includes(c.category)).map((c) => c.id));
    rows = rows.filter((r) => wanted.has(r.campaign_id as string));
  }
  let n = 0;
  for (const s of rows) {
    if (s.status === "scheduled") {
      if (!s.deliver_at || Date.parse(s.deliver_at) <= Date.now()) continue;
      const r = s.resend_email_id ? await cancelEmail(s.resend_email_id) : null;
      if (!r?.ok) {
        // Resend says it can't be (it went already): nothing to do.
        // Otherwise (Resend busy, no answer, no id saved yet): try again later.
        if (!r || ![400, 404, 409, 422].includes(r.status)) {
          await admin.from("email_sends").update({ error: `${CANCEL_RETRY}${why}`.slice(0, 300) }).eq("id", s.id).eq("status", "scheduled");
        }
        continue;
      }
    }
    const { data } = await admin.from("email_sends").update({ status: "cancelled", error: why }).eq("id", s.id).in("status", ["queued", "scheduled"]).select("id");
    n += data?.length ?? 0;
  }
  return n;
}

// The cron's second try at cancels Resend didn't take the first time (an
// unsubscribe, a pause, a category turned off, a blocked address), for
// email still waiting there for later.
export async function retryPendingCancels(deadline: number): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("email_sends")
    .select("id, resend_email_id, error")
    .eq("status", "scheduled")
    .gt("deliver_at", new Date(Date.now() + 60_000).toISOString())
    .like("error", `${CANCEL_RETRY}%`)
    .order("deliver_at")
    .limit(500);
  if (error) throw new Error("Couldn't read the cancels still to do.");
  let n = 0;
  for (const s of (data ?? []) as { id: string; resend_email_id: string | null; error: string | null }[]) {
    if (Date.now() > deadline) break;
    if (!s.resend_email_id) continue;
    const r = await cancelEmail(s.resend_email_id);
    if (!r.ok) continue;
    const why = (s.error ?? "").slice(CANCEL_RETRY.length) || "Cancelled";
    const { data: done } = await admin.from("email_sends").update({ status: "cancelled", error: why }).eq("id", s.id).eq("status", "scheduled").select("id");
    n += done?.length ?? 0;
  }
  return n;
}

// The strongest reason wins: a hard bounce also stops receipts; the rest
// only stop marketing.
const REASON_RANK: Record<string, number> = { hard_bounce: 5, complaint: 4, soft_bounce_repeat: 3, resend_suppressed: 2, manual: 1, unsubscribed: 0 };

export type SuppressionReason = "hard_bounce" | "complaint" | "soft_bounce_repeat" | "resend_suppressed" | "manual" | "unsubscribed";

export async function suppressHash(emailHash: string, reason: SuppressionReason, note?: string | null) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("email_suppressions").select("reason").eq("email_hash", emailHash).maybeSingle();
  const now = new Date().toISOString();
  if (existing) {
    const keep = (REASON_RANK[existing.reason] ?? 0) >= (REASON_RANK[reason] ?? 0);
    const { error } = await admin
      .from("email_suppressions")
      .update({ last_at: now, ...(keep ? {} : { reason }), ...(note ? { note: note.slice(0, 200) } : {}) })
      .eq("email_hash", emailHash);
    if (error) throw new Error("Couldn't save the suppression.");
    return;
  }
  const { error } = await admin.from("email_suppressions").insert({ email_hash: emailHash, reason, note: note ? note.slice(0, 200) : null });
  if (error && error.code !== "23505") throw new Error("Couldn't save the suppression.");
}

// Turns marketing email on or off for one member (the master switch).
//  - `at`: when the choice was made elsewhere (a webhook's timestamp). A
//    choice they made on our site after that wins.
//  - `onlyTurnOn`: a ticked box that must never switch anyone off
//    (checkout, the kiosk's "email me").
export async function setMarketingOptIn(
  memberId: string,
  on: boolean,
  source: ConsentWriteSource,
  opts: { byEmployee?: string | null; at?: string | null; detail?: Record<string, unknown>; sendId?: string | null } = {},
): Promise<ConsentResult> {
  const admin = createAdminClient();
  const { data: m, error } = await admin.from("members").select("id, email, email_opt_in, email_opt_in_changed_at, erased_at").eq("id", memberId).maybeSingle();
  if (error) return { ok: false, error: "Couldn't read the member." };
  // Removed (or never there): nothing to switch off, which is what an
  // unsubscribe or a complaint wants. Switching on needs a member.
  if (!m || m.erased_at) return on ? { ok: false, error: "That member isn't here anymore." } : { ok: true, changed: false };
  if (opts.at && m.email_opt_in_changed_at && Date.parse(m.email_opt_in_changed_at) > Date.parse(opts.at)) return { ok: true, changed: false };

  const was = m.email_opt_in !== false;
  const now = new Date().toISOString();
  // Unchanged and nothing new to record (a second one-click, a re-sent
  // webhook): nothing to do.
  const recordsChoice = !!CONSENT_FOR[source];
  if (was === on && !recordsChoice) return { ok: true, changed: false };

  const { error: updErr } = await admin.from("members").update({ email_opt_in: on, email_opt_in_changed_at: now }).eq("id", memberId);
  if (updErr) return { ok: false, error: "Couldn't save the email setting." };

  try {
    const consent = CONSENT_FOR[source];
    if (on) {
      await upsertPrefs(memberId, {
        ...(consent ? { consent_source: consent, consent_at: now } : {}),
        last_engaged_at: now,
        engagement: "active",
      });
    } else {
      await upsertPrefs(memberId, {});
    }
    await log({
      memberId,
      action: on ? (was ? "prefs" : source === "account" || source === "prefs_page" ? "resubscribe" : "opt_in") : "opt_out",
      source,
      detail: { ...(opts.detail ?? {}), ...(opts.sendId ? { send_id: opts.sendId } : {}), was },
      byEmployee: opts.byEmployee ?? null,
    });
    if (on && SELF_SERVE.has(source) && m.email) {
      await admin.from("email_suppressions").delete().eq("email_hash", hashEmail(m.email)).in("reason", LIFTED_BY_SELF_SERVE);
    }
    if (!on) await cancelPendingSends(memberId, source === "webhook" ? "Complained" : "Unsubscribed");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save the email setting." };
  }
  return { ok: true, changed: was !== on };
}

// Where a member's yes came from, without changing anything else (a
// claimed account keeps whatever email setting it had).
export async function recordConsentSource(memberId: string, source: "claim" | "checkout" | "kiosk" | "join_form", opts: { onlyIfUnknown?: boolean } = {}) {
  const admin = createAdminClient();
  if (opts.onlyIfUnknown) {
    const { data } = await admin.from("member_email_prefs").select("consent_source").eq("member_id", memberId).maybeSingle();
    if (data && data.consent_source !== "unknown" && data.consent_source !== "old_site_import") return;
  }
  const now = new Date().toISOString();
  await upsertPrefs(memberId, { consent_source: source, consent_at: now, last_engaged_at: now, engagement: "active" });
  await log({ memberId, action: "prefs", source, detail: { consent_source: source } });
}

export async function updatePrefs(memberId: string, next: Partial<Record<PrefCategory, boolean>>, source: ConsentWriteSource): Promise<ConsentResult> {
  const fields: Record<string, boolean> = {};
  for (const c of PREF_CATEGORIES) if (typeof next[c] === "boolean") fields[c] = next[c] as boolean;
  if (!Object.keys(fields).length) return { ok: false, error: "Nothing to change." };
  try {
    const now = new Date().toISOString();
    await upsertPrefs(memberId, { ...fields, last_engaged_at: now, engagement: "active" });
    await log({ memberId, action: "prefs", source, detail: fields });
    // Whatever kind was just turned off stops, even if it's already waiting
    // at Resend (the preference page saves one kind at a time).
    const off = PREF_CATEGORIES.filter((c) => fields[c] === false);
    if (off.length) await cancelPendingSends(memberId, off.length === PREF_CATEGORIES.length ? "Every kind of email turned off" : "Turned this kind of email off", off);
    return { ok: true, changed: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." };
  }
}

export async function pauseEmail(memberId: string, days: number, source: ConsentWriteSource): Promise<ConsentResult> {
  const d = Math.max(1, Math.min(90, Math.floor(days) || 30));
  const until = new Date(Date.now() + d * 86_400_000).toISOString();
  try {
    await upsertPrefs(memberId, { paused_until: until, last_engaged_at: new Date().toISOString() });
    await log({ memberId, action: "pause", source, detail: { days: d, until } });
    await cancelPendingSends(memberId, "Paused");
    return { ok: true, changed: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." };
  }
}

export async function resumeEmail(memberId: string, source: ConsentWriteSource): Promise<ConsentResult> {
  try {
    await upsertPrefs(memberId, { paused_until: null, last_engaged_at: new Date().toISOString(), engagement: "active" });
    await log({ memberId, action: "resume", source });
    return { ok: true, changed: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save." };
  }
}

// "Just the weekly lineup": the lineup on, everything else off, and email
// back on if it was off.
export async function justTheLineup(memberId: string, source: ConsentWriteSource): Promise<ConsentResult> {
  const r = await updatePrefs(memberId, { lineup: true, alerts: false, events: false, offers: false, rewards: false }, source);
  if (!r.ok) return r;
  const { data: m } = await createAdminClient().from("members").select("email_opt_in").eq("id", memberId).maybeSingle();
  if (m && m.email_opt_in === false) return setMarketingOptIn(memberId, true, source);
  return r;
}

export async function resubscribe(memberId: string, source: ConsentWriteSource): Promise<ConsentResult> {
  const r = await setMarketingOptIn(memberId, true, source);
  if (!r.ok) return r;
  await upsertPrefs(memberId, { paused_until: null }).catch(() => undefined);
  return r;
}

// For a complaint or bounce about an address (the webhook), when there may
// be no member at all: logged against the hash only.
export async function logAddressEvent(email: string, action: "complaint" | "hard_bounce", source: string, detail: Record<string, unknown> = {}) {
  await log({ memberId: null, emailHash: hashEmail(email), action, source, detail });
}

export async function logMemberEvent(memberId: string, action: "complaint" | "hard_bounce" | "reconfirm", source: string, detail: Record<string, unknown> = {}) {
  await log({ memberId, action, source, detail });
}
