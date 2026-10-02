import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/site";
import { issueEmailClaimLinks } from "@/lib/member-claim";
import { CAMPAIGN_COLUMNS, shapeOf, type CampaignRow, type FrozenLink } from "./campaign";
import { loadFacts, oldSystemPayers, queueSends, resolveAudience } from "./audience";
import { firstNameOf, scrubAddresses } from "./format";
import { hashEmail } from "./hash";
import { lintCampaign, type LintResult } from "./lint";
import { designOf, renderCampaign, type CampaignInput, type RenderData, type Recipient, type RenderLinks } from "./render";
import { DESIGNS } from "./designs";
import { sealArtName } from "./designs/art-token";
import { sealFinishToken } from "@/lib/plus-finish-token";
import { plusFinishUrl } from "@/lib/plus-finish-link";
import { LEGACY_DEFAULT_INTERVAL, LEGACY_DEFAULT_RATE, legacyNeedsSetup } from "@/lib/legacy-plus";
import { getSendPlan, getWaveMode, roomToday, utcDay, waveCanGoToday, nextWaveDay } from "./send-plan";
import { loadRenderData, restrictedTitles, unknownHouseEventIds } from "./render-data";
import { cancelEmail, deliver, type OutgoingEmail, type ResendResult } from "./resend";
import { capCheck, looksDeliverable, paidShare, type CampaignShape } from "./rules";
import { sendEmail } from "./send";
import { nextSendSlot, sendByFor, type SendBy } from "./timing";
import { emailTokensReady, listUnsubscribeHeaders, preferencesUrl, sealEmailToken } from "./tokens";
import { EXCLUSION_LABEL, SENT_STATUSES, type Automation, type CampaignKind, type Category, type ConsentSource, type PrefCategory, type SendRecord, type SendStatus } from "./types";

// Sending a campaign to its list, per person, through Resend's batch API.
//
//   draft -> scheduled -> sending -> sent   (side exits: paused, cancelled, failed)
//   automations stay 'active' (or 'off') and keep collecting sends.
//
// A run takes a 5-minute lease on the campaign (email_claim_campaign), so
// only one run works on it at a time and a run that died is taken over
// after the lease runs out. It works out who gets it (audience.ts) once,
// saves those people as 'queued' email_sends rows, freezes the campaign's
// links, then hands them to Resend 100 at a time.
//
// At hand-over, not just when queued, each email is checked again: the
// person still wants it, it arrives inside the send window (9 AM to 7 PM
// Central, Monday to Saturday; a row whose time has passed moves to the next
// open slot and goes with scheduled_at), and it still fits the caps against
// what they've had since. Automated emails more than 2 days late are dropped.
// A one-off email has a "too late" time (timing.ts, sendByFor): past it, a
// "tonight" alert, an event email or a lineup whose words would be wrong is
// cancelled, and anything else pauses for an admin to decide.
// Between batches the run checks the campaign is still going, no guardrail
// has tripped and sending is still on, and stops if not.
//
// Each batch carries an Idempotency-Key ("<campaign>:<batch>:<stamp>",
// saved on its rows), and a batch that was numbered but never confirmed is
// retried with the same key, so a retry, a double click or a crashed run
// never sends twice. Resend remembers a key for 24 hours, so a batch still
// unconfirmed after 20 hours is never sent again: its rows are marked
// "handed over, outcome unknown" (the webhook fills in what happened).
// Resend refusing a batch outright (an odd address) splits it: each email
// goes alone under its own key, and only the ones refused are marked failed.
//
// Nothing goes to a list unless EMAIL_SENDING_ENABLED is "true", the
// sender is on a verified domain (not @resend.dev), and EMAIL_TOKEN_SECRET
// is set (no unsubscribe link, no email). Spam complaints or hard bounces
// running too high pause everything until an admin looks (guardrails), and
// call back email already waiting at Resend for later. Turning
// EMAIL_SENDING_ENABLED off stops new hand-overs at once, but email Resend
// already holds for later is only called back on the next cron run; "Stop
// all sending" on the Email page calls it back at once. Resend cancels one
// email per request, so a big call-back carries on in fresh runs of
// /api/email/recall until nothing is left (recallAll).

export const LEASE_SECONDS = 300;
export const BATCH_SIZE = 100;
const HOUR = 3_600_000;
// Resend keeps an Idempotency-Key for 24 hours; past this, a batch whose
// answer was lost is never sent again (it may already have gone).
export const RETRY_SAME_KEY_HOURS = 20;
// An automated email that couldn't go within 2 days of being queued (the
// switch was off, sending was paused) is dropped: a late welcome or
// birthday is worse than none.
export const AUTOMATION_MAX_AGE_HOURS = 48;
export const UNSURE = "Handed to Resend over 20 hours ago with no answer. Not sent again, in case it went (Resend only remembers a batch for 24 hours).";

export function replyTo(): string {
  return process.env.EMAIL_REPLY_TO?.trim() || "info@royalecinemajoplin.com";
}

// How far ahead a run hands email over with scheduled_at (so a once-a-day
// cron still lands Tuesday's lineup at 10:30 exactly).
export function scheduleAheadMs(): number {
  const h = Number(process.env.EMAIL_SCHEDULE_AHEAD_HOURS);
  return (Number.isFinite(h) && h >= 0 ? Math.min(h, 60) : 24) * 3_600_000;
}

export interface SenderStatus {
  from: string | null;
  ready: boolean;
  problem: string | null;
}

// A list email has to come from a domain verified in Resend, so the test
// sender (onboarding@resend.dev) won't do.
export function senderStatus(): SenderStatus {
  const from = process.env.EMAIL_FROM?.trim() || null;
  if (!process.env.RESEND_API_KEY) return { from, ready: false, problem: "Email isn't connected yet: RESEND_API_KEY needs adding in Vercel." };
  if (!from) return { from, ready: false, problem: "EMAIL_FROM isn't set in Vercel, so there's no sender for the list." };
  if (/@resend\.dev>?\s*$/i.test(from)) return { from, ready: false, problem: "EMAIL_FROM is still Resend's test address. It has to be an address at royalecinemajoplin.com once the domain is verified." };
  return { from, ready: true, problem: null };
}

// The kill switch and everything else that must be true before a list send.
export function sendingGate(): { ok: true } | { ok: false; reason: string } {
  if (process.env.EMAIL_SENDING_ENABLED !== "true") return { ok: false, reason: "Sending to lists is switched off (EMAIL_SENDING_ENABLED isn't \"true\" in Vercel). Turn it on once the go-live checklist passes." };
  const s = senderStatus();
  if (!s.ready) return { ok: false, reason: s.problem ?? "The sender isn't set up." };
  if (!emailTokensReady()) return { ok: false, reason: "EMAIL_TOKEN_SECRET isn't set, so emails can't carry a working unsubscribe link." };
  return { ok: true };
}

// ---------- guardrails ----------
export const GUARDRAIL = { minDelivered: 300, complaintRate: 0.003, hardBounceRate: 0.05, windowHours: 24 };

export interface GuardrailStatus {
  delivered: number;
  complaints: number;
  hardBounces: number;
  tripped: boolean;
  reason: string | null;
}

export function guardrailVerdict(delivered: number, complaints: number, hardBounces: number): string | null {
  if (delivered < GUARDRAIL.minDelivered) return null;
  if (complaints / delivered > GUARDRAIL.complaintRate) return `Spam complaints hit ${((complaints / delivered) * 100).toFixed(2)}% in the last 24 hours (limit 0.3%).`;
  if (hardBounces / delivered > GUARDRAIL.hardBounceRate) return `Hard bounces hit ${((hardBounces / delivered) * 100).toFixed(1)}% in the last 24 hours (limit 5%).`;
  return null;
}

export async function guardrailStatus(now = new Date()): Promise<GuardrailStatus> {
  const admin = createAdminClient();
  const since = new Date(now.getTime() - GUARDRAIL.windowHours * 3_600_000).toISOString();
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count: n, error } = await q;
    if (error) throw new Error("Couldn't check the complaint rate.");
    return n ?? 0;
  };
  const [delivered, complaints, hardBounces] = await Promise.all([
    count(admin.from("email_sends").select("id", { count: "exact", head: true }).gte("delivered_at", since)),
    count(admin.from("email_sends").select("id", { count: "exact", head: true }).gte("complained_at", since)),
    count(admin.from("email_sends").select("id", { count: "exact", head: true }).gte("bounced_at", since).eq("bounce_type", "Permanent")),
  ]);
  const reason = guardrailVerdict(delivered, complaints, hardBounces);
  return { delivered, complaints, hardBounces, tripped: !!reason, reason };
}

// The pause every run checks: set by a guardrail ("Guardrail") or by an
// admin's "Stop all sending" ("Stopped").
export async function guardrailPause(): Promise<{ at: string; reason: string; by: "Guardrail" | "Stopped" } | null> {
  const { data } = await createAdminClient().from("email_settings").select("value").eq("key", "guardrail_pause").maybeSingle();
  const v = data?.value as { at?: string; reason?: string; by?: string } | undefined;
  return v?.at ? { at: v.at, reason: v.reason ?? "", by: v.by === "Stopped" ? "Stopped" : "Guardrail" } : null;
}

