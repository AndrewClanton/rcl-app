import type { DueReminder, ReminderRow } from "./shared";

// Which reminders are due right now. Pure (no database, no clock of its
// own) so the rules can be tested directly; ops-actions supplies the data.

export interface ReminderInput {
  reminders: ReminderRow[];
  /** Screenings from ~10 minutes ago up to the longest lead time ahead. */
  screenings: { id: string; startsAt: string; title: string; room: string }[];
  /** Start of the last scheduled screening from now on, if any. */
  lastScheduledAt: string | null;
  nowMs: number;
  /** Minutes since midnight Central, and the business day. */
  nowMinutes: number;
  today: { date: string; dow: number };
  dismissed: Set<string>;
  names: Map<string, string>;
  clock: (iso: string) => string;
  shortDay: (iso: string) => string;
}

export function evaluateReminders(input: ReminderInput): DueReminder[] {
  const { reminders, nowMs, today } = input;
  const who = (r: ReminderRow) => (r.assignee_id ? input.names.get(r.assignee_id) ?? null : null);
  const out: DueReminder[] = [];

  for (const r of reminders) {
    if (!r.active) continue;

    if (r.kind === "before_screening") {
      const lead = r.minutes ?? 5;
      for (const s of input.screenings) {
        const minsTo = Math.round((new Date(s.startsAt).getTime() - nowMs) / 60_000);
        // From `lead` minutes before until 10 minutes after the start.
        if (minsTo > lead || minsTo < -10) continue;
        out.push({
          reminderId: r.id,
          occurrence: s.id,
          message: r.message,
          detail: `${s.title} · ${s.room} · ${minsTo > 0 ? `starts in ${minsTo} min` : minsTo === 0 ? "starting now" : `started ${-minsTo} min ago`} (${input.clock(s.startsAt)})`,
          assigneeName: who(r),
          urgent: minsTo <= 2,
        });
      }
    } else if (r.kind === "daily") {
      if (r.days && r.days.length && !r.days.includes(today.dow)) continue;
      if (!r.time_of_day) continue;
      const [h, m] = r.time_of_day.split(":").map(Number);
      // Due from its time until the business day rolls over at 4 a.m.
      // (nowMinutes < 240 means we're past midnight, still "today").
      const minutesIntoDay = input.nowMinutes < 240 ? input.nowMinutes + 1440 : input.nowMinutes;
      if (minutesIntoDay < h * 60 + m) continue;
      const t = new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      out.push({ reminderId: r.id, occurrence: today.date, message: r.message, detail: `Due at ${t}`, assigneeName: who(r), urgent: false });
    } else if (r.kind === "schedule_low") {
      const daysLeft = input.lastScheduledAt ? (new Date(input.lastScheduledAt).getTime() - nowMs) / 86_400_000 : 0;
      if (daysLeft >= (r.minutes ?? 7)) continue;
      out.push({
        reminderId: r.id,
        occurrence: today.date,
        message: r.message,
        detail: input.lastScheduledAt ? `Screenings are only scheduled through ${input.shortDay(input.lastScheduledAt)}.` : "Nothing is scheduled from here on.",
        assigneeName: who(r),
        urgent: false,
      });
    }
  }
  return out.filter((o) => !input.dismissed.has(`${o.reminderId}:${o.occurrence}`));
}
