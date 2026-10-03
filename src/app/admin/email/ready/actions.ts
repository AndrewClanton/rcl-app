"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin, assertManager } from "@/lib/auth";
import { senderRefusal } from "@/lib/email/senders";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/site";
import { allowAttempt } from "@/lib/rate-limit";
import {
  asInput,
  BRAKE_PREFIX,
  enforceWaveBrake,
  getCampaign,
  guardrailPause,
  lastWave,
  lintStored,
  nextWaveAfter,
  NO_HOLD,
  oneWaveADay,
  recallCampaign,
  replyTo,
  runCampaign,
  sendingGate,
  undoPending,
  undoSnapshot,
  undoUnderWay,
  type Pace,
  type RecallResult,
} from "@/lib/email/campaign-send";
import { sendEmail } from "@/lib/email/send";
import { firstNameOf } from "@/lib/email/format";
import { renderCampaign, type Recipient } from "@/lib/email/render";
import { arrivalLabel } from "@/lib/email/undo";
import { listUnsubscribeHeaders, preferencesUrl, sealEmailToken } from "@/lib/email/tokens";
import { DESIGNS, isDesignKey } from "@/lib/email/designs";
import { sealArtName } from "@/lib/email/designs/art-token";
import { designCampaign, picturesReady } from "@/lib/email/designs/ready";
import { getWaveMode, roomToday, saveSendPlan, saveWaveMode, saveWaveSize, waveCanGoToday } from "@/lib/email/send-plan";

// Back office -> Email -> Ready to send. Managers and up (the screen is
// for staff to send these three without an owner): a test to their own
// inbox, the send itself (in daily waves that fit Resend's limit), and
// pause or carry on. Unlike a typed email, these can't be edited here, and
// each goes only to its fixed audience, so managers may send them. Nothing
// here goes around the two sending switches (sendingGate), tests included.
// Carrying on after the automatic brake stopped an email is for admins and
// owners, who say what they checked.

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const off = (reason: string) => `Nothing goes out while sending is off, tests included. ${reason}`;
const STOPPED =
  "Sending is stopped right now (someone pressed Emergency stop, or too many emails bounced or were marked as spam). Someone who sends email can resume it on the Email page.";
const NO_PICTURES = "The pictures for these emails aren't on our picture server yet. The go-live checklist on the Email page shows what's missing.";

// "Paused. 78 called back from Resend; 2 had already gone."
function recallNote(r: RecallResult | null): string {
  if (!r) return " Couldn't call back what was waiting at Resend just now: press Pause again in a minute.";
  if (r.busy) return ` Another call-back was already running, so ${r.left.toLocaleString()} still waiting at Resend may arrive: press Pause again in a minute.`;
  const bits: string[] = [];
  if (r.recalled || r.failed) bits.push(`${r.recalled.toLocaleString()} called back from Resend; ${r.failed.toLocaleString()} had already gone`);
  if (r.left) bits.push(`${r.left.toLocaleString()} still waiting there (press Pause again to call them back)`);
  return bits.length ? ` ${bits.join(". ")}.` : " Nothing was waiting at Resend.";
}

function revalidate() {
  revalidatePath("/admin/email/ready");
  revalidatePath("/admin/email");
}