// Stops every list email until an admin resumes (the guardrail, or "Stop
// all sending"): the pause flag, and every scheduled or sending campaign
// paused. Returns true if it wasn't already paused.
export async function pauseAllSending(reason: string, opts: { byEmployee?: string | null; prefix?: "Guardrail" | "Stopped"; now?: Date } = {}): Promise<boolean> {
  const admin = createAdminClient();
  const now = opts.now ?? new Date();
  const fresh = !(await guardrailPause());
  if (fresh) {
    const { error } = await admin
      .from("email_settings")
      .upsert(
        { key: "guardrail_pause", value: { at: now.toISOString(), reason, by: opts.prefix ?? "Guardrail" }, updated_at: now.toISOString(), ...(opts.byEmployee ? { updated_by: opts.byEmployee } : {}) },
        { onConflict: "key" },
      );
    if (error) throw new Error("Couldn't pause sending.");
  }
  await admin
    .from("email_campaigns")
    .update({ status: "paused", error: `${opts.prefix ?? "Guardrail"}: ${reason} An admin needs to look before anything else goes out.`, updated_at: now.toISOString() })
    .in("status", ["scheduled", "sending"]);
  return fresh;
}

// Work that shouldn't hold up the answer (a webhook): after the response
// when there is one, otherwise right away.
function inBackground(label: string, task: () => Promise<unknown>) {
  const run = () => task().catch((e) => console.error(`${label}:`, e instanceof Error ? e.message : e));
  try {
    after(run);
  } catch {
    void run();
  }
}

// Checked before every run and after every bounce or complaint: over the
// line, every scheduled campaign pauses, nothing goes to a list until an
// admin resumes it, and email already waiting at Resend for later is called
// back (in the background, the first time it trips, carrying on until it's
// all back; the cron does that itself, so it passes recall: false).
export async function enforceGuardrails(now = new Date(), opts: { recall?: boolean } = {}): Promise<GuardrailStatus> {
  const g = await guardrailStatus(now);
  if (!g.tripped) return g;
  const fresh = await pauseAllSending(g.reason ?? "Complaints or bounces ran too high.", { prefix: "Guardrail", now });
  if (fresh && opts.recall !== false) inBackground("email recall", () => recallAll(`Guardrail: ${g.reason}`));
  return g;
}

// ---------- calling back email waiting at Resend ----------
export interface RecallResult {
  recalled: number;
  failed: number; // Resend wouldn't cancel it (usually: it had already gone)
  left: number; // not reached before the deadline
  busy?: boolean; // another call-back was already running; nothing was done
  continuing?: boolean; // the rest carry on in a fresh run of /api/email/recall
}

// Resend cancels one email per request (about 5 a second here), so calling
// back a big list takes several runs of a few minutes. Only one call-back
// runs at a time (a lease in email_settings), so two can't race over the
// same email or double the load on Resend. A run that dies lets go when its
// lease runs out.
const RECALL_LEASE = "recall_lease";
export const RECALL_MAX_HOPS = 25;
const GONE = "Resend couldn't call it back: it had already gone.";

async function takeRecallLease(untilMs: number): Promise<string | null> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  await admin.from("email_settings").delete().eq("key", RECALL_LEASE).lt("value->>until", now);
  const run = randomUUID();
  const { error } = await admin.from("email_settings").insert({ key: RECALL_LEASE, value: { run, until: new Date(untilMs).toISOString() }, updated_at: now });
  return error ? null : run;
}

async function dropRecallLease(run: string) {
  await createAdminClient().from("email_settings").delete().eq("key", RECALL_LEASE).eq("value->>run", run);
}

export async function recallRunning(): Promise<boolean> {
  const { data } = await createAdminClient().from("email_settings").select("value").eq("key", RECALL_LEASE).maybeSingle();
  const until = (data?.value as { until?: string } | undefined)?.until;
  return !!until && Date.parse(until) > Date.now();
}

// How many emails are waiting at Resend for later (handed over with
// scheduled_at, not due for another minute).
export async function waitingAtResend(campaignId?: string): Promise<number> {
  let q = createAdminClient().from("email_sends").select("id", { count: "exact", head: true }).eq("status", "scheduled").gt("deliver_at", new Date(Date.now() + 60_000).toISOString());
  if (campaignId) q = q.eq("campaign_id", campaignId);
  const { count, error } = await q;
  if (error) throw new Error("Couldn't count the email waiting at Resend.");
  return count ?? 0;
}

// Why email waiting at Resend should come back right now, if it should:
// sending is stopped (an admin or a guardrail) or switched off.
export async function recallReason(): Promise<string | null> {
  const gate = sendingGate();
  if (!gate.ok) return `Sending is switched off: ${gate.reason}`;
  const p = await guardrailPause();
  return p ? `${p.by}: ${p.reason}` : null;
}

// One email waiting at Resend: "ok" (called back), "gone" (Resend says it
// can't be: it went already), "retry" (no answer, Resend busy, or no id
// saved yet for it).
async function callBack(resendId: string | null): Promise<"ok" | "gone" | "retry"> {
  if (!resendId) return "retry";
  const r = await cancelEmail(resendId);
  if (r.ok) return "ok";
  return [400, 404, 409, 422].includes(r.status) ? "gone" : "retry";
}

// "Still want these?" called back or cancelled before it arrived: their 14
// days never started, so they're simply active again.
async function undoReconfirm(memberIds: string[]) {
  const ids = [...new Set(memberIds)];
  const admin = createAdminClient();
  for (let i = 0; i < ids.length; i += 150) {
    await admin
      .from("member_email_prefs")
      .update({ engagement: "active", reconfirm_sent_at: null, updated_at: new Date().toISOString() })
      .in("member_id", ids.slice(i, i + 150))
      .eq("engagement", "reconfirm_sent");
  }
}

async function reconfirmCampaignId(): Promise<string | null> {
  const { data } = await createAdminClient().from("email_campaigns").select("id").eq("automation", "reconfirm").maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

// "Still want these?" has been handed over (to arrive at `arrives`): their
// 14 days start then. Set here, when it's handed to Resend, not when it's
// queued, so one that's cancelled, dropped, held back or refused never makes
// anyone go quiet (email_refresh_engagement also checks it really went).
async function startReconfirmClock(list: { memberId: string; arrives: string }[]) {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    const { error } = await admin
      .from("member_email_prefs")
      .upsert(
        chunk.map((x) => ({ member_id: x.memberId, engagement: "reconfirm_sent", reconfirm_sent_at: x.arrives, updated_at: now })),
        { onConflict: "member_id" },
      );
    // Not fatal: they stay active (and aren't sent it again for 30 days).
    if (error) console.error("reconfirm clock not started:", error.message);
    else await admin.from("email_consent_log").insert(chunk.map((x) => ({ member_id: x.memberId, action: "reconfirm", source: "sunset" })));
  }
}

// Email handed to Resend with scheduled_at that's still ahead is cancelled
// there and put back in the queue (so a resume sends it, if it's still in
// time and within the caps). Soonest first, until the deadline (`left`: how
// many weren't reached), or until sending is back on (`stillStopped`). The
// one-off emails it touched are paused, whatever stopped sending, so an
// admin decides whether the rest still go. One Resend says has already gone
// is marked so, and not tried again.
export async function recallScheduledSends(reason: string, opts: { deadline?: number; stillStopped?: () => Promise<boolean> } = {}): Promise<RecallResult> {
  const admin = createAdminClient();
  const deadline = opts.deadline ?? Date.now() + 200_000;
  const lease = await takeRecallLease(deadline + 60_000);
  if (!lease) return { recalled: 0, failed: 0, left: await waitingAtResend().catch(() => 0), busy: true };
  try {
    const out: RecallResult = { recalled: 0, failed: 0, left: 0 };
    const soon = new Date(Date.now() + 60_000).toISOString();
    const rows: { id: string; campaign_id: string; member_id: string | null; resend_email_id: string | null }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from("email_sends")
        .select("id, campaign_id, member_id, resend_email_id, deliver_at")
        .eq("status", "scheduled")
        .gt("deliver_at", soon)
        .order("deliver_at")
        .order("id")
        .range(from, from + 999);
      if (error) throw new Error("Couldn't read the email waiting at Resend.");
      rows.push(...((data ?? []) as typeof rows));
      if ((data ?? []).length < 1000) break;
    }
    const reconfirm = rows.length ? await reconfirmCampaignId() : null;
    const undo: string[] = [];
    const touched = new Set<string>();
    for (let i = 0; i < rows.length; i++) {
      if (Date.now() > deadline || (opts.stillStopped && i > 0 && i % 25 === 0 && !(await opts.stillStopped()))) {
        out.left = rows.length - i;
        break;
      }
      const r = rows[i];
      const c = await callBack(r.resend_email_id);
      if (c !== "ok") {
        if (c === "gone") await admin.from("email_sends").update({ status: "submitted", error: GONE }).eq("id", r.id).eq("status", "scheduled");
        out.failed++;
        continue;
      }
      const { error } = await admin
        .from("email_sends")
        .update({ status: "queued", resend_email_id: null, batch_no: null, batch_key: null, batch_at: null, submitted_at: null, error: `Called back from Resend. ${reason}`.slice(0, 300) })
        .eq("id", r.id)
        .eq("status", "scheduled");
      if (error) {
        out.failed++;
        continue;
      }
      out.recalled++;
      touched.add(r.campaign_id);
      if (r.campaign_id === reconfirm && r.member_id) undo.push(r.member_id);
    }
    if (undo.length) await undoReconfirm(undo);
    if (touched.size) {
      await admin
        .from("email_campaigns")
        .update({ status: "paused", error: `${reason} Email waiting at Resend was called back; an admin decides whether the rest still go (Resume).`, updated_at: new Date().toISOString() })
        .in("id", [...touched])
        .is("automation", null)
        .in("status", ["sent", "scheduled", "sending"]);
      // One that was stopped meanwhile (an email cancelled, an automation
      // switched off) never sends again: what came back is cancelled, not
      // left queued (where it would count against the caps).
      const { data: ended } = await admin.from("email_campaigns").select("id").in("id", [...touched]).in("status", ["cancelled", "failed", "off"]);
      const endedIds = (ended ?? []).map((x) => x.id as string);
      if (endedIds.length) {
        await admin.from("email_sends").update({ status: "cancelled", error: `Called back from Resend after the email was stopped. ${reason}`.slice(0, 300) }).in("campaign_id", endedIds).eq("status", "queued").is("batch_key", null);
      }
    }
    return out;
  } finally {
    await dropRecallLease(lease);
  }
}

