import { hasAdminAccess, requireManager } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import { guardrailPause, sendingGate } from "@/lib/email/campaign-send";
import { DESIGNS } from "@/lib/email/designs";
import { countAudiences, designCampaign, designResults, picturesReady, previewHtml, type AudienceCount, type DesignResults } from "@/lib/email/designs/ready";
import { DESIGN_KEYS, type DesignKey } from "@/lib/email/designs/types";
import { finishDate, getSendPlan, listUsage, perDay, perMonth, sendingDays, waveCanGoToday } from "@/lib/email/send-plan";
import type { CampaignRow } from "@/lib/email/campaign";
import ReadyToSend, { type CardData } from "./ReadyToSend";

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
  const [counts, plan, usage, pause, pictures] = await Promise.all([
    countAudiences(rows, now).catch(() => null),
    getSendPlan(),
    listUsage(now).catch(() => ({ today: 0, month: 0 })),
    guardrailPause().catch(() => null),
    picturesReady(),
  ]);
  const results = Object.fromEntries(
    await Promise.all(DESIGN_KEYS.map(async (k) => [k, rows[k] ? await designResults(rows[k] as CampaignRow, k).catch(() => null) : null] as const)),
  ) as Record<DesignKey, DesignResults | null>;
  const gate = sendingGate();
  const daily = perDay(plan);
  const monthLeft = Math.max(0, perMonth(plan) - usage.month);
  const todayLeft = waveCanGoToday(now) ? Math.max(0, Math.min(daily - usage.today, monthLeft)) : 0;

  const cards: CardData[] = DESIGN_KEYS.map((key) => {
    const d = DESIGNS[key];
    const c = rows[key];
    const count: AudienceCount | null = counts?.[key] ?? null;
    const n = count?.willSend ?? 0;
    const days = sendingDays(n, daily, todayLeft);
    const preview = previewHtml(key, "claim");
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
      note: c?.error ?? null,
      campaignId: c?.id ?? null,
      results: results[key],
      outcomeLabel: d.outcome.label,
      outcomeAbout: d.outcome.about,
      sendKey: crypto.randomUUID(),
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        area="guests"
        back={{ href: "/admin/email", label: "Email" }}
        title="Ready to send"
        purpose="Three finished emails, ready to go to members: look, send yourself a test, then send. They go out a little each day so we stay inside our email plan."
      />
      <ReadyToSend
        cards={cards}
        sendingOn={gate.ok}
        offReason={gate.ok ? null : gate.reason}
        stopped={pause ? pause.reason : null}
        picturesReady={pictures}
        countsFailed={!counts}
        plan={{ ...plan, perDay: daily, perMonth: perMonth(plan), usedToday: usage.today, usedMonth: usage.month, todayLeft, monthLeft }}
        isAdmin={hasAdminAccess(staff.role)}
        myEmail={staff.email}
      />
    </div>
  );
}
