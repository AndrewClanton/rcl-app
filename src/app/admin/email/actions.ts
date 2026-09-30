"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin, assertManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay } from "@/lib/ops/time";
import { CAMPAIGN_COLUMNS, type CampaignRow } from "@/lib/email/campaign";
import { asInput, dryRun, getCampaign, guardrailPause, lintStored, runCampaign, sendTestEmail, sendingGate } from "@/lib/email/campaign-send";
import { cancelEmail } from "@/lib/email/resend";
import { hashEmail } from "@/lib/email/hash";
import { suppressHash } from "@/lib/email/consent";
import { loadRenderData } from "@/lib/email/render-data";
import { queueSends, resolveAudience } from "@/lib/email/audience";
import { getCampaignDetail, waveProblem } from "@/lib/email/reports";
import { rangeLabel } from "@/lib/email/format";
import { lineupStarter, STARTERS } from "@/lib/email/templates";
import { looksDeliverable } from "@/lib/email/rules";
import { centralDateTime, nextLineupSlot, nextSendSlot } from "@/lib/email/timing";
import { AUTOMATIONS, KIND_CATEGORY, PREF_CATEGORIES, type Audience, type Automation, type Category, type Exclusion } from "@/lib/email/types";
import type { CampaignContent, RenderData } from "@/lib/email/render";
import type { LintResult } from "@/lib/email/lint";

// Back office -> Email. Managers and up draft, preview and send tests;
// scheduling or sending to a list, switching automations, the never-mail
// list and resuming after a guardrail are for admins and owners (A10 #6).
// Every action checks the role itself. Errors come back as values, since
// production hides a thrown Server Action's message.

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDITABLE = new Set(["draft", "paused", "scheduled", "active", "off"]);

function revalidate(id?: string) {
  revalidatePath("/admin/email");
  if (id) revalidatePath(`/admin/email/${id}`);
}