// Calls back what's waiting at Resend, and when one run can't reach it all,
// hands the rest to a fresh run of /api/email/recall (its own few minutes),
// which does the same, until nothing is left, sending is back on, or
// RECALL_MAX_HOPS runs have gone by. Used by "Stop all sending", a tripped
// guardrail and the cron while sending is stopped or switched off.
export async function recallAll(reason: string, opts: { deadline?: number; hop?: number } = {}): Promise<RecallResult> {
  const r = await recallScheduledSends(reason, { deadline: opts.deadline, stillStopped: async () => (await recallReason()) !== null });
  if (r.left > 0 && !r.busy && r.recalled > 0 && (await recallReason())) r.continuing = await continueRecall((opts.hop ?? 0) + 1);
  return r;
}

// Starts the next run of /api/email/recall. Only in production, and only
// with CRON_SECRET set (the route refuses anything unsigned); elsewhere the
// Email page's button carries on instead.
async function continueRecall(hop: number): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const host = process.env.VERCEL_ENV === "production" ? process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "") : "";
  if (!secret || !host || hop > RECALL_MAX_HOPS) return false;
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const res = await fetch(`https://${host}/api/email/recall?hop=${hop}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  return res?.status === 202;
}

// One email's sends that haven't gone: queued ones are cancelled here, and
// ones waiting at Resend for later are cancelled there (soonest first,
// until the deadline; `left` says how many are still waiting). `busy`: a
// call-back of everything was already running, so only the queued ones
// were cancelled.
export async function stopCampaignSends(campaignId: string, why: string, deadline = Date.now() + 200_000): Promise<{ atResend: number; couldnt: number; left: number; busy?: boolean }> {
  const admin = createAdminClient();
  await admin.from("email_sends").update({ status: "cancelled", error: why }).eq("campaign_id", campaignId).eq("status", "queued");
  const lease = await takeRecallLease(deadline + 60_000);
  if (!lease) return { atResend: 0, couldnt: 0, left: await waitingAtResend(campaignId).catch(() => 0), busy: true };
  try {
    const later: { id: string; member_id: string | null; resend_email_id: string | null }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from("email_sends")
        .select("id, member_id, resend_email_id, deliver_at")
        .eq("campaign_id", campaignId)
        .eq("status", "scheduled")
        .gt("deliver_at", new Date(Date.now() + 30_000).toISOString())
        .order("deliver_at")
        .order("id")
        .range(from, from + 999);
      if (error) throw new Error("Couldn't read what's waiting at Resend.");
      later.push(...((data ?? []) as typeof later));
      if ((data ?? []).length < 1000) break;
    }
    const undo = later.length && campaignId === (await reconfirmCampaignId()) ? ([] as string[]) : null;
    const out = { atResend: 0, couldnt: 0, left: 0 };
    for (let i = 0; i < later.length; i++) {
      if (Date.now() > deadline) {
        out.left = later.length - i;
        break;
      }
      const s = later[i];
      const r = await callBack(s.resend_email_id);
      if (r !== "ok") {
        if (r === "gone") await admin.from("email_sends").update({ status: "submitted", error: GONE }).eq("id", s.id).eq("status", "scheduled");
        out.couldnt++;
        continue;
      }
      await admin.from("email_sends").update({ status: "cancelled", error: why }).eq("id", s.id).eq("status", "scheduled");
      out.atResend++;
      if (undo && s.member_id) undo.push(s.member_id);
    }
    if (undo?.length) await undoReconfirm(undo);
    return out;
  } finally {
    await dropRecallLease(lease);
  }
}

// ---------- the lease ----------
export async function claimCampaign(id: string): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("email_claim_campaign", { p_campaign: id, p_seconds: LEASE_SECONDS });
  return !error && data === true;
}

// An automation is the long-lived row for one step ('welcome_1', ...,
// 'reconfirm'): it stays 'active' and keeps collecting sends.
export function isAutomation(c: { kind: CampaignKind; automation: Automation | null }): boolean {
  return c.kind === "automation" || !!c.automation;
}

// Runs whose lease ran out go back to the queue.
export async function settleStuck(now = new Date()): Promise<void> {
  const admin = createAdminClient();
  const iso = now.toISOString();
  await admin.from("email_campaigns").update({ status: "scheduled", locked_until: null, updated_at: iso }).eq("status", "sending").lt("locked_until", iso);
  await admin.from("email_campaigns").update({ locked_until: null }).not("automation", "is", null).lt("locked_until", iso);
}

export async function getCampaign(id: string): Promise<CampaignRow | null> {
  const { data } = await createAdminClient().from("email_campaigns").select(CAMPAIGN_COLUMNS).eq("id", id).maybeSingle();
  return (data as CampaignRow | null) ?? null;
}

// ---------- links ----------
const SAMPLE: Recipient = { firstName: "Sam", consentSource: "unknown", tier: "Insiders", hasLogin: false, email: null, claimUrl: null };

// A ready-made email's links differ with who it's for (no login yet,
// already signed up, their own link): every version is listed, so each
// link is tracked whoever gets it.
function linkSamples(c: CampaignInput): Recipient[] {
  if (!designOf(c.content)) return [SAMPLE];
  return [
    SAMPLE,
    { ...SAMPLE, hasLogin: true },
    { ...SAMPLE, claimUrl: `${SITE_URL}/account/claim?t=sample`, finishUrl: `${SITE_URL}/membership/finish?t=sample` },
  ];
}

// Every link in the email gets an index for first-party click tracking
// (/e/<send>/<i>). The list only ever grows, so a link in an email that
// already went out keeps pointing where it did.
export function freezeLinks(c: CampaignInput, data: RenderData, existing: FrozenLink[]): FrozenLink[] {
  const out = [...existing];
  const known = new Set(out.map((l) => l.url));
  const collect: RenderLinks = {
    preferencesUrl: `${SITE_URL}/email/preferences`,
    unsubscribeUrl: `${SITE_URL}/email/preferences#all`,
    href: (url, label) => {
      if (!known.has(url)) {
        known.add(url);
        out.push({ i: out.length, url, label: label.slice(0, 120) });
      }
      return url;
    },
  };
  for (const r of linkSamples(c)) renderCampaign(c, data, r, collect);
  return out;
}

export function trackedLinks(links: FrozenLink[], sendId: string | null): (url: string) => string {
  const idx = new Map(links.map((l) => [l.url, l.i]));
  return (url) => (sendId && idx.has(url) ? `${SITE_URL}/e/${sendId}/${idx.get(url)}` : url);
}

export function asInput(c: Pick<CampaignRow, "kind" | "category" | "subject" | "preheader" | "content">): CampaignInput {
  return { kind: c.kind, category: c.category, subject: c.subject, preheader: c.preheader, content: c.content ?? { blocks: [] } };
}

// ---------- lint ----------
export async function lintStored(c: CampaignInput, data?: RenderData): Promise<LintResult & { recipientPreview: string }> {
  const d = data ?? (await loadRenderData(c.content));
  const r = renderCampaign(c, d, SAMPLE, { preferencesUrl: "#", unsubscribeUrl: "#", href: (u) => u });
  const [titles, unknown] = await Promise.all([restrictedTitles(), unknownHouseEventIds(c.content)]);
  const result = lintCampaign({
    subject: r.subject,
    preheader: r.preheader,
    bodyTexts: r.meta.bodyTexts,
    primaryButtons: r.meta.primaryButtons,
    plainFilmTitles: [],
    restrictedTitles: titles,
    htmlBytes: new TextEncoder().encode(r.html).length,
    unknownEventIds: unknown,
  });
  // Stored film cards for archive titles are rendered in the archive
  // section anyway; still flag them so the block gets moved.
  for (const f of r.meta.plainFilms) if (f.archive) result.warnings.push(`"${f.title}" is an archive title in a film card. It's shown in the members-only section instead; use that block.`);
  if (!c.content.blocks?.length) result.errors.push("The email is empty.");
  return { ...result, recipientPreview: r.subject };
}