// ---------- a test to yourself ----------
export async function sendDesignTest(key: string): Promise<Result<{ message: string }>> {
  const staff = await assertManager();
  if (!isDesignKey(key)) return { ok: false, error: "Pick one of the three emails." };
  const gate = await sendingGate();
  if (!gate.ok) return { ok: false, error: off(gate.reason) };
  if (!staff.email) return { ok: false, error: "Your login has no email address to send the test to." };
  if (!(await allowAttempt(`design-test:${staff.employeeId}`, 10, 3600))) return { ok: false, error: "That's a lot of tests this hour. Try again later." };
  const d = DESIGNS[key];
  const admin = createAdminClient();
  // If their login is also a member, the test carries their own working
  // unsubscribe link, so that can be tried too.
  const { data: me } = await admin
    .from("members")
    .select("id, name, legacy_user_id")
    .ilike("email", staff.email.trim().replace(/[\\%_]/g, (x) => "\\" + x))
    .is("erased_at", null)
    .limit(1)
    .maybeSingle();
  const token = me ? sealEmailToken({ memberId: me.id as string, sendId: null }) : null;
  const first = firstNameOf((me?.name as string | undefined) ?? staff.name);
  const r: Recipient = {
    firstName: first,
    consentSource: "unknown",
    tier: "Insiders",
    hasLogin: false,
    email: staff.email,
    claimUrl: null,
    // A test: "Set my password" and "Restart my unlimited" open the
    // ordinary pages, not anyone's own link.
    sample: true,
    artToken: sealArtName(first),
    fromOldSite: (me?.legacy_user_id ?? null) !== null,
    sendId: null,
    finishUrl: null,
  };
  const out = renderCampaign(
    { kind: d.kind, category: d.category, subject: d.subject, preheader: d.preheader, content: { blocks: [{ t: "design", key }], design: key } },
    { range: { start: "", days: 7 }, films: [], happenings: [], menuItems: [] },
    r,
    {
      preferencesUrl: token ? preferencesUrl(token) : `${SITE_URL}/account/email`,
      unsubscribeUrl: token ? preferencesUrl(token, "all") : `${SITE_URL}/account/email#all`,
      href: (u) => u,
    },
  );
  const sent = await sendEmail(staff.email, `[Test] ${out.subject}`, out.html, {
    text: out.text,
    replyTo: replyTo(),
    headers: token ? listUnsubscribeHeaders(token) : undefined,
    tags: [{ name: "kind", value: "test" }],
  });
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true, message: `Sent to your inbox (${staff.email}). It can take a minute.` };
}

// ---------- the send ----------
// Starts it (or, for one that went before, sends it to whoever qualifies
// now and hasn't had it). The first wave goes now, to the 25 most engaged
// (send-plan.ts FIRST_WAVE; fewer if today's share or the wave size is
// smaller), so it can be judged before a full wave. Each later wave
// goes when staff press "Send the next wave" (sendNextWave), or, if an
// admin set waves to go by themselves, on the morning email runs. One
// wave a day at most (campaign-send.ts nextWaveAfter). The wave a press
// starts can be undone for a minute (/api/email/undo).
export async function sendDesign(key: string, sendKey: string): Promise<Result<{ message: string }>> {
  const staff = await assertManager();
  if (!isDesignKey(key) || !UUID.test(sendKey ?? "")) return { ok: false, error: "Reload the page and try again." };
  const notSender = await senderRefusal(staff);
  if (notSender) return { ok: false, error: notSender };
  const gate = await sendingGate();
  if (!gate.ok) return { ok: false, error: off(gate.reason) };
  if (await guardrailPause()) return { ok: false, error: STOPPED };
  if (!(await picturesReady())) return { ok: false, error: NO_PICTURES };
  const d = DESIGNS[key];
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const c = await designCampaign(key);
  if (c && ((c.content as { pace?: Pace }).pace ?? {}).undone?.key === sendKey) return { ok: false, error: UNDONE_KEY };
  if (c?.send_key === sendKey) return { ok: true, message: "Already started." };
  // Its last wave can still be undone (a wave that was everyone reads "sent").
  if (c && undoPending(c)) return { ok: false, error: "It was just sent, and can still be undone. Reload the page." };
  if (c && (c.status === "scheduled" || c.status === "sending")) return { ok: false, error: "It's already going out in waves. Reload the page to see the next wave." };
  if (c && c.status === "paused") return { ok: false, error: "It's paused. Press Carry on to send the rest." };
  // Sent again the same day as its last wave: that wave's results first.
  const next = c ? nextWaveAfter(await lastWave(c.id), new Date()) : null;
  if (next) return { ok: false, error: oneWaveADay(next) };

  const fields = {
    kind: d.kind,
    category: d.category,
    name: d.name,
    subject: d.subject,
    preheader: d.preheader,
    audience: d.audience,
    holdout_pct: 0,
    status: "scheduled",
    scheduled_for: now,
    send_key: sendKey,
    approved_by: staff.employeeId,
    approved_at: now,
    error: null,
    updated_at: now,
  };
  let id: string;
  if (!c) {
    const { data, error } = await admin
      .from("email_campaigns")
      .insert({ ...fields, content: { blocks: [{ t: "design", key }], design: key, pace: { go: now, goKey: sendKey, firstWave: true } }, created_by: staff.employeeId })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "Couldn't start it. Try again." };
    id = data.id as string;
  } else {
    // Sent before: the same email again, to the people who qualify now
    // and haven't had it. (A wave an admin already checked after the brake
    // stays checked.)
    const brakeOk = ((c.content as { pace?: Pace }).pace ?? {}).brakeOk ?? null;
    const { data, error } = await admin
      .from("email_campaigns")
      .update({ ...fields, content: { ...c.content, blocks: [{ t: "design", key }], design: key, pace: { go: now, goKey: sendKey, brakeOk, firstWave: true } } })
      .eq("id", c.id)
      .in("status", ["sent", "failed"])
      .select("id");
    if (error || !data?.length) return { ok: false, error: "Couldn't start it. Reload the page and try again." };
    id = c.id;
  }
  const stored = await designCampaign(key);
  const lint = stored ? await lintStored(asInput(stored)).catch(() => null) : null;
  if (!lint || lint.errors.length) {
    await admin.from("email_campaigns").update({ status: "paused", error: lint?.errors[0] ?? "Couldn't check the email." }).eq("id", id);
    revalidate();
    return { ok: false, error: lint ? `Something's wrong with the email: ${lint.errors[0]}` : "Couldn't check the email. Try again." };
  }
  const r = await runCampaign(id, Date.now() + 240_000, new Date(), { press: { key: sendKey, before: undoSnapshot(c), first: true } });
  revalidate();
  const undone = await undoneNote(id, sendKey);
  if (undone) return { ok: true, message: undone };
  if (r.status === "paused") return { ok: false, error: (await pausedWhy(id)) ?? r.note ?? "It paused. Reload the page to see why." };
  if (!r.submitted && r.status === "sent") return { ok: true, message: "Nobody new to send it to: everyone it's for has had it." };
  if (!r.submitted) return { ok: true, message: (await paceNote(id)) ?? `Nothing handed over just now.${await restNote(r)}` };
  return { ok: true, message: `${await handedNote(id, sendKey, r)}${await restNote(r)}` };
}

