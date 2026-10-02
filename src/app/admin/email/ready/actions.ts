"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin, assertManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { SITE_URL } from "@/lib/site";
import { allowAttempt } from "@/lib/rate-limit";
import { asInput, guardrailPause, lintStored, replyTo, runCampaign, sendingGate } from "@/lib/email/campaign-send";
import { sendEmail } from "@/lib/email/send";
import { firstNameOf } from "@/lib/email/format";
import { renderCampaign, type Recipient } from "@/lib/email/render";
import { listUnsubscribeHeaders, preferencesUrl, sealEmailToken } from "@/lib/email/tokens";
import { DESIGNS, isDesignKey } from "@/lib/email/designs";
import { sealArtName } from "@/lib/email/designs/art-token";
import { designCampaign, picturesReady } from "@/lib/email/designs/ready";
import { saveSendPlan } from "@/lib/email/send-plan";

// Back office -> Email -> Ready to send. Managers and up (the screen is
// for staff to send these three without an owner): a test to their own
// inbox, the send itself (in daily waves that fit Resend's limit), and
// pause or carry on. Unlike a typed email, these can't be edited here, and
// each goes only to its fixed audience, so managers may send them. Nothing
// here goes around EMAIL_SENDING_ENABLED, tests included.

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OFF = "Sending is switched off, so nothing goes out (tests included). Ask Andrew to turn it on.";

function revalidate() {
  revalidatePath("/admin/email/ready");
  revalidatePath("/admin/email");
}

// ---------- a test to yourself ----------
export async function sendDesignTest(key: string): Promise<Result<{ message: string }>> {
  const staff = await assertManager();
  if (!isDesignKey(key)) return { ok: false, error: "Pick one of the three emails." };
  if (!sendingGate().ok) return { ok: false, error: OFF };
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
// now and hasn't had it). The first wave goes now, as much as today's share
// of Resend's daily limit allows; the rest go on the morning email runs.
export async function sendDesign(key: string, sendKey: string): Promise<Result<{ message: string }>> {
  const staff = await assertManager();
  if (!isDesignKey(key) || !UUID.test(sendKey ?? "")) return { ok: false, error: "Reload the page and try again." };
  const gate = sendingGate();
  if (!gate.ok) return { ok: false, error: OFF };
  if (await guardrailPause()) return { ok: false, error: "Sending is stopped right now (by an admin, or because too many emails bounced or were marked as spam). Ask Andrew." };
  if (!(await picturesReady())) return { ok: false, error: "The pictures for these emails aren't on our server yet. Ask Andrew (they go up once, with scripts/email-designs/upload.mjs)." };
  const d = DESIGNS[key];
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const c = await designCampaign(key);
  if (c?.send_key === sendKey) return { ok: true, message: "Already started." };
  if (c && (c.status === "scheduled" || c.status === "sending")) return { ok: false, error: "It's already going out in daily waves. The next wave goes on tomorrow morning's run." };
  if (c && c.status === "paused") return { ok: false, error: "It's paused. Press Carry on to send the rest." };

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
      .insert({ ...fields, content: { blocks: [{ t: "design", key }], design: key, pace: {} }, created_by: staff.employeeId })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "Couldn't start it. Try again." };
    id = data.id as string;
  } else {
    // Sent before: the same email again, to the people who qualify now
    // and haven't had it.
    const { data, error } = await admin
      .from("email_campaigns")
      .update({ ...fields, content: { ...c.content, blocks: [{ t: "design", key }], design: key, pace: {} } })
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
  const r = await runCampaign(id, Date.now() + 240_000);
  revalidate();
  if (r.status === "paused" && r.note) return { ok: false, error: r.note };
  if (!r.submitted && r.status === "sent") return { ok: true, message: "Nobody new to send it to: everyone it's for has had it." };
  const rest = r.status === "sent" ? " That's everyone." : ` The rest go in daily waves on the morning runs.${r.note ? ` (${r.note})` : ""}`;
  return { ok: true, message: `${r.submitted} handed to Resend now.${rest}` };
}

// ---------- pause and carry on ----------
export async function pauseDesign(key: string): Promise<Result> {
  await assertManager();
  if (!isDesignKey(key)) return { ok: false, error: "Pick one of the three emails." };
  const c = await designCampaign(key);
  if (!c || !["scheduled", "sending"].includes(c.status)) return { ok: false, error: "It isn't going out right now." };
  const { error } = await createAdminClient()
    .from("email_campaigns")
    .update({ status: "paused", error: "Paused from Ready to send. Press Carry on to send the rest.", updated_at: new Date().toISOString() })
    .eq("id", c.id)
    .in("status", ["scheduled", "sending"]);
  if (error) return { ok: false, error: "Couldn't pause it." };
  revalidate();
  return { ok: true };
}

export async function resumeDesign(key: string): Promise<Result<{ message: string }>> {
  await assertManager();
  if (!isDesignKey(key)) return { ok: false, error: "Pick one of the three emails." };
  if (!sendingGate().ok) return { ok: false, error: OFF };
  if (await guardrailPause()) return { ok: false, error: "Sending is stopped right now. Ask Andrew." };
  const c = await designCampaign(key);
  if (!c || c.status !== "paused") return { ok: false, error: "It isn't paused." };
  const { error } = await createAdminClient()
    .from("email_campaigns")
    .update({ status: "scheduled", error: null, scheduled_for: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", c.id)
    .eq("status", "paused");
  if (error) return { ok: false, error: "Couldn't carry on." };
  const r = await runCampaign(c.id, Date.now() + 240_000);
  revalidate();
  if (r.status === "paused" && r.note) return { ok: false, error: r.note };
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