// ---------- preparing a run ----------
// Works out who gets a one-off campaign (the first time only), saves them
// as queued sends, and freezes the links.
export async function prepareCampaign(c: CampaignRow, data: RenderData, now = new Date()): Promise<CampaignRow> {
  const admin = createAdminClient();
  const patch: Partial<CampaignRow> = {};
  if (!isAutomation(c) && c.recipients === null) {
    const planned = c.scheduled_for && Date.parse(c.scheduled_for) > now.getTime() ? new Date(c.scheduled_for) : now;
    const at = nextSendSlot(planned);
    const resolved = await resolveAudience({ ...shapeOf(c), audience: c.audience ?? { include: [{ r: "all" }] }, holdoutPct: c.holdout_pct }, { at, now });
    await queueSends(c.id, resolved, at);
    patch.recipients = resolved.willSend;
    patch.held_out = resolved.heldOut;
    patch.excluded = resolved.excluded;
  }
  const links = freezeLinks(asInput(c), data, c.links ?? []);
  if (links.length !== (c.links ?? []).length) patch.links = links;
  const archive = renderCampaign(asInput(c), data, SAMPLE, { preferencesUrl: "#", unsubscribeUrl: "#", href: (u) => u }).meta.containsArchive;
  if (archive !== c.contains_archive) patch.contains_archive = archive;
  if (Object.keys(patch).length) {
    const { error } = await admin
      .from("email_campaigns")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", c.id);
    if (error) throw new Error("Couldn't save who it's going to.");
  }
  return { ...c, ...patch };
}

// ---------- daily waves (the ready-made emails) ----------
// A campaign with content.pace goes out in daily waves that fit Resend's
// daily limit (send-plan.ts): each run, if nothing is still queued, the
// next wave is chosen from whoever qualifies right then (anyone who's had
// it is skipped, so nobody gets it twice) and queued for today, as many
// as today's share allows. The run after the last wave marks it sent.
//
// Unless an admin switches waves to "auto" (send-plan.ts getWaveMode), a
// new wave is chosen only after staff press "Send the next wave" (or the
// first Send) on Ready to send: that sets pace.go, good for that Resend
// (UTC) day only, and the wave it starts clears it. The morning run still
// hands over anything left queued from a wave staff started, and never
// starts one itself.
export interface Pace {
  remaining?: number; // people left after the last wave
  note?: string | null;
  go?: string | null; // when staff pressed for the next wave (manual waves)
  goKey?: string | null; // that press's page key, so a double click sends one wave
}

export const WAVE_WAITING = "Waiting for staff: the next wave goes only when someone presses Send the next wave on Ready to send.";

export function isPaced(c: { content?: CampaignInput["content"] | null }): boolean {
  return !!(c.content as { pace?: Pace } | null | undefined)?.pace;
}

export const DAILY_LIMIT = "Today's share of Resend's daily limit is used up. The rest go on the next morning's run.";

const dayName = (d: Date) => d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/Chicago" });

export async function prepareWave(c: CampaignRow, data: RenderData, now = new Date()): Promise<{ c: CampaignRow; more: boolean; note: string | null }> {
  const admin = createAdminClient();
  const patch: Partial<CampaignRow> = {};
  const links = freezeLinks(asInput(c), data, c.links ?? []);
  if (links.length !== (c.links ?? []).length) patch.links = links;
  const save = async () => {
    if (!Object.keys(patch).length) return;
    const { error } = await admin
      .from("email_campaigns")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", c.id);
    if (error) throw new Error("Couldn't save who it's going to.");
  };
  const pace: Pace = { ...((c.content as { pace?: Pace }).pace ?? {}) };

  // Still some queued from an earlier wave: those go first.
  const { count: queued, error: qErr } = await admin.from("email_sends").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).eq("status", "queued");
  if (qErr) throw new Error("Couldn't read the queue.");
  if (queued) {
    await save();
    return { c: { ...c, ...patch }, more: (pace.remaining ?? 0) > 0, note: null };
  }

  // Manual waves: nothing new without a press from staff today.
  const manual = (await getWaveMode()) === "manual";
  if (manual && !(pace.go && utcDay(new Date(pace.go)) === utcDay(now))) {
    // After the last wave, it's done (anyone new waits for a fresh Send).
    const more = pace.remaining !== 0;
    const note = more ? WAVE_WAITING : null;
    if (pace.go || (pace.note ?? null) !== note) {
      patch.content = { ...c.content, pace: { ...pace, go: null, note } } as CampaignRow["content"];
    }
    await save();
    return { c: { ...c, ...patch }, more, note };
  }

  const room = await roomToday(now);
  const later = (why: string) => ({ more: true, note: why });
  let verdict: { more: boolean; note: string | null } | null = null;
  if (!waveCanGoToday(now)) verdict = later(manual ? `${WAVE_WAITING} (Email only goes out 9 AM to 7 PM, Monday to Saturday.)` : `The next wave goes ${dayName(nextWaveDay(now))} (email only goes out 9 AM to 7 PM, Monday to Saturday).`);
  else if (room <= 0) verdict = later(manual ? `Today's share of Resend's daily limit is used up. ${WAVE_WAITING}` : DAILY_LIMIT);
  if (verdict) {
    patch.content = { ...c.content, pace: { ...pace, note: verdict.note } } as CampaignRow["content"];
    await save();
    return { c: { ...c, ...patch }, ...verdict };
  }

  const at = nextSendSlot(now);
  const resolved = await resolveAudience({ ...shapeOf(c), audience: c.audience ?? { include: [{ r: "all" }] }, holdoutPct: c.holdout_pct }, { at, now, limit: room });
  const left = resolved.excluded.wave_limit ?? 0;
  if (!resolved.send.length) {
    patch.content = { ...c.content, pace: { ...pace, remaining: 0, note: null, go: null } } as CampaignRow["content"];
    if (c.recipients === null) {
      patch.recipients = 0;
      patch.held_out = 0;
      patch.excluded = resolved.excluded;
    }
    await save();
    return { c: { ...c, ...patch }, more: false, note: null };
  }
  const n = await queueSends(c.id, resolved, at);
  const waves = [...(((c.content as { waves?: { at: string; n: number }[] }).waves ?? []) as { at: string; n: number }[]), { at: now.toISOString(), n }];
  const note = manual && left > 0 ? WAVE_WAITING : null;
  patch.content = { ...c.content, waves, pace: { ...pace, remaining: left, note, go: null } } as CampaignRow["content"];
  patch.recipients = (c.recipients ?? 0) + resolved.willSend;
  patch.held_out = (c.held_out ?? 0) + resolved.heldOut;
  patch.excluded = resolved.excluded;
  await save();
  return { c: { ...c, ...patch }, more: left > 0, note };
}

// ---------- one batch ----------
interface QueuedRow {
  id: string;
  member_id: string | null;
  deliver_at: string | null;
  batch_no: number | null;
  batch_key: string | null;
  batch_at: string | null;
  created_at: string;
}
const ROW_COLUMNS = "id, member_id, deliver_at, batch_no, batch_key, batch_at, created_at";

interface MemberRow {
  id: string;
  name: string;
  email: string | null;
  tier: string;
  auth_user_id: string | null;
  email_opt_in: boolean | null;
  erased_at: string | null;
  created_at: string;
  legacy_user_id: number | null;
  indy_user_id: string | null;
}

interface PrefsRow {
  member_id: string;
  lineup: boolean;
  alerts: boolean;
  events: boolean;
  offers: boolean;
  rewards: boolean;
  paused_until: string | null;
  consent_source: ConsentSource;
  engagement: string;
}

// Anyone who opted out, paused, turned this category off, went quiet or
// landed on the never-mail list since they were queued comes off here.
function stillWanted(c: CampaignRow, m: MemberRow | undefined, p: PrefsRow | undefined, suppressed: boolean, now: Date): { ok: true } | { ok: false; status: "cancelled" | "suppressed"; why: string } {
  if (!m || m.erased_at || !m.email) return { ok: false, status: "cancelled", why: "No address anymore" };
  if (m.email_opt_in === false) return { ok: false, status: "cancelled", why: "Unsubscribed before it went" };
  if (suppressed) return { ok: false, status: "suppressed", why: "On the never-mail list" };
  if (!looksDeliverable(m.email)) return { ok: false, status: "cancelled", why: "Address doesn't look deliverable" };
  if (p) {
    if (c.category !== "account" && p[c.category as PrefCategory] === false) return { ok: false, status: "cancelled", why: "Turned this kind of email off" };
    if (p.paused_until && Date.parse(p.paused_until) > now.getTime()) return { ok: false, status: "cancelled", why: "Paused" };
    if (p.engagement === "dormant" && c.kind !== "reconfirm" && c.automation !== "reconfirm") return { ok: false, status: "cancelled", why: "Gone quiet" };
  }
  return { ok: true };
}

// When a queued email may arrive: its planned time, or now if that's
// passed, moved into the send window (9 AM to 7 PM Central, Monday to
// Saturday) if it's outside it.
export function effectiveDeliverAt(deliverAt: string | null, now: Date): Date {
  const planned = deliverAt ? Date.parse(deliverAt) : NaN;
  return nextSendSlot(Number.isFinite(planned) && planned > now.getTime() ? new Date(planned) : now);
}