const UNDONE_KEY = "That send was undone. Reload the page to send it again.";

// Undone (in another tab, say) before this press's answer came back. (A
// read that fails says nothing.)
async function undoneNote(id: string, key: string): Promise<string | null> {
  const { data, error } = await createAdminClient().from("email_campaigns").select("content").eq("id", id).maybeSingle();
  if (error) return null;
  if (!data || ((data.content as { pace?: Pace } | null)?.pace ?? {}).undone?.key === key) return "It was undone before it went: nothing was sent.";
  return null;
}

// "80 handed to Resend now.", or for a wave that waits for the minute to
// undo, when it arrives (or that Resend wouldn't hold it, so no Undo).
async function handedNote(id: string, key: string, r: { submitted: number; noHold?: boolean }): Promise<string> {
  const c = await getCampaign(id).catch(() => null);
  const u = c ? undoPending(c) : null;
  if (u?.key === key) return `${r.submitted} handed to Resend, to arrive about ${arrivalLabel(u.arrives)}. You have a minute to undo it.`;
  if (r.noHold) return `${r.submitted} handed to Resend now. ${NO_HOLD}`;
  return `${r.submitted} handed to Resend now.`;
}

// Why it's paused (its error), without the brake's label.
async function pausedWhy(id: string): Promise<string | null> {
  const { data } = await createAdminClient().from("email_campaigns").select("error").eq("id", id).maybeSingle();
  const e = (data?.error as string | null | undefined) ?? null;
  return e ? e.replace(BRAKE_PREFIX, "") : null;
}

// The wave's own note (e.g. everyone left had another of these lately).
async function paceNote(id: string): Promise<string | null> {
  const { data } = await createAdminClient().from("email_campaigns").select("content").eq("id", id).maybeSingle();
  return ((data?.content as { pace?: Pace } | null)?.pace?.note as string | null | undefined) ?? null;
}

async function restNote(r: { status: string; note: string | null }): Promise<string> {
  if (r.status === "sent") return " That's everyone.";
  if ((await getWaveMode()) === "manual") return " Check how this wave does here; the next wave goes only when someone presses Send the next wave.";
  return ` The rest go in daily waves on the morning runs.${r.note ? ` (${r.note})` : ""}`;
}

