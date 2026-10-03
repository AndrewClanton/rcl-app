import { hasAdminAccess, requireManager } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { BRAKE_PREFIX, guardrailPause, masterSettingOn, sendingGate, SWITCH_OFF, UNDO_PREFIX, UNDO_UNFINISHED, undoPending, undoWaveHanded, UNDOING, waitingAtResend, WAVE_WAITING, type Pace } from "@/lib/email/campaign-send";
import { arrivalLabel, canUndoWave, undoHoldMs } from "@/lib/email/undo";
import { nextSendSlot } from "@/lib/email/timing";
import { DESIGNS } from "@/lib/email/designs";
import { countAudiences, designCampaign, designResults, picturesReady, previewHtml, type AudienceCount, type DesignResults } from "@/lib/email/designs/ready";
import { DESIGN_KEYS, type DesignKey } from "@/lib/email/designs/types";
import { finishDate, getSendPlan, getWaveMode, listUsage, nextMorningWave, perDay, perMonth, sendingDays, waveCanGoToday } from "@/lib/email/send-plan";
import type { CampaignRow } from "@/lib/email/campaign";
import ReadyToSend, { type CardData, type UndoCard } from "./ReadyToSend";

export const dynamic = "force-dynamic";
// "Send" hands the first wave to Resend inside the action.
export const maxDuration = 300;

// Back office -> Email -> Ready to send: the three ready-made invite emails
// (designed on the canvas), each with its preview, who it's for right now,
// a test to yourself, the send, and how it did. Managers and up.

const dayLabel = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/Chicago" });

export default async function ReadyToSendPage() {
  const staff = await requireManager();
  const now = new Date();
  const rows = Object.fromEntries(await Promise.all(DESIGN_KEYS.map(async (k) => [k, await designCampaign(k).catch(() => null)] as const))) as Record<DesignKey, CampaignRow | null>;
  const [plan, usage, pause, pictures, mode] = await Promise.all([
    getSendPlan(),
    listUsage(now).catch(() => ({ today: 0, month: 0 })),
    guardrailPause().catch(() => null),
    picturesReady(),
    getWaveMode(),
  ]);
  const gate = await sendingGate();
  const daily = perDay(plan);
  const monthLeft = Math.max(0, perMonth(plan) - usage.month);
  const todayLeft = waveCanGoToday(now) ? Math.max(0, Math.min(daily - usage.today, monthLeft)) : 0;
  // The next wave is as many as today's share allows (a full wave once
  // today's has gone).
  const [counts, results, atResend] = await Promise.all([
    countAudiences(rows, now, todayLeft > 0 ? todayLeft : daily).catch(() => null),
    Promise.all(DESIGN_KEYS.map(async (k) => [k, rows[k] ? await designResults(rows[k] as CampaignRow, k).catch(() => null) : null] as const)).then(
      (x) => Object.fromEntries(x) as Record<DesignKey, DesignResults | null>,
    ),
    // Handed to Resend to arrive later (Pause calls these back).
    Promise.all(DESIGN_KEYS.map(async (k) => [k, rows[k] ? await waitingAtResend((rows[k] as CampaignRow).id).catch(() => 0) : 0] as const)).then(
      (x) => Object.fromEntries(x) as Record<DesignKey, number>,
    ),
  ]);
  const slot = nextSendSlot(now);
  // The wave just pressed for, while it can be undone or is still on its
  // way: from what's saved, so a reload shows the same minute.
  const undos = Object.fromEntries(
    await Promise.all(
      DESIGN_KEYS.map(async (k): Promise<[DesignKey, UndoCard | null]> => {
        const c = rows[k];
        const u = c ? (((c.content as { pace?: Pace }).pace ?? {}).undo ?? null) : null;
        if (!c || !u || now.getTime() >= Date.parse(u.arrives)) return [k, null];
        const handed = await undoWaveHanded(c.id, u).catch(() => 0);
        return [
          k,
          { key: u.key, wave: u.wave, people: handed || u.n, until: Date.parse(u.until), arrives: Date.parse(u.arrives), arrivesLabel: arrivalLabel(u.arrives, now), first: u.first, started: !!u.started, undoing: c.error === UNDOING },
        ];
      }),
    ),
  ) as Record<DesignKey, UndoCard | null>;

  const cards: CardData[] = DESIGN_KEYS.map((key) => {
    const d = DESIGNS[key];
    const c = rows[key];
    const count: AudienceCount | null = counts?.[key] ?? null;
    const n = count?.willSend ?? 0;
    const days = sendingDays(n, daily, todayLeft);
    const preview = previewHtml(key, "claim");
    // The next wave if pressed now: how long it waits at Resend so it can
    // be undone (none for one too big to call back in time).
    const nextWave = Math.min(count?.next.n ?? 0, n) || daily;
    return {
      key,
      title: d.title,
      about: d.about,
      who: d.who,
      subject: preview.subject,
      preheader: preview.preheader,
      desktopHtml: preview.html,
      loginHtml: key === "come-in" ? previewHtml(key, "login").html : null,
      text: preview.text,
      count,
      days: Number.isFinite(days) ? days : null,
      finish: n > 0 && Number.isFinite(days) ? dayLabel(finishDate(days, now, todayLeft > 0)) : null,
      overMonth: n > monthLeft,
      status: c?.status ?? null,
      // "Waiting for staff" is what the wave line says already, and the
      // brake has its own panel.
      // An Undo's note, once that Undo can no longer carry on, says so plainly.
      note:
        c?.error?.startsWith(UNDO_PREFIX) && !undoPending(c, now.getTime())
          ? UNDO_UNFINISHED
          : c?.error && !c.error.includes(WAVE_WAITING) && !c.error.startsWith(BRAKE_PREFIX)
            ? c.error
            : null,
      brake: c?.status === "paused" && c.error?.startsWith(BRAKE_PREFIX) ? c.error.slice(BRAKE_PREFIX.length) : null,
      atResend: atResend[key] ?? 0,
      campaignId: c?.id ?? null,
      results: results[key],
      outcomeLabel: d.outcome.label,
      outcomeAbout: d.outcome.about,
      sendKey: crypto.randomUUID(),
      undo: undos[key],
      undoMinutes: canUndoWave(nextWave) ? Math.round(undoHoldMs(nextWave) / 60_000) : null,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        area="guests"
        back={{ href: "/admin/email", label: "Email" }}
        title="Ready to send"
        purpose="Three finished emails, ready to go to members: look, send yourself a test, then send. They go out in waves, the members most used to hearing from us first, so each wave can be checked before the next."
      />
      <ReadyToSend
        cards={cards}
        sendingOn={gate.ok}
        offReason={gate.ok ? null : gate.reason}
        offKind={gate.ok ? null : !masterSettingOn() ? "master" : gate.reason === SWITCH_OFF ? "switch" : "setup"}
        stopped={pause ? pause.reason : null}
        picturesReady={pictures}
        countsFailed={!counts}
        plan={{
          ...plan,
          perDay: daily,
          perMonth: perMonth(plan),
          usedToday: usage.today,
          usedMonth: usage.month,
          todayLeft,
          monthLeft,
          auto: mode === "auto",
          // Automatic: the next morning run's wave. Manual: the next day a
          // wave can go once today's share has gone.
          nextWave: dayLabel(nextMorningWave(now, mode === "auto" && todayLeft > 0)),
          goesAt: slot.getTime() === now.getTime() ? "now" : `at ${slot.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })} ${dayLabel(slot)}`,
        }}
        isAdmin={hasAdminAccess(staff.role)}
        myEmail={staff.email}
        serverNow={now.getTime()}
      />
    </div>
  );
}