// Tickets bought in the last 30 days and what was actually paid for them:
// a register ticket counts only the share of its order paid in money
// (trivia vouchers are prizes), and one vouchers covered isn't counted.
export async function ticketSpend(memberIds: string[], now = new Date()): Promise<Map<string, { n: number; spend: number }>> {
  const out = new Map<string, { n: number; spend: number }>();
  if (!memberIds.length) return out;
  const admin = createAdminClient();
  const { data } = await admin
    .from("bookings")
    .select("member_id, quantity, unit_price, order_id")
    .in("member_id", memberIds)
    .eq("status", "confirmed")
    .gt("unit_price", 0)
    .gte("created_at", new Date(now.getTime() - 30 * 86_400_000).toISOString());
  const bookings = (data ?? []) as { member_id: string; quantity: number; unit_price: number; order_id: string | null }[];
  const orderIds = [...new Set(bookings.map((b) => b.order_id).filter((x): x is string => !!x))];
  const share = new Map<string, number>();
  if (orderIds.length) {
    const { data: orders } = await admin.from("orders").select("id, total, tip, payment_voucher_amount").in("id", orderIds);
    for (const o of (orders ?? []) as { id: string; total: number; tip: number | null; payment_voucher_amount: number | null }[]) share.set(o.id, paidShare(o));
  }
  for (const b of bookings) {
    // An order we couldn't read counts as unpaid: never claim money we can't see.
    const s = b.order_id ? (share.get(b.order_id) ?? 0) : 1;
    if (!(s > 0)) continue;
    const q = Number(b.quantity) || 0;
    const cur = out.get(b.member_id) ?? { n: 0, spend: 0 };
    cur.n += q;
    cur.spend += Math.round(q * (Number(b.unit_price) || 0) * s * 100) / 100;
    out.set(b.member_id, cur);
  }
  return out;
}

// What each of these members has had (or has waiting) lately, for checking
// the caps again at hand-over. `skip`: the rows being handed over now.
type CampaignBits = { kind: CampaignKind; automation: Automation | null; category: Category; alert: string | null };
async function recentSends(memberIds: string[], skip: Set<string>, shapes: Map<string, CampaignBits>, now: Date): Promise<Map<string, SendRecord[]>> {
  const out = new Map<string, SendRecord[]>();
  if (!memberIds.length) return out;
  const admin = createAdminClient();
  const since = new Date(now.getTime() - 75 * 86_400_000).toISOString();
  const rows: { id: string; member_id: string; campaign_id: string; status: SendStatus; deliver_at: string | null; submitted_at: string | null; created_at: string; first_clicked_at: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("email_sends")
      .select("id, member_id, campaign_id, status, deliver_at, submitted_at, created_at, first_clicked_at")
      .in("member_id", memberIds)
      .in("status", [...SENT_STATUSES])
      .gte("created_at", since)
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error("Couldn't read who's had what lately.");
    rows.push(...((data ?? []) as typeof rows));
    if ((data ?? []).length < 1000) break;
  }
  const missing = [...new Set(rows.map((r) => r.campaign_id))].filter((id) => !shapes.has(id));
  if (missing.length) {
    const { data, error } = await admin.from("email_campaigns").select("id, kind, automation, category, alert:content->>alert").in("id", missing);
    if (error) throw new Error("Couldn't read the other emails.");
    for (const c of (data ?? []) as { id: string; kind: CampaignKind; automation: Automation | null; category: Category; alert?: string | null; content?: { alert?: string | null } }[]) {
      shapes.set(c.id, { kind: c.kind, automation: c.automation, category: c.category, alert: c.alert ?? c.content?.alert ?? null });
    }
  }
  for (const r of rows) {
    if (skip.has(r.id)) continue;
    const c = shapes.get(r.campaign_id);
    if (!c) continue;
    const list = out.get(r.member_id) ?? [];
    list.push({ c: r.campaign_id, t: r.deliver_at ?? r.submitted_at ?? r.created_at, k: c.kind, a: c.automation, g: c.category, x: c.alert, s: r.status, ck: !!r.first_clicked_at });
    out.set(r.member_id, list);
  }
  return out;
}

// Is this run still wanted? Checked before every batch.
async function stopReason(c: CampaignRow): Promise<string | null> {
  const gate = sendingGate();
  if (!gate.ok) return gate.reason;
  if (await guardrailPause()) return "Paused by a guardrail.";
  const { data, error } = await createAdminClient().from("email_campaigns").select("status").eq("id", c.id).maybeSingle();
  if (error) return "Couldn't check the email is still going.";
  const want = isAutomation(c) ? "active" : "sending";
  if (!data || data.status !== want) return `The email is ${data?.status ?? "gone"} now.`;
  return null;
}

// How Resend's refusal reads: `unknown` (it may have got it: the network,
// a 5xx, another request with the key still going), `later` (nothing was
// taken, and trying again soon won't help: a rate limit or used-up quota,
// a bad key, an unverified sender), or `bad_item` (nothing was taken, and
// something in the emails is wrong: an odd address).
type Refusal = "unknown" | "later" | "bad_item";
const SYSTEMIC = new Set(["invalid_from_address", "invalid_access", "missing_api_key", "invalid_api_key", "restricted_api_key", "invalid_idempotency_key", "daily_quota_exceeded", "monthly_quota_exceeded", "rate_limit_exceeded"]);
function refusal(r: Extract<ResendResult<unknown>, { ok: false }>): Refusal {
  if (r.status === 0 || r.status >= 500 || r.status < 400) return "unknown";
  if (r.status === 409) return "unknown";
  if (r.status === 401 || r.status === 403 || r.status === 429 || SYSTEMIC.has(r.name ?? "")) return "later";
  return "bad_item";
}

export interface DeliverResult {
  submitted: number;
  cancelled: number;
  failed: number; // refused by Resend, one by one (an odd address)
  unsure: number; // handed over long ago with no answer; not sent again
  batches: number;
  done: boolean; // nothing left queued for this campaign
  error: string | null;
  stopped: string | null; // the campaign was paused or cancelled, or sending stopped, mid-run
  tooLate: number; // cancelled: they'd have arrived after the email's words stopped being true
  tooLateWhy: string | null;
  late: string | null; // the rest would arrive over a day late: paused for an admin
}

export function lateNote(by: SendBy): string {
  return `Paused: ${by.why}. Resume to send the rest anyway, or Stop the rest.`;
}

// "Restart my unlimited" in the "Press play" email: their own Insiders+
// link (kind 'campaign', 30 days) at the standard plan the email quotes
// ($15 a month; senior and student rates are set at the register). Dated
// from the batch, so a retried batch renders the very same email.
function finishLink(memberId: string, r: { batch_at: string | null; created_at: string }): string | null {
  const at = Date.parse(r.batch_at ?? r.created_at);
  const token = sealFinishToken({ memberId, kind: "campaign", tier: LEGACY_DEFAULT_RATE, interval: LEGACY_DEFAULT_INTERVAL }, Number.isFinite(at) ? at : Date.now());
  return token ? plusFinishUrl(token) : null;
}

// Of these members, the former unlimited ones with nothing paying for
// their Insiders+ yet (checked again at hand-over for "Press play").
async function legacyStillNeedsSetup(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await createAdminClient().from("members").select("*").in("id", ids.slice(i, i + 150));
    if (error) throw new Error("Couldn't check who still needs their Insiders+ set up.");
    for (const m of (data ?? []) as Parameters<typeof legacyNeedsSetup>[0][]) if (legacyNeedsSetup(m)) out.add((m as unknown as { id: string }).id);
  }
  return out;
}

