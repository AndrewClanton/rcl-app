import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportRecipients } from "@/lib/daily-report";
import { sendEmail } from "@/lib/email/send";
import { problemSentence, scheduleProblem, sinceLabel } from "@/lib/calendar-status";
import { getCalendarStatus } from "@/lib/calendar-status-server";

// The "schedule not checked" email to the owners and admins (the daily
// report's list, lib/daily-report.ts). An internal staff alert, sent as
// transactional mail, never to members. /api/cron/calendar-alert runs it
// every 15 minutes: while the schedule check is over an hour old or failing
// it emails at most once every 3 hours, and once more when it's back.
//
// What's been sent is kept in settings "calendar_alert_state".

const STATE_KEY = "calendar_alert_state";
const EVERY_MS = 3 * 3_600_000;

interface AlertState {
  open: boolean; // a "not checked" email went out and no "back" email since
  lastSentAt: string | null;
}

const INK = "#14110c";
const MUTED = "#6b6455";
const RED = "#ed1c24";
const GREEN = "#1f7a3a";
const GOLD = "#ffc72c";
const CREAM = "#f8f5ec";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function html(o: { band: string; bandColor: string; head: string; lines: string[]; button?: { href: string; label: string } }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:${CREAM}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM}"><tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:3px solid ${INK};border-collapse:separate">
      <tr><td style="background:${o.bandColor};padding:14px 22px;font:900 13px/1 Arial,Helvetica,sans-serif;letter-spacing:3px;text-transform:uppercase;color:#ffffff">${esc(o.band)}</td></tr>
      <tr><td style="padding:20px 22px 4px;font:900 24px/1.25 Arial,Helvetica,sans-serif;color:${INK}">${esc(o.head)}</td></tr>
      <tr><td style="padding:10px 22px ${o.button ? "4px" : "22px"}">${o.lines.map((l) => `<p style="margin:0 0 12px;font:15px/1.5 Arial,Helvetica,sans-serif;color:${INK}">${esc(l)}</p>`).join("")}</td></tr>
      ${
        o.button
          ? `<tr><td style="padding:4px 22px 22px">
        <a href="${esc(o.button.href)}" style="display:inline-block;background:${INK};color:${GOLD};font:900 13px/1 Arial,Helvetica,sans-serif;letter-spacing:1px;text-transform:uppercase;text-decoration:none;padding:12px 18px">${esc(o.button.label)}</a>
        <p style="margin:12px 0 0;font:12px/1.5 Arial,Helvetica,sans-serif;color:${MUTED}">Opens Back office → Showtimes → Sync from calendar. You'll need to be signed in.</p>
      </td></tr>`
          : ""
      }
    </table>
    <div style="max-width:560px;margin:14px auto 0;font:11px/1.5 'Courier New',monospace;color:${MUTED};letter-spacing:1px;text-transform:uppercase">Sent to the owners and admins. The RCL crew</div>
  </td></tr></table>
</body></html>`;
}

async function loadState(): Promise<AlertState> {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", STATE_KEY).maybeSingle();
  const v = (data?.value ?? {}) as Partial<AlertState>;
  return { open: v.open === true, lastSentAt: typeof v.lastSentAt === "string" ? v.lastSentAt : null };
}

async function saveState(s: AlertState) {
  const { error } = await createAdminClient().from("settings").upsert({ key: STATE_KEY, value: s, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) console.error("calendar alert state:", error.message);
}

async function sendAll(subject: string, body: string) {
  const to = await reportRecipients();
  const sent: string[] = [];
  const failed: string[] = [];
  for (const t of to) {
    const r = await sendEmail(t, subject, body, { tags: [{ name: "category", value: "calendar_alert" }] });
    if (r.ok) sent.push(t);
    else failed.push(`${t}: ${r.error}`);
  }
  return { sent: sent.length, failed };
}

export async function runCalendarAlert(siteUrl: string, now = Date.now()) {
  const status = await getCalendarStatus();
  const problem = scheduleProblem(status, now);
  const state = await loadState();
  const syncUrl = `${siteUrl}/admin/screenings/sync`;

  if (problem) {
    if (state.lastSentAt && state.open && now - Date.parse(state.lastSentAt) < EVERY_MS) return { problem: true, sent: 0, skipped: "sent within the last 3 hours" };
    const lines = [
      problemSentence(problem, now),
      ...(problem.failed && problem.error ? [`What went wrong: ${problem.error}`] : []),
      "A guest could come in for a showing the calendar has changed. Sync from the calendar now, or check the hourly calendar check is running.",
    ];
    const subject = problem.since ? `Schedule not checked since ${sinceLabel(problem.since, now)}` : "Schedule not checked against the calendar";
    const r = await sendAll(subject, html({ band: "Schedule check", bandColor: RED, head: "The showtimes may be out of date", lines, button: { href: syncUrl, label: "Check now" } }));
    if (r.sent) await saveState({ open: true, lastSentAt: new Date(now).toISOString() });
    return { problem: true, ...r };
  }

  if (state.open && status) {
    const lines = [`The schedule was checked against the calendar at ${sinceLabel(status.at, now)}, so the website's showtimes are up to date again.`];
    if ((status.flagged ?? 0) > 0) lines.push(...(status.flaggedLines ?? []), "Those are on the Showtimes page too.");
    const r = await sendAll("Schedule check is back", html({ band: "Schedule check", bandColor: GREEN, head: "Back to normal", lines }));
    if (r.sent) await saveState({ open: false, lastSentAt: state.lastSentAt });
    return { problem: false, recovered: true, ...r };
  }
  return { problem: false, sent: 0 };
}
