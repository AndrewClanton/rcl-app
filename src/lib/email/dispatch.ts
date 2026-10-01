import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay } from "@/lib/ops/time";
import { CAMPAIGN_COLUMNS, type CampaignRow } from "./campaign";
import { loadFacts } from "./audience";
import { retryPendingCancels } from "./consent";
import { enforceGuardrails, guardrailPause, recallAll, runCampaign, scheduleAheadMs, sendingGate, settleStuck, type RecallResult, type RunResult } from "./campaign-send";
import { draftWeeklyLineup, ensureAutomations, isMonday, queueAutomation } from "./automations";
import { centralParts, nextSendSlot } from "./timing";
import { priorityOf } from "./types";

// What /api/cron/email does on each run (every 15 minutes on Vercel Pro,
// once a morning on Hobby):
//   1. runs whose lease ran out go back to the queue;
//   2. once a day: engagement catches up (and "Still want these?" people
//      who never answered go quiet), and on Mondays the lineup draft is made;
//   3. if sending is on and no guardrail has tripped: every campaign that's
//      due (within the schedule-ahead window) and every active automation,
//      most important first -- account emails, the lineup, birthday,
//      welcome, events, alerts, offers, win-back -- so the important ones
//      use up each person's caps first. Automations queue today's sends
//      once a day; their queued sends go out on every run.
// Email that arrives later than this run is handed to Resend now with
// scheduled_at, so Tuesday's lineup still lands at 10:30. When sending is
// switched off or paused, email Resend already holds for later is called
// back instead (all of it, over as many runs as it takes), and the emails
// it belonged to pause until an admin resumes them.

export interface CronSummary {
  daily: Record<string, unknown> | null;
  blocked: string | null;
  recall?: RecallResult | null; // email called back from Resend while blocked
  cancelsRetried?: number; // opt-outs whose cancel at Resend failed the first time
  runs: RunResult[];
  queued: Record<string, number>;
}

async function claimDailyRun(today: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from("email_settings").select("value").eq("key", "daily_run").maybeSingle();
  if ((data?.value as { date?: string } | undefined)?.date === today) return false;
  await admin.from("email_settings").upsert({ key: "daily_run", value: { date: today, at: new Date().toISOString() }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  return true;
}

export async function runEmailCron(deadline: number, now = new Date()): Promise<CronSummary> {
  const summary: CronSummary = { daily: null, blocked: null, runs: [], queued: {} };
  await settleStuck(now);
  // Cancels Resend didn't take the first time (an unsubscribe while it was
  // busy): again now, while the email is still waiting there.
  summary.cancelsRetried = await retryPendingCancels(deadline).catch(() => 0);

  const today = businessDay(now).date;
  const daily = await claimDailyRun(today);
  if (daily) {
    const { data: engagement } = await createAdminClient().rpc("email_refresh_engagement");
    summary.daily = { engagement: engagement ?? null };
    if (isMonday(now)) summary.daily.lineupDraft = await draftWeeklyLineup(now).catch(() => null);
  }

  const gate = sendingGate();
  if (!gate.ok) {
    summary.blocked = gate.reason;
    // Say why on anything that's waiting, so the Back office shows it.
    await createAdminClient().from("email_campaigns").update({ error: gate.reason }).eq("status", "scheduled");
    // Switched off: email already handed to Resend for later is called back
    // too, and its emails pause, so an admin decides whether they still go.
    summary.recall = await recallAll(`Sending is switched off: ${gate.reason}`, { deadline }).catch(() => null);
    return summary;
  }
  const g = await enforceGuardrails(now, { recall: false });
  const pause = g.tripped ? null : await guardrailPause();
  if (g.tripped || pause) {
    summary.blocked = g.reason ?? pause?.reason ?? "Paused by a guardrail until an admin resumes sending.";
    summary.recall = await recallAll(`${pause?.by ?? "Guardrail"}: ${summary.blocked}`, { deadline }).catch(() => null);
    return summary;
  }

  const admin = createAdminClient();
  const horizon = now.getTime() + scheduleAheadMs();
  const [{ data: waiting }, automations] = await Promise.all([
    admin.from("email_campaigns").select(CAMPAIGN_COLUMNS).is("automation", null).in("status", ["scheduled", "sending"]),
    ensureAutomations(),
  ]);
  const due = ((waiting ?? []) as CampaignRow[]).filter(
    (c) =>
      (c.status === "scheduled" || (c.status === "sending" && (!c.locked_until || Date.parse(c.locked_until) < now.getTime()))) &&
      (!c.scheduled_for || Date.parse(c.scheduled_for) <= horizon),
  );
  const work = [...due, ...automations.filter((a) => a.status === "active")].sort((a, b) => priorityOf(a) - priorityOf(b));

  for (const c of work) {
    if (Date.now() > deadline) break;
    // Facts are read again for each automation, so each one's caps see what
    // the ones before it just queued.
    if (c.automation && daily && c.automation !== "welcome_1") {
      try {
        summary.queued[c.automation] = await queueAutomation(c, now, await loadFacts());
      } catch (e) {
        await admin.from("email_campaigns").update({ error: e instanceof Error ? e.message : "Couldn't queue." }).eq("id", c.id);
      }
    }
    summary.runs.push(await runCampaign(c.id, deadline, now));
  }
  return summary;
}

// Right after sending resumes (after a stop or a guardrail): one-off emails
// due today, and what the automations already have queued, go now rather
// than on tomorrow morning's run. Each is still checked for its send window,
// the caps and its "too late" time.
export async function runDueNow(deadline: number, now = new Date()): Promise<RunResult[]> {
  const admin = createAdminClient();
  const today = centralParts(now).date;
  const [{ data: waiting }, automations] = await Promise.all([admin.from("email_campaigns").select(CAMPAIGN_COLUMNS).is("automation", null).eq("status", "scheduled"), ensureAutomations()]);
  const due = ((waiting ?? []) as CampaignRow[]).filter((c) => {
    const planned = c.scheduled_for && Date.parse(c.scheduled_for) > now.getTime() ? new Date(c.scheduled_for) : now;
    const slot = nextSendSlot(planned);
    return centralParts(slot).date === today && slot.getTime() - now.getTime() <= scheduleAheadMs();
  });
  // Each active automation with anything queued (asked one by one, so a big
  // queue for one can't hide another's).
  const active = automations.filter((a) => a.status === "active");
  const withQueue = new Set<string>();
  for (const a of active) {
    const { data } = await admin.from("email_sends").select("id").eq("campaign_id", a.id).eq("status", "queued").limit(1);
    if (data?.length) withQueue.add(a.id);
  }
  const work = [...due, ...active.filter((a) => withQueue.has(a.id))].sort((a, b) => priorityOf(a) - priorityOf(b));
  const runs: RunResult[] = [];
  for (const c of work) {
    if (Date.now() > deadline) break;
    runs.push(await runCampaign(c.id, deadline, now));
  }
  return runs;
}