// ---------- drafts ----------
export async function createCampaign(starterKey: string): Promise<Result<{ id: string }>> {
  const staff = await assertManager();
  const s = starterKey === "lineup" ? lineupStarter(nextLineupSlot().date, 7) : STARTERS.find((x) => x.key === starterKey);
  if (!s) return { ok: false, error: "Pick what kind of email." };
  const lineupStart = s.kind === "lineup" ? (s.content.lineup?.start ?? null) : null;
  const content: CampaignContent = s.content.window ? { ...s.content, window: { start: businessDay().date, days: s.content.window.days || 7 } } : s.content;
  const { data, error } = await createAdminClient()
    .from("email_campaigns")
    .insert({
      kind: s.kind,
      category: s.category,
      name: s.kind === "lineup" && lineupStart ? `Weekly lineup, ${rangeLabel(lineupStart, 7)}` : s.name,
      subject: s.subject || "This week at the Royale",
      preheader: s.preheader || null,
      content,
      audience: s.audience,
      holdout_pct: s.holdoutPct,
      status: "draft",
      lineup_start: lineupStart,
      created_by: staff.employeeId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't start the email. Try again." };
  revalidate();
  return { ok: true, id: data.id as string };
}

export interface CampaignDraft {
  name: string;
  subject: string;
  preheader: string;
  category: Category;
  content: CampaignContent;
  audience: Audience;
  holdoutPct: number;
}

function cleanAudience(a: Audience): Audience {
  const include = Array.isArray(a?.include) ? a.include.slice(0, 12) : [{ r: "all" as const }];
  const exclude = Array.isArray(a?.exclude) ? a.exclude.slice(0, 12) : [];
  const limit = a?.limit && Number(a.limit) > 0 ? Math.min(5000, Math.floor(Number(a.limit))) : undefined;
  const order = a?.order === "trust" || a?.order === "random" ? a.order : undefined;
  return { include: include.length ? include : [{ r: "all" }], ...(exclude.length ? { exclude } : {}), ...(limit ? { limit } : {}), ...(order ? { order } : {}) };
}

export async function saveCampaign(id: string, d: CampaignDraft): Promise<Result<{ status: string }>> {
  await assertManager();
  if (!UUID.test(id)) return { ok: false, error: "No such email." };
  const c = await getCampaign(id);
  if (!c) return { ok: false, error: "No such email." };
  if (!EDITABLE.has(c.status)) return { ok: false, error: "This email has gone out, so it can't be changed." };
  const subject = String(d.subject ?? "").trim().slice(0, 150);
  if (!subject) return { ok: false, error: "Add a subject line." };
  const category: Category =
    c.kind === "announcement" && (PREF_CATEGORIES as readonly string[]).includes(d.category) ? d.category : c.kind === "automation" || c.kind === "announcement" ? c.category : KIND_CATEGORY[c.kind as keyof typeof KIND_CATEGORY];
  const content: CampaignContent = { ...(d.content ?? { blocks: [] }), blocks: (d.content?.blocks ?? []).slice(0, 40), autopilot: false };
  const lineupStart = c.kind === "lineup" && content.lineup?.start && /^\d{4}-\d{2}-\d{2}$/.test(content.lineup.start) ? content.lineup.start : c.lineup_start;
  // A scheduled email that's changed needs approving again.
  const status = c.status === "scheduled" ? "draft" : c.status;
  const { error } = await createAdminClient()
    .from("email_campaigns")
    .update({
      name: String(d.name ?? "").trim().slice(0, 120) || c.name,
      subject,
      preheader: String(d.preheader ?? "").trim().slice(0, 200) || null,
      category,
      content,
      audience: cleanAudience(d.audience),
      holdout_pct: Math.max(0, Math.min(50, Math.floor(Number(d.holdoutPct) || 0))),
      lineup_start: lineupStart,
      status,
      ...(status !== c.status ? { approved_by: null, approved_at: null, scheduled_for: c.kind === "lineup" ? c.scheduled_for : null } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.code === "23505" ? "Another lineup email already covers that week." : "Couldn't save. Try again." };
  revalidate(id);
  return { ok: true, status };
}

// ---------- preview data, counts, lint ----------
export async function previewData(content: CampaignContent): Promise<Result<{ data: RenderData }>> {
  await assertManager();
  try {
    return { ok: true, data: await loadRenderData(content) };
  } catch {
    return { ok: false, error: "Couldn't load the showtimes." };
  }
}

export async function countAudience(
  id: string,
  audience: Audience,
  holdoutPct: number,
): Promise<Result<{ willSend: number; heldOut: number; excluded: Partial<Record<Exclusion, number>>; considered: number }>> {
  await assertManager();
  const c = await getCampaign(id);
  if (!c) return { ok: false, error: "No such email." };
  try {
    const at = nextSendSlot(c.scheduled_for && Date.parse(c.scheduled_for) > Date.now() ? new Date(c.scheduled_for) : new Date());
    const r = await dryRun({ ...c, audience: cleanAudience(audience), holdout_pct: Math.max(0, Math.min(50, Math.floor(holdoutPct) || 0)) }, at);
    return { ok: true, willSend: r.willSend, heldOut: r.heldOut, excluded: r.excluded, considered: r.considered };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't count." };
  }
}

export async function lintCampaignNow(id: string): Promise<Result<{ lint: LintResult }>> {
  await assertManager();
  const c = await getCampaign(id);
  if (!c) return { ok: false, error: "No such email." };
  const r = await lintStored(asInput(c)).catch(() => null);
  if (!r) return { ok: false, error: "Couldn't check the email." };
  return { ok: true, lint: { errors: r.errors, warnings: r.warnings } };
}

// ---------- tests ----------
// Renders the saved campaign on the server (never HTML from the browser)
// and sends it to the signed-in staff member's own address, plus the seed
// inboxes in EMAIL_SEED_LIST when asked.
export async function sendCampaignTest(id: string, seeds: boolean): Promise<Result<{ sentTo: number }>> {
  const staff = await assertManager();
  if (!staff.email) return { ok: false, error: "Your login has no email address to send the test to." };
  const c = await getCampaign(id);
  if (!c) return { ok: false, error: "No such email." };
  try {
    const r = await sendTestEmail(asInput(c), { email: staff.email, name: staff.name }, { seeds });
    return r.ok ? { ok: true, sentTo: r.sentTo } : r;
  } catch {
    return { ok: false, error: "Couldn't send the test." };
  }
}

// ---------- schedule and send ----------
export interface ScheduleInput {
  when: "now" | "at";
  date?: string | null; // Central "YYYY-MM-DD"
  time?: string | null; // Central "HH:MM"
  sendKey: string;
  sendAgain?: boolean;
}

export async function scheduleCampaign(id: string, input: ScheduleInput): Promise<Result<{ message: string }>> {
  const staff = await assertAdmin();
  if (!UUID.test(id) || !UUID.test(input.sendKey ?? "")) return { ok: false, error: "Reload the page and try again." };
  const admin = createAdminClient();
  const c = await getCampaign(id);
  if (!c) return { ok: false, error: "No such email." };
  if (c.kind === "automation") return { ok: false, error: "Automations are switched on, not scheduled." };

  // A double click (or a retried request) carries the same key: report
  // what the first one did.
  if (c.send_key === input.sendKey) return { ok: true, message: c.status === "sent" ? `Already sent to ${c.recipients ?? 0}.` : "Already scheduled." };
  if (!["draft", "paused"].includes(c.status)) return { ok: false, error: `This email is ${c.status}, so it can't be scheduled again.` };
  if (await guardrailPause()) return { ok: false, error: "Sending is paused by a guardrail. Resume it on the Email page first." };

  const lint = await lintStored(asInput(c)).catch(() => null);
  if (!lint) return { ok: false, error: "Couldn't check the email. Try again." };
  if (lint.errors.length) return { ok: false, error: `Fix this first: ${lint.errors[0]}` };

  if (c.kind === "lineup" && c.lineup_start && !input.sendAgain) {
    const { data: other } = await admin.from("email_campaigns").select("id, sent_at, status").eq("kind", "lineup").eq("lineup_start", c.lineup_start).neq("id", id).in("status", ["scheduled", "sending", "sent"]).limit(1);
    if (other?.length) return { ok: false, error: `The lineup for ${rangeLabel(c.lineup_start, 7)} is already ${other[0].status}. Tick "Send it again anyway" if you mean to.` };
  }

  let when: Date;
  if (input.when === "now") when = new Date();
  else {
    const t = centralDateTime(String(input.date ?? ""), String(input.time ?? ""));
    if (!t) return { ok: false, error: "Pick a date and time." };
    if (t.getTime() < Date.now() - 5 * 60_000) return { ok: false, error: "That time has passed." };
    when = t;
  }
  const slot = nextSendSlot(when);
  const { error } = await admin
    .from("email_campaigns")
    .update({
      status: "scheduled",
      scheduled_for: slot.toISOString(),
      send_key: input.sendKey,
      approved_by: staff.employeeId,
      approved_at: new Date().toISOString(),
      error: null,
      updated_at: new Date().toISOString(),
      // A second lineup for the same week (ticked "anyway") doesn't hold the week's slot.
      ...(c.kind === "lineup" && input.sendAgain ? { lineup_start: null } : {}),
    })
    .eq("id", id)
    .in("status", ["draft", "paused"]);
  if (error) return { ok: false, error: error.code === "23505" ? "Another lineup is already scheduled for that week." : "Couldn't schedule it. Try again." };

  const gate = sendingGate();
  const moved = slot.getTime() - when.getTime() > 60_000 ? " (moved into sending hours: 9 AM to 7 PM, Monday to Saturday)" : "";
  const whenText = slot.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
  if (!gate.ok) {
    revalidate(id);
    return { ok: true, message: `Scheduled for ${whenText}${moved}, but it won't go until this is fixed: ${gate.reason}` };
  }
  if (input.when === "now" && slot.getTime() - Date.now() < 5 * 60_000) {
    const r = await runCampaign(id, Date.now() + 240_000);
    revalidate(id);
    if (r.note && r.status === "paused") return { ok: false, error: r.note };
    return { ok: true, message: `${r.submitted} handed to Resend${r.status === "sent" ? ". All done." : ". The rest follow on the next run."}` };
  }
  revalidate(id);
  return { ok: true, message: `Scheduled for ${whenText}${moved}.` };
}

// Stops a scheduled or paused email: queued sends are cancelled, and any
// already handed to Resend for later are cancelled there.
export async function cancelCampaign(id: string): Promise<Result<{ stopped: number }>> {
  await assertAdmin();
  const c = await getCampaign(id);
  if (!c) return { ok: false, error: "No such email." };
  if (!["draft", "scheduled", "paused", "sending"].includes(c.status)) return { ok: false, error: "It's already gone out." };
  const admin = createAdminClient();
  await admin.from("email_campaigns").update({ status: "cancelled", locked_until: null, updated_at: new Date().toISOString() }).eq("id", id);
  await admin.from("email_sends").update({ status: "cancelled", error: "Email cancelled" }).eq("campaign_id", id).eq("status", "queued");
  const { data: later } = await admin.from("email_sends").select("id, resend_email_id, deliver_at").eq("campaign_id", id).eq("status", "scheduled").gt("deliver_at", new Date().toISOString());
  let stopped = 0;
  for (const s of later ?? []) {
    if (!s.resend_email_id) continue;
    const r = await cancelEmail(s.resend_email_id);
    if (r.ok) {
      await admin.from("email_sends").update({ status: "cancelled", error: "Email cancelled" }).eq("id", s.id);
      stopped++;
    }
  }
  revalidate(id);
  return { ok: true, stopped };
}

export async function unscheduleCampaign(id: string): Promise<Result> {
  await assertAdmin();
  const { error } = await createAdminClient()
    .from("email_campaigns")
    .update({ status: "draft", approved_by: null, approved_at: null, send_key: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "scheduled")
    .is("recipients", null);
  if (error) return { ok: false, error: "Couldn't change it." };
  revalidate(id);
  return { ok: true };
}

export async function resumeCampaign(id: string): Promise<Result> {
  await assertAdmin();
  if (await guardrailPause()) return { ok: false, error: "Sending is paused by a guardrail. Resume sending on the Email page first." };
  const { error } = await createAdminClient().from("email_campaigns").update({ status: "scheduled", error: null, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "paused");
  if (error) return { ok: false, error: "Couldn't resume it." };
  revalidate(id);
  return { ok: true };
}

// After a guardrail tripped: an admin has looked, and sending may go on.
export async function resumeAllSending(reason: string): Promise<Result> {
  const staff = await assertAdmin();
  const why = String(reason ?? "").trim();
  if (why.length < 5) return { ok: false, error: "Say what you checked (a few words)." };
  const admin = createAdminClient();
  await admin.from("email_settings").delete().eq("key", "guardrail_pause");
  await admin.from("email_settings").upsert({ key: "guardrail_resumed", value: { at: new Date().toISOString(), reason: why.slice(0, 300) }, updated_by: staff.employeeId, updated_at: new Date().toISOString() }, { onConflict: "key" });
  await admin.from("email_campaigns").update({ status: "scheduled", error: null }).eq("status", "paused").like("error", "Guardrail:%");
  revalidate();
  return { ok: true };
}

// ---------- the warm-up tool ----------
// The next `size` people (most trusted first) who haven't had this email
// yet. Refused while the last wave's hard bounces or complaints are over
// the warm-up limits, unless an admin types why it's fine.
export async function sendNextWave(id: string, size: number, override: string | null): Promise<Result<{ message: string }>> {
  const staff = await assertAdmin();
  const n = Math.max(10, Math.min(1000, Math.floor(Number(size)) || 150));
  const c = await getCampaign(id);
  if (!c) return { ok: false, error: "No such email." };
  if (c.kind === "automation" || ["cancelled", "failed"].includes(c.status)) return { ok: false, error: "This email can't send waves." };
  if (c.status === "scheduled" || c.status === "sending") return { ok: false, error: "A wave is still going out. Wait for it to finish." };
  if (await guardrailPause()) return { ok: false, error: "Sending is paused by a guardrail." };
  const lint = await lintStored(asInput(c)).catch(() => null);
  if (!lint || lint.errors.length) return { ok: false, error: lint ? `Fix this first: ${lint.errors[0]}` : "Couldn't check the email." };

  const detail = await getCampaignDetail(c);
  const problem = waveProblem(detail.waves[detail.waves.length - 1]);
  const why = (override ?? "").trim();
  if (problem && why.length < 5) return { ok: false, error: `${problem} Find out why first, or type what you checked to send anyway.` };

  const at = nextSendSlot(new Date());
  const audience: Audience = { ...(c.audience ?? { include: [{ r: "all" }] }), order: c.audience?.order ?? "trust" };
  const resolved = await resolveAudience({ id: c.id, kind: c.kind, category: c.category, automation: c.automation, alert: c.content?.alert ?? null, audience, holdoutPct: c.holdout_pct }, { at, limit: n });
  if (!resolved.send.length) return { ok: false, error: "Everyone in this audience has had it already." };
  const waveAt = new Date().toISOString();
  const queued = await queueSends(c.id, resolved, at);
  const waves = [...(((c.content as { waves?: { at: string; n: number }[] }).waves ?? []) as { at: string; n: number }[]), { at: waveAt, n: queued, ...(why ? { override: why.slice(0, 200), by: staff.employeeId } : {}) }];
  await createAdminClient()
    .from("email_campaigns")
    .update({
      content: { ...c.content, waves },
      recipients: (c.recipients ?? 0) + resolved.willSend,
      held_out: (c.held_out ?? 0) + resolved.heldOut,
      excluded: resolved.excluded,
      status: "scheduled",
      scheduled_for: at.toISOString(),
      approved_by: staff.employeeId,
      approved_at: waveAt,
      error: null,
      updated_at: waveAt,
    })
    .eq("id", id);
  const gate = sendingGate();
  if (!gate.ok) {
    revalidate(id);
    return { ok: true, message: `${queued} queued, but nothing goes until this is fixed: ${gate.reason}` };
  }
  const r = await runCampaign(id, Date.now() + 240_000);
  revalidate(id);
  return { ok: true, message: `Wave of ${queued}: ${r.submitted} handed to Resend.${r.note ? ` ${r.note}` : ""}` };
}

// ---------- automations ----------
export async function setAutomationOn(automation: string, on: boolean): Promise<Result> {
  await assertAdmin();
  if (!(AUTOMATIONS as readonly string[]).includes(automation)) return { ok: false, error: "No such automation." };
  const { error } = await createAdminClient()
    .from("email_campaigns")
    .update({ status: on ? "active" : "off", updated_at: new Date().toISOString() })
    .eq("automation", automation as Automation);
  if (error) return { ok: false, error: "Couldn't change it." };
  revalidatePath("/admin/email/automations");
  return { ok: true };
}

// ---------- the never-mail list ----------
// An address typed here is hashed on the server and never stored or logged.
export async function checkAddress(email: string): Promise<Result<{ reason: string | null; since: string | null }>> {
  await assertAdmin();
  const e = String(email ?? "").trim();
  if (!looksDeliverable(e)) return { ok: false, error: "That doesn't look like an email address." };
  const { data } = await createAdminClient().from("email_suppressions").select("reason, first_at").eq("email_hash", hashEmail(e)).maybeSingle();
  return { ok: true, reason: data?.reason ?? null, since: data?.first_at ?? null };
}

export async function blockAddress(email: string, note: string): Promise<Result> {
  await assertAdmin();
  const e = String(email ?? "").trim();
  if (!looksDeliverable(e)) return { ok: false, error: "That doesn't look like an email address." };
  try {
    await suppressHash(hashEmail(e), "manual", String(note ?? "").replace(/[^\s<>@"'(),;:]+@[^\s<>@"'(),;:]+/g, "[address]").slice(0, 200) || null);
  } catch {
    return { ok: false, error: "Couldn't save it." };
  }
  revalidatePath("/admin/email/suppressions");
  return { ok: true };
}

// Only a block added by hand can be lifted here. Bounces clear when the
// address changes; complaints only when the person opts back in themselves.
export async function unblockAddress(email: string): Promise<Result> {
  await assertAdmin();
  const e = String(email ?? "").trim();
  if (!looksDeliverable(e)) return { ok: false, error: "That doesn't look like an email address." };
  const { data, error } = await createAdminClient().from("email_suppressions").delete().eq("email_hash", hashEmail(e)).eq("reason", "manual").select("email_hash");
  if (error) return { ok: false, error: "Couldn't change it." };
  if (!data?.length) return { ok: false, error: "Only a block added by hand can be lifted here." };
  revalidatePath("/admin/email/suppressions");
  return { ok: true };
}

export async function duplicateCampaign(id: string): Promise<Result<{ id: string }>> {
  const staff = await assertManager();
  const { data: c } = await createAdminClient().from("email_campaigns").select(CAMPAIGN_COLUMNS).eq("id", id).maybeSingle();
  const src = c as CampaignRow | null;
  if (!src || src.kind === "automation") return { ok: false, error: "No such email." };
  const content = { ...src.content, waves: undefined, autopilot: false } as CampaignContent;
  const { data, error } = await createAdminClient()
    .from("email_campaigns")
    .insert({
      kind: src.kind,
      category: src.category,
      name: `${src.name} (copy)`,
      subject: src.subject,
      preheader: src.preheader,
      content,
      audience: src.audience,
      holdout_pct: src.holdout_pct,
      status: "draft",
      created_by: staff.employeeId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't copy it." };
  revalidate();
  return { ok: true, id: data.id as string };
}