// ---------- the next wave (manual waves) ----------
// Staff press "Send the next wave": one more wave, the next most engaged,
// as many as today's share allows, one wave a day at most. `pageKey` is
// fresh each page load, so a double click sends one wave.
export async function sendNextWave(key: string, pageKey: string): Promise<Result<{ message: string }>> {
  const staff = await assertManager();
  if (!isDesignKey(key) || !UUID.test(pageKey ?? "")) return { ok: false, error: "Reload the page and try again." };
  const notSender = await senderRefusal(staff);
  if (notSender) return { ok: false, error: notSender };
  const gate = await sendingGate();
  if (!gate.ok) return { ok: false, error: off(gate.reason) };
  if (await guardrailPause()) return { ok: false, error: STOPPED };
  if (!(await picturesReady())) return { ok: false, error: NO_PICTURES };
  const c = await designCampaign(key);
  const pace = ((c?.content as { pace?: Pace } | undefined)?.pace ?? {}) as Pace;
  if (pace.undone?.key === pageKey) return { ok: false, error: UNDONE_KEY };
  if (c && undoUnderWay(c)) return { ok: false, error: UNDO_UNDER_WAY };
  if (!c || !["scheduled", "sending"].includes(c.status)) return { ok: false, error: c?.status === "paused" ? "It's paused. Press Carry on sending first." : "It isn't going out right now." };
  if (pace.goKey === pageKey) return { ok: true, message: "Already sent." };
  if (undoPending(c)) return { ok: false, error: "The last wave can still be undone. Try again once its minute is up." };
  // One wave a day: the results, the brake and the wave count go by day.
  const now = new Date();
  const next = nextWaveAfter(await lastWave(c.id), now);
  if (next) return { ok: false, error: oneWaveADay(next, now) };
  // The brake: how the last wave did, before another goes.
  const brake = await enforceWaveBrake(c, { recall: "now" });
  if (brake) {
    revalidate();
    return { ok: false, error: `${brake.reason}${brake.recall && (brake.recall.recalled || brake.recall.left) ? recallNote(brake.recall) : ""}` };
  }
  const admin = createAdminClient();
  const { count: waiting } = await admin.from("email_sends").select("id", { count: "exact", head: true }).eq("campaign_id", c.id).eq("status", "queued");
  if (waiting) return { ok: false, error: "The last wave is still going out. Try again in a few minutes." };
  if (!waveCanGoToday(now)) return { ok: false, error: "Email only goes out 9 AM to 7 PM, Monday to Saturday. Try again then." };
  if ((await roomToday(now)) <= 0) return { ok: false, error: "Today's share of our email plan has gone. The next wave can go tomorrow (not Sunday)." };
  const { data, error } = await admin
    .from("email_campaigns")
    .update({ content: { ...c.content, pace: { ...pace, go: now.toISOString(), goKey: pageKey } }, scheduled_for: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", c.id)
    .eq("updated_at", c.updated_at)
    .in("status", ["scheduled", "sending"])
    .select("id");
  if (error || !data?.length) return { ok: false, error: "Couldn't start the next wave. Reload the page and try again." };
  const r = await runCampaign(c.id, Date.now() + 240_000, new Date(), { press: { key: pageKey, before: undoSnapshot(c), first: false } });
  revalidate();
  const undone = await undoneNote(c.id, pageKey);
  if (undone) return { ok: true, message: undone };
  if (r.status === "paused") return { ok: false, error: (await pausedWhy(c.id)) ?? r.note ?? "It paused. Reload the page to see why." };
  if (!r.ran) return { ok: false, error: r.note ?? "Couldn't send it just now. Try again in a minute." };
  if (!r.submitted && r.status === "sent") return { ok: true, message: "Nobody left to send it to: everyone it's for has had it." };
  if (!r.submitted) return { ok: true, message: (await paceNote(c.id)) ?? `Nothing handed over just now.${await restNote(r)}` };
  return { ok: true, message: `${await handedNote(c.id, pageKey, r)}${await restNote(r)}` };
}

const UNDO_UNDER_WAY = "Undo is calling back the last wave. Reload the page in a moment.";

// ---------- pause and carry on ----------
// Pause also calls back this email's sends already handed to Resend to
// arrive later (back into its queue, so Carry on sends them). Pressed again
// while paused, it calls back whatever is still waiting there.
export async function pauseDesign(key: string): Promise<Result<{ message: string }>> {
  await assertManager();
  if (!isDesignKey(key)) return { ok: false, error: "Pick one of the three emails." };
  const c = await designCampaign(key);
  if (!c || !["scheduled", "sending", "paused"].includes(c.status)) return { ok: false, error: "It isn't going out right now." };
  if (c.status !== "paused") {
    const { error } = await createAdminClient()
      .from("email_campaigns")
      .update({ status: "paused", error: "Paused from Ready to send. Press Carry on sending to send the rest.", updated_at: new Date().toISOString() })
      .eq("id", c.id)
      .in("status", ["scheduled", "sending"]);
    if (error) return { ok: false, error: "Couldn't pause it." };
  }
  const r = await recallCampaign(c.id, "Paused from Ready to send.").catch(() => null);
  revalidate();
  return { ok: true, message: `Paused. Nothing more goes until someone presses Carry on sending.${recallNote(r)}` };
}

// Carry on. After the automatic brake, only an admin or owner, saying what
// they checked (at least a few words); that clears the wave that tripped it.
export async function resumeDesign(key: string, checked?: string): Promise<Result<{ message: string }>> {
  const staff = await assertManager();
  if (!isDesignKey(key)) return { ok: false, error: "Pick one of the three emails." };
  // Carrying on sends the rest, so it's for the people who send.
  const notSender = await senderRefusal(staff);
  if (notSender) return { ok: false, error: notSender };
  const gate = await sendingGate();
  if (!gate.ok) return { ok: false, error: off(gate.reason) };
  if (await guardrailPause()) return { ok: false, error: STOPPED };
  const c = await designCampaign(key);
  if (!c || c.status !== "paused") return { ok: false, error: "It isn't paused." };
  if (undoUnderWay(c)) return { ok: false, error: UNDO_UNDER_WAY };
  let content = c.content;
  if ((c.error ?? "").startsWith(BRAKE_PREFIX)) {
    const what = String(checked ?? "").trim();
    if (what.length < 5) return { ok: false, error: "Say what you checked (a few words)." };
    const w = await lastWave(c.id);
    const pace = ((c.content as { pace?: Pace }).pace ?? {}) as Pace;
    content = { ...c.content, pace: { ...pace, brakeOk: w?.day ?? null, brakeCheck: { what: what.slice(0, 300), by: staff.employeeId, at: new Date().toISOString() } } } as typeof c.content;
  }
  // Same people as before; one started before the engagement order picks
  // its next waves by it too.
  const audience = { ...(c.audience ?? DESIGNS[key].audience), order: DESIGNS[key].audience.order };
  const { error } = await createAdminClient()
    .from("email_campaigns")
    .update({ status: "scheduled", error: null, audience, content, scheduled_for: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", c.id)
    .eq("status", "paused");
  if (error) return { ok: false, error: "Couldn't carry on." };
  const r = await runCampaign(c.id, Date.now() + 240_000);
  revalidate();
  if (r.status === "paused") return { ok: false, error: (await pausedWhy(c.id)) ?? r.note ?? "It paused again. Reload the page to see why." };
  if ((await getWaveMode()) === "manual" && r.status !== "sent") {
    return { ok: true, message: `Carrying on.${r.submitted ? ` ${r.submitted} left from the last wave handed to Resend.` : ""} Press Send the next wave when you're ready for more.` };
  }
  return { ok: true, message: `${r.submitted} handed to Resend now.${r.status === "sent" ? " That's everyone." : " The rest go on the morning runs."}` };
}

// ---------- the Resend plan (admins) ----------
export async function saveResendPlan(daily: number, monthly: number, reserve: number): Promise<Result> {
  const staff = await assertAdmin();
  try {
    await saveSendPlan({ daily, monthly, reserve }, staff.employeeId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save it." };
  }
  revalidate();
  return { ok: true };
}

// Wave size: how many get each day's wave. Keeps what's held back for
// receipts; Resend's daily figure becomes the two added up.
export async function saveWaveSizeAction(size: number): Promise<Result<{ size: number }>> {
  const staff = await assertAdmin();
  try {
    const plan = await saveWaveSize(size, staff.employeeId);
    revalidate();
    return { ok: true, size: Math.max(0, plan.daily - plan.reserve) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save it." };
  }
}

// Whether later waves wait for staff (manual, the default) or go by
// themselves on the morning runs. Admins.
export async function saveWaveModeAction(auto: boolean): Promise<Result> {
  const staff = await assertAdmin();
  try {
    await saveWaveMode(auto === true ? "auto" : "manual", staff.employeeId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save it." };
  }
  revalidate();
  return { ok: true };
}