// Hands this campaign's queued sends to Resend, 100 at a time, until none
// are due, the deadline comes, the campaign stops, or Resend refuses.
export async function deliverQueued(c: CampaignRow, data: RenderData, deadline: number, now = new Date()): Promise<DeliverResult> {
  const admin = createAdminClient();
  const from = process.env.EMAIL_FROM?.trim() ?? "";
  const result: DeliverResult = { submitted: 0, cancelled: 0, failed: 0, unsure: 0, batches: 0, done: false, error: null, stopped: null, tooLate: 0, tooLateWhy: null, late: null };
  const href = (sendId: string) => trackedLinks(c.links ?? [], sendId);
  const input = asInput(c);
  const shape: CampaignShape = shapeOf(c);
  const shapes = new Map<string, CampaignBits>([[c.id, { kind: c.kind, automation: c.automation, category: c.category, alert: c.content?.alert ?? null }]]);
  const needsSpend = (c.content?.blocks ?? []).some((b) => b.t === "ticketSpend");
  // A ready-made email (lib/email/designs) says what it needs per person.
  const design = designOf(c.content);
  const needs = design ? DESIGNS[design].needs : null;
  const needsClaim = (c.content?.blocks ?? []).some((b) => b.t === "claim") || !!needs?.claim;
  const paced = isPaced(c);
  const plan = paced ? await getSendPlan() : null;
  // The latest a one-off may arrive (automations: the 2-day rule below).
  // Daily waves have none: each wave goes the day it's chosen.
  const sendBy = isAutomation(c) || paced ? null : sendByFor(c);
  const tooLate = (r: QueuedRow, t: Date) => !!sendBy && effectiveDeliverAt(r.deliver_at, t).getTime() > sendBy.at.getTime();
  let failures = 0;

  // A late welcome or birthday is worse than none.
  if (isAutomation(c)) {
    const { count } = await admin
      .from("email_sends")
      .update({ status: "cancelled", error: `Couldn't go within ${AUTOMATION_MAX_AGE_HOURS / 24} days of being queued, so it was dropped` }, { count: "exact" })
      .eq("campaign_id", c.id)
      .eq("status", "queued")
      .is("batch_key", null)
      .lt("created_at", new Date(now.getTime() - AUTOMATION_MAX_AGE_HOURS * HOUR).toISOString());
    result.cancelled += count ?? 0;
  }

  const mark = async (marks: Record<string, unknown>[]) => {
    for (let i = 0; i < 3; i++) {
      const { error } = await admin.rpc("email_mark_submitted", { p_rows: marks });
      if (!error) return true;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
    return false;
  };
  const unnumber = (ids: string[]) => admin.from("email_sends").update({ batch_no: null, batch_key: null, batch_at: null }).in("id", ids).eq("status", "queued");

  while (Date.now() < deadline) {
    const stop = await stopReason(c);
    if (stop) {
      result.stopped = stop;
      break;
    }
    const t = new Date();
    const horizon = t.getTime() + scheduleAheadMs();

    // A batch that was numbered but never confirmed (a crash, a timeout)
    // goes again first, with the same key.
    let rows: QueuedRow[] = [];
    let key: string;
    const { data: stuck, error: stuckErr } = await admin.from("email_sends").select(ROW_COLUMNS).eq("campaign_id", c.id).eq("status", "queued").not("batch_key", "is", null).order("batch_key").order("id").limit(BATCH_SIZE);
    if (stuckErr) {
      result.error = "Couldn't read the queue.";
      break;
    }
    if (stuck?.length) {
      key = stuck[0].batch_key as string;
      rows = (stuck as QueuedRow[]).filter((r) => r.batch_key === key);
      const firstTry = Date.parse(rows[0].batch_at ?? rows[0].created_at);
      if (t.getTime() - firstTry > RETRY_SAME_KEY_HOURS * HOUR) {
        // Resend no longer knows this key: sending again could send twice.
        const ok = await mark(rows.map((r) => ({ id: r.id, resend_email_id: null, status: "submitted", submitted_at: r.batch_at ?? t.toISOString(), deliver_at: r.deliver_at, error: UNSURE })));
        if (!ok) {
          result.error = "Couldn't save the queue.";
          break;
        }
        result.unsure += rows.length;
        continue;
      }
      // Too late now to try again (the words would be wrong, or it's over a
      // day late): not sent again. Whether the first try reached Resend
      // can't be known; if it did, it went then.
      if (sendBy && rows.some((r) => tooLate(r, t))) {
        if (!sendBy.hard) {
          result.late = lateNote(sendBy);
          return result;
        }
        const { error: lateErr } = await admin
          .from("email_sends")
          .update({ status: "cancelled", error: `Too late to try again: ${sendBy.why}. If the earlier try reached Resend, it went then.`.slice(0, 300) })
          .in(
            "id",
            rows.map((r) => r.id),
          )
          .eq("status", "queued");
        if (lateErr) {
          result.error = "Couldn't save the queue.";
          return result;
        }
        result.tooLate += rows.length;
        result.tooLateWhy = sendBy.why;
        continue;
      }
    } else {
      // Daily waves stay inside today's share of Resend's limit, whatever
      // else went out today.
      let room = BATCH_SIZE;
      if (paced) {
        try {
          room = Math.min(BATCH_SIZE, await roomToday(now.getTime() > t.getTime() ? now : t, plan ?? undefined));
        } catch (e) {
          result.error = e instanceof Error ? e.message : "Couldn't count today's email.";
          break;
        }
        if (room <= 0) {
          result.stopped = DAILY_LIMIT;
          break;
        }
      }
      const { data: fresh, error } = await admin
        .from("email_sends")
        .select(ROW_COLUMNS)
        .eq("campaign_id", c.id)
        .eq("status", "queued")
        .is("batch_key", null)
        .or(`deliver_at.is.null,deliver_at.lte."${new Date(horizon).toISOString()}"`)
        .order("id")
        .limit(room);
      if (error) {
        result.error = "Couldn't read the queue.";
        break;
      }
      if (!fresh?.length) {
        const { count } = await admin.from("email_sends").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).eq("status", "queued");
        result.done = (count ?? 0) === 0;
        break;
      }
      // Too late: a "tonight" alert tomorrow, last week's lineup, an event
      // email after the event are cancelled; anything else that would now
      // arrive over a day late pauses the email for an admin to decide.
      const late = (fresh as QueuedRow[]).filter((r) => tooLate(r, t));
      if (sendBy && late.length) {
        if (!sendBy.hard) {
          result.late = lateNote(sendBy);
          return result;
        }
        const { data: gone, error: lateErr } = await admin
          .from("email_sends")
          .update({ status: "cancelled", error: `Too late: ${sendBy.why}.`.slice(0, 300) })
          .in(
            "id",
            late.map((r) => r.id),
          )
          .eq("status", "queued")
          .is("batch_key", null)
          .select("id");
        if (lateErr) {
          result.error = "Couldn't save the queue.";
          return result;
        }
        result.tooLate += gone?.length ?? 0;
        result.tooLateWhy = sendBy.why;
        continue;
      }
      // The send window, again at hand-over: a row whose time has passed
      // (a list that ran long, a resume, a switch turned back on) moves to
      // the next open slot, and waits for a later run if that's too far off.
      const moved = new Map<string, string[]>();
      const due: QueuedRow[] = [];
      for (const r of fresh as QueuedRow[]) {
        const at = effectiveDeliverAt(r.deliver_at, t);
        if (!r.deliver_at || Math.abs(at.getTime() - Date.parse(r.deliver_at)) > 60_000 || at.getTime() > horizon) {
          const iso = at.toISOString();
          moved.set(iso, [...(moved.get(iso) ?? []), r.id]);
          r.deliver_at = iso;
        }
        if (at.getTime() <= horizon) due.push(r);
      }
      for (const [iso, ids] of moved) {
        const { error: movErr } = await admin.from("email_sends").update({ deliver_at: iso }).in("id", ids).eq("status", "queued").is("batch_key", null);
        if (movErr) {
          result.error = "Couldn't save the queue.";
          return result;
        }
      }
      if (!due.length) continue;
      const { data: top } = await admin.from("email_sends").select("batch_no").eq("campaign_id", c.id).not("batch_no", "is", null).order("batch_no", { ascending: false }).limit(1);
      const batchNo = (top?.[0]?.batch_no ?? 0) + 1;
      // Saved on the rows, so a retry uses the same key; the stamp (and a few
      // random characters, in case two runs overlap after a lease ran out
      // and pick the same number) keeps a re-formed batch from ever reusing a
      // key Resend has seen.
      key = `${c.id}:${batchNo}:${t.getTime().toString(36)}${randomUUID().slice(0, 6)}`;
      const { data: numbered } = await admin
        .from("email_sends")
        .update({ batch_no: batchNo, batch_key: key, batch_at: t.toISOString() })
        .in(
          "id",
          due.map((r) => r.id),
        )
        .is("batch_key", null)
        .eq("status", "queued")
        .select(ROW_COLUMNS);
      rows = ((numbered ?? []) as QueuedRow[]).sort((a, b) => a.id.localeCompare(b.id));
      if (!rows.length) continue;
    }
    const batchNo = rows[0].batch_no as number;

    // Who they are now.
    const ids = [...new Set(rows.map((r) => r.member_id).filter((x): x is string => !!x))];
    const [{ data: members }, { data: prefs }] = await Promise.all([
      admin.from("members").select("id, name, email, tier, auth_user_id, email_opt_in, erased_at, created_at, legacy_user_id, indy_user_id").in("id", ids),
      admin.from("member_email_prefs").select("member_id, lineup, alerts, events, offers, rewards, paused_until, consent_source, engagement").in("member_id", ids),
    ]);
    const byId = new Map(((members ?? []) as MemberRow[]).map((m) => [m.id, m]));
    const prefById = new Map(((prefs ?? []) as PrefsRow[]).map((p) => [p.member_id, p]));
    const hashes = [...byId.values()].filter((m) => m.email).map((m) => hashEmail(m.email as string));
    const { data: sup } = hashes.length ? await admin.from("email_suppressions").select("email_hash").in("email_hash", hashes) : { data: [] as { email_hash: string }[] };
    const suppressed = new Set((sup ?? []).map((s) => s.email_hash));
    let had: Map<string, SendRecord[]>;
    try {
      had = await recentSends(ids, new Set(rows.map((r) => r.id)), shapes, t);
    } catch (e) {
      result.error = e instanceof Error ? e.message : "Couldn't check the caps.";
      return result;
    }
    const [spend, claims, stillLegacy, paidOld] = await Promise.all([
      needsSpend ? ticketSpend(ids, t) : Promise.resolve(new Map<string, { n: number; spend: number }>()),
      needsClaim ? issueEmailClaimLinks(rows.filter((r) => r.member_id).map((r) => ({ memberId: r.member_id as string, sendId: r.id, queuedAt: r.created_at }))) : Promise.resolve(new Map<string, string>()),
      needs?.finish ? legacyStillNeedsSetup(ids) : Promise.resolve(null),
      needs?.finish ? oldSystemPayers() : Promise.resolve(null),
    ]);

    const items: OutgoingEmail[] = [];
    const itemRows: QueuedRow[] = [];
    for (const r of rows) {
      const m = r.member_id ? byId.get(r.member_id) : undefined;
      const p = r.member_id ? prefById.get(r.member_id) : undefined;
      let verdict = stillWanted(c, m, p, !!m?.email && suppressed.has(hashEmail(m.email)), t);
      // A ready-made email that's no longer true for them since they were
      // chosen: the invite once they've set up a login, "Press play" once
      // their Insiders+ is paid for.
      if (verdict.ok && design === "royale-is-here" && m?.auth_user_id) verdict = { ok: false, status: "cancelled", why: "Set up a website login before it went" };
      if (verdict.ok && stillLegacy && m && !stillLegacy.has(m.id)) verdict = { ok: false, status: "cancelled", why: "Their Insiders+ was set up before it went" };
      if (verdict.ok && paidOld && m && paidOld.has(m.id)) verdict = { ok: false, status: "cancelled", why: EXCLUSION_LABEL.paid_old_system };
      if (!verdict.ok) {
        await admin.from("email_sends").update({ status: verdict.status, error: verdict.why }).eq("id", r.id).eq("status", "queued");
        result.cancelled++;
        continue;
      }
      const member = m as MemberRow;
      const at = effectiveDeliverAt(r.deliver_at, t);
      // The caps, against what they've had (or have waiting) now, at the
      // time it will actually arrive.
      const theirs = had.get(member.id) ?? [];
      const cap = capCheck(theirs, shape, at, { createdAt: member.created_at, imported: (member.legacy_user_id ?? null) !== null || !!member.indy_user_id });
      if (cap) {
        await admin.from("email_sends").update({ status: "cancelled", error: `Held back when it was due: ${EXCLUSION_LABEL[cap]}` }).eq("id", r.id).eq("status", "queued");
        result.cancelled++;
        continue;
      }
      // Two of the same automation for one person in one batch: one goes.
      theirs.push({ c: c.id, t: at.toISOString(), k: c.kind, a: c.automation, g: c.category, x: shape.alert ?? null, s: "scheduled", ck: false });
      had.set(member.id, theirs);
      const token = sealEmailToken({ memberId: member.id, sendId: r.id });
      if (!token) {
        result.error = "EMAIL_TOKEN_SECRET isn't set, so there's no unsubscribe link. Nothing more was sent.";
        return result;
      }
      const s = spend.get(member.id);
      const recipient: Recipient = {
        firstName: firstNameOf(member.name),
        consentSource: p?.consent_source ?? "unknown",
        tier: member.tier,
        hasLogin: !!member.auth_user_id,
        email: member.email,
        claimUrl: claims.get(member.id) ?? null,
        ticketSpend30: s?.spend ?? 0,
        paidTickets30: s?.n ?? 0,
        ...(design
          ? {
              // Their own "Restart my unlimited" link, made now: 30 days
              // from this batch (the same on a retry of the batch).
              finishUrl: needs?.finish ? finishLink(member.id, r) : null,
              artToken: needs?.art.length ? sealArtName(firstNameOf(member.name)) : null,
              fromOldSite: (member.legacy_user_id ?? null) !== null,
              sendId: r.id,
            }
          : {}),
      };
      const track = href(r.id);
      const rendered = renderCampaign(input, data, recipient, {
        preferencesUrl: preferencesUrl(token),
        unsubscribeUrl: preferencesUrl(token, "all"),
        href: (url) => track(url),
      });
      const later = at.getTime() > Date.now() + 60_000 ? at.toISOString() : undefined;
      items.push({
        from,
        to: [(member.email as string).trim()],
        reply_to: replyTo(),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: listUnsubscribeHeaders(token),
        tags: [
          { name: "campaign", value: c.id },
          { name: "send", value: r.id },
          { name: "kind", value: c.automation ?? c.kind },
        ],
        ...(later ? { scheduled_at: later } : {}),
      });
      itemRows.push(r);
    }
    if (!items.length) continue;

    const markAccepted = async (list: { row: QueuedRow; item: OutgoingEmail; id: string | null }[], note: string | null) => {
      const at = new Date().toISOString();
      const ok = await mark(
        list.map(({ row, item, id }) => ({
          id: row.id,
          resend_email_id: id,
          // Waiting at Resend for later, so an unsubscribe can still stop it.
          status: item.scheduled_at ? "scheduled" : "submitted",
          submitted_at: at,
          deliver_at: item.scheduled_at ?? at,
          error: note,
        })),
      );
      // "Still want these?" is on its way: their 14 days start when it arrives.
      if (ok && c.automation === "reconfirm") {
        await startReconfirmClock(list.filter((x) => x.row.member_id).map((x) => ({ memberId: x.row.member_id as string, arrives: x.item.scheduled_at ?? at })));
      }
      return ok;
    };

    // Each alone, under its own key (after Resend refused the batch
    // outright, so it took none of them).
    if (key.endsWith(":split")) {
      let taken = 0;
      let halt: string | null = null;
      const refused: { row: QueuedRow; why: string }[] = [];
      for (let i = 0; i < items.length; i++) {
        const one = await deliver([items[i]], `${key}:${itemRows[i].id}`);
        if (one.ok || (one.status === 409 && one.name === "invalid_idempotent_request")) {
          if (!(await markAccepted([{ row: itemRows[i], item: items[i], id: one.ok ? one.data[0] || null : null }], one.ok ? null : "Handed over earlier; Resend's id wasn't saved."))) {
            result.error = "Resend took an email but saving that failed. The next run finishes it (nothing is sent twice).";
            return result;
          }
          taken++;
          continue;
        }
        const kind = refusal(one);
        if (kind === "bad_item") {
          refused.push({ row: itemRows[i], why: scrubAddresses(one.error) || "Resend refused it." });
          continue;
        }
        // Stop here. The ones not tried yet (and this one, when Resend
        // surely didn't take it) go again later under a new key; one that
        // may have gone keeps its own key, so a retry can't send it twice.
        await unnumber(itemRows.slice(kind === "later" ? i : i + 1).map((r) => r.id));
        halt = `Resend didn't accept an email in batch ${batchNo}: ${scrubAddresses(one.error)}`;
        break;
      }
      if (!halt && !taken && refused.length > 1) {
        // Every one refused: it's the email or the setup, not the addresses.
        await unnumber(refused.map((x) => x.row.id));
        result.error = `Resend refused every email in batch ${batchNo}: ${refused[0].why}`;
        return result;
      }
      // Only the ones refused are marked; everyone else carries on.
      for (const x of refused) {
        await admin.from("email_sends").update({ status: "failed", error: `Resend refused it: ${x.why}`.slice(0, 300) }).eq("id", x.row.id).eq("status", "queued");
      }
      result.submitted += taken;
      result.failed += refused.length;
      result.batches++;
      if (halt) {
        result.error = halt;
        return result;
      }
      continue;
    }

    const sent = await deliver(items, key);
    if (sent.ok) {
      if (!(await markAccepted(itemRows.map((row, i) => ({ row, item: items[i], id: sent.data[i] || null })), null))) {
        // Resend has them; the next run re-sends the same batch under the
        // same key and Resend answers with the same ids, without sending.
        result.error = "Resend took a batch but saving the result failed. The next run finishes it (nothing is sent twice).";
        return result;
      }
      result.submitted += items.length;
      result.batches++;
      failures = 0;
      continue;
    }
    if (sent.status === 409 && sent.name === "invalid_idempotent_request") {
      // Resend already took this key earlier with slightly different
      // content (data changed between the two tries). It went; we just
      // don't have the ids. Webhooks still find them by tag.
      if (!(await markAccepted(itemRows.map((row, i) => ({ row, item: items[i], id: null })), "Handed over earlier; Resend's id wasn't saved."))) {
        result.error = "Couldn't save the queue.";
        return result;
      }
      result.submitted += items.length;
      continue;
    }
    const kind = refusal(sent);
    if (kind === "bad_item") {
      // Nothing was taken. Send them one by one, so one odd address can't
      // hold up everyone behind it.
      const splitKey = `${key}:split`;
      const { error: splitErr } = await admin.from("email_sends").update({ batch_key: splitKey }).in("id", itemRows.map((r) => r.id)).eq("status", "queued");
      if (splitErr) {
        result.error = "Couldn't save the queue.";
        return result;
      }
      continue;
    }
    if (kind === "later") {
      // Nothing was taken: these go again on a later run, under a new key.
      await unnumber(itemRows.map((r) => r.id));
      // A daily wave that met Resend's daily limit anyway (other email used
      // it up): the rest go tomorrow, nothing to fix.
      if (paced && sent.name === "daily_quota_exceeded") {
        result.stopped = DAILY_LIMIT;
        return result;
      }
      if (sent.status === 429 && sent.name !== "daily_quota_exceeded" && sent.name !== "monthly_quota_exceeded") {
        // Only busy: the rest go on the next run (nothing to fix).
        result.stopped = "Resend asked us to slow down. The rest go on the next run.";
        return result;
      }
      result.error = `Resend didn't accept batch ${batchNo}: ${scrubAddresses(sent.error)}`;
      return result;
    }
    failures++;
    if (failures >= 3) {
      result.error = `Resend didn't answer for batch ${batchNo}: ${scrubAddresses(sent.error)} It goes again (same key) on the next run.`;
      return result;
    }
  }
  return result;
}

// ---------- a whole run ----------
export interface RunResult {
  id: string;
  name: string;
  ran: boolean;
  submitted: number;
  cancelled: number;
  status: string;
  note: string | null;
}

function runNote(r: DeliverResult): string | null {
  const bits = [
    r.error,
    r.stopped ? `Stopped: ${r.stopped}` : null,
    r.late,
    r.tooLate ? `${r.tooLate} weren't sent because they'd have arrived too late: ${r.tooLateWhy ?? "past its time"}.` : null,
    r.failed ? `${r.failed} refused by Resend (see each member's email history).` : null,
    r.unsure ? `${r.unsure} were handed to Resend over 20 hours ago with no answer and weren't sent again.` : null,
  ].filter(Boolean);
  return bits.length ? bits.join(" ") : null;
}

// One campaign, start to finish (or until the deadline). The dispatcher
// (dispatch.ts) and "Send now" both come through here.
export async function runCampaign(id: string, deadline: number, now = new Date()): Promise<RunResult> {
  const admin = createAdminClient();
  const first = await getCampaign(id);
  if (!first) return { id, name: "?", ran: false, submitted: 0, cancelled: 0, status: "missing", note: "No such campaign." };
  const gate = sendingGate();
  if (!gate.ok) {
    if (!isAutomation(first) && first.error !== gate.reason) await admin.from("email_campaigns").update({ error: gate.reason }).eq("id", id).eq("status", "scheduled");
    return { id, name: first.name, ran: false, submitted: 0, cancelled: 0, status: first.status, note: gate.reason };
  }
  if (await guardrailPause()) return { id, name: first.name, ran: false, submitted: 0, cancelled: 0, status: first.status, note: "Paused by a guardrail." };
  if (!(await claimCampaign(id))) return { id, name: first.name, ran: false, submitted: 0, cancelled: 0, status: first.status, note: "Another run has it." };

  let c = (await getCampaign(id)) as CampaignRow;
  try {
    // A one-off that hasn't started and is already past its "too late"
    // time: nobody is queued, and it waits for an admin (a new time, a
    // copy, or for one that's only late, Resume).
    const by = isAutomation(c) || c.recipients !== null ? null : sendByFor(c);
    if (by && nextSendSlot(new Date()).getTime() > by.at.getTime()) {
      const note = by.hard ? `Too late to start: ${by.why}. Pick a new time, or make a copy.` : lateNote(by);
      await admin.from("email_campaigns").update({ status: "paused", locked_until: null, error: note, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "sending");
      await admin.from("email_campaigns").update({ locked_until: null }).eq("id", id);
      return { id, name: c.name, ran: true, submitted: 0, cancelled: 0, status: (await getCampaign(id))?.status ?? "paused", note };
    }
    const data = await loadRenderData(c.content ?? { blocks: [] });
    // Daily waves: today's wave is chosen now, if there's room.
    let wave: { more: boolean; note: string | null } | null = null;
    if (isPaced(c) && !isAutomation(c)) {
      const w = await prepareWave(c, data, now);
      c = w.c;
      wave = { more: w.more, note: w.note };
    } else c = await prepareCampaign(c, data, now);
    const r = await deliverQueued(c, data, deadline, now);
    const iso = new Date().toISOString();
    const note = runNote(r);
    let status: string = c.status;
    if (wave && !r.error && !r.late && (r.stopped === DAILY_LIMIT || (r.done && wave.more) || (!r.stopped && !r.done))) {
      // More to go: the next wave on a later run (the morning email run).
      status = "scheduled";
      const next = r.stopped === DAILY_LIMIT || r.done ? (wave.note ?? DAILY_LIMIT) : note;
      await admin.from("email_campaigns").update({ status, locked_until: null, error: next, updated_at: iso }).eq("id", id).eq("status", "sending");
      await admin.from("email_campaigns").update({ locked_until: null }).eq("id", id);
      status = (await getCampaign(id))?.status ?? status;
    } else if (isAutomation(c)) {
      await admin.from("email_campaigns").update({ locked_until: null, error: note, updated_at: iso }).eq("id", id);
    } else if (r.late) {
      // The rest would now arrive over a day late: an admin decides.
      status = "paused";
      await admin.from("email_campaigns").update({ status, locked_until: null, error: note, updated_at: iso }).eq("id", id).eq("status", "sending");
    } else if (r.stopped) {
      // Paused, cancelled or stopped from elsewhere: leave that as it is.
      // (Sending switched off mid-run: back to scheduled, to go later.)
      await admin.from("email_campaigns").update({ status: "scheduled", locked_until: null, error: r.stopped, updated_at: iso }).eq("id", id).eq("status", "sending");
      await admin.from("email_campaigns").update({ locked_until: null }).eq("id", id);
      status = (await getCampaign(id))?.status ?? "scheduled";
    } else if (r.error) {
      status = "paused";
      await admin.from("email_campaigns").update({ status, locked_until: null, error: note, updated_at: iso }).eq("id", id).eq("status", "sending");
    } else if (r.done) {
      status = "sent";
      await admin.from("email_campaigns").update({ status, locked_until: null, error: note, sent_at: iso, updated_at: iso }).eq("id", id).eq("status", "sending");
    } else {
      status = "scheduled";
      await admin.from("email_campaigns").update({ status, locked_until: null, error: note, updated_at: iso }).eq("id", id).eq("status", "sending");
    }
    return { id, name: c.name, ran: true, submitted: r.submitted, cancelled: r.cancelled, status, note };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Something went wrong.";
    if (isAutomation(c)) {
      await admin.from("email_campaigns").update({ locked_until: null, error: msg }).eq("id", id);
    } else {
      // Only a run still in progress goes back to the queue: an exception
      // must never undo a cancel or a pause made meanwhile.
      await admin.from("email_campaigns").update({ status: "scheduled", locked_until: null, error: msg }).eq("id", id).eq("status", "sending");
      await admin.from("email_campaigns").update({ locked_until: null }).eq("id", id);
    }
    const statusNow = isAutomation(c) ? c.status : ((await getCampaign(id))?.status ?? "scheduled");
    return { id, name: c.name, ran: true, submitted: 0, cancelled: 0, status: statusNow, note: msg };
  }
}

// ---------- tests ----------
// "Send a test to me": the same email, rendered on the server from the
// stored campaign, to the staff member's own login address (and the seed
// inboxes in EMAIL_SEED_LIST, never an address typed in the browser).
// If their login is also a member, the test carries their real
// unsubscribe link and one-click header, so the round trip can be tried.
export async function sendTestEmail(c: CampaignInput, to: { email: string; name: string }, opts: { seeds: boolean }): Promise<{ ok: true; sentTo: number } | { ok: false; error: string }> {
  if (!process.env.RESEND_API_KEY) return { ok: false, error: "Email isn't connected yet: RESEND_API_KEY needs adding in Vercel." };
  const data = await loadRenderData(c.content);
  const addresses = [to.email, ...(opts.seeds ? seedList() : [])].filter((e, i, a) => looksDeliverable(e) && a.findIndex((x) => x.toLowerCase() === e.toLowerCase()) === i);
  if (!addresses.length) return { ok: false, error: "Your login has no email address to send the test to." };
  let sent = 0;
  let lastError: string | null = null;
  for (const addr of addresses) {
    const facts = await memberForAddress(addr);
    const token = facts ? sealEmailToken({ memberId: facts.id, sendId: null }) : null;
    const prefs = token ? preferencesUrl(token) : `${SITE_URL}/account/email`;
    const unsub = token ? preferencesUrl(token, "all") : `${SITE_URL}/account/email#all`;
    const recipient: Recipient = {
      firstName: firstNameOf(facts?.name ?? to.name),
      consentSource: "unknown",
      tier: facts?.tier ?? "Insiders",
      hasLogin: !!facts?.auth_user_id,
      email: addr,
      claimUrl: null,
      ticketSpend30: 24,
      paidTickets30: 3,
    };
    const r = renderCampaign(c, data, recipient, { preferencesUrl: prefs, unsubscribeUrl: unsub, href: (u) => u });
    const res = await sendEmail(addr, `[Test] ${r.subject}`, r.html, {
      text: r.text,
      replyTo: replyTo(),
      headers: token ? listUnsubscribeHeaders(token) : undefined,
      tags: [{ name: "kind", value: "test" }],
    });
    if (res.ok) sent++;
    else lastError = res.error;
  }
  return sent ? { ok: true, sentTo: sent } : { ok: false, error: lastError ?? "Couldn't send the test." };
}

export function seedList(): string[] {
  return (process.env.EMAIL_SEED_LIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => looksDeliverable(s))
    .slice(0, 8);
}

async function memberForAddress(email: string): Promise<{ id: string; name: string; tier: string; auth_user_id: string | null } | null> {
  const { data } = await createAdminClient()
    .from("members")
    .select("id, name, tier, auth_user_id")
    .ilike("email", email.trim().replace(/[\\%_]/g, (x) => "\\" + x))
    .is("erased_at", null)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

// For the composer's dry-run count (no writes).
export async function dryRun(c: Pick<CampaignRow, "id" | "kind" | "category" | "automation" | "content" | "audience" | "holdout_pct">, at: Date) {
  const facts = await loadFacts();
  return resolveAudience({ ...shapeOf(c), audience: c.audience, holdoutPct: c.holdout_pct }, { at, facts });
}
