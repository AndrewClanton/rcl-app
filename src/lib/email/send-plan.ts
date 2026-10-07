import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { inSendWindow, nextSendSlot } from "./timing";

// Resend's sending limits, and how much of today's is left for list email.
//
// Resend's plan allows 50,000 emails a month for everything it sends
// (receipts, tickets, the daily report and these lists alike); it counts
// the day by the UTC calendar. A list email goes out either in daily waves
// (the wave size: `daily` less what's kept back) or all at once with "Send
// to everyone now", never more than the day's cap (`cap`, 2,000 unless set)
// nor the month's limit less what's kept back for the everyday mail, so a
// big send can never stop a receipt.
//
// The numbers live in email_settings ('resend_plan'); an admin changes them
// on Back office -> Email -> Settings.

export interface SendPlan {
  daily: number; // a wave's share a day plus what's kept back (wave size = daily - reserve)
  monthly: number; // Resend's monthly limit
  reserve: number; // kept back each day for receipts, tickets and the daily report
  cap: number; // the most list email in one day, every email together ("Send to everyone now" included)
}

// The most list email a day unless an admin sets another (Email, Settings).
// Resend's paid plan (50,000 a month) has no daily limit of its own; this
// keeps one bad day from using up the month. (Andrew, 10/7: "100 a day
// won't work, we have 2000+ subscribers".)
export const DEFAULT_DAILY_CAP = 2000;
export const FREE_PLAN: SendPlan = { daily: 100, monthly: 3000, reserve: 20, cap: DEFAULT_DAILY_CAP };
const KEY = "resend_plan";

function clean(v: Partial<SendPlan> | null | undefined): SendPlan {
  const n = (x: unknown, d: number, max: number) => (Number.isFinite(Number(x)) && Number(x) >= 0 ? Math.min(max, Math.floor(Number(x))) : d);
  const daily = n(v?.daily, FREE_PLAN.daily, 1_000_000) || FREE_PLAN.daily;
  const monthly = n(v?.monthly, FREE_PLAN.monthly, 50_000_000) || FREE_PLAN.monthly;
  const reserve = Math.min(n(v?.reserve, FREE_PLAN.reserve, 1_000_000), Math.max(0, daily - 1));
  const cap = n(v?.cap, DEFAULT_DAILY_CAP, 1_000_000) || DEFAULT_DAILY_CAP;
  return { daily, monthly, reserve, cap };
}

export async function getSendPlan(): Promise<SendPlan> {
  try {
    const { data } = await createAdminClient().from("email_settings").select("value").eq("key", KEY).maybeSingle();
    return clean((data?.value as Partial<SendPlan> | undefined) ?? null);
  } catch {
    return FREE_PLAN;
  }
}

export async function saveSendPlan(p: Partial<SendPlan>, employeeId: string | null): Promise<SendPlan> {
  const plan = clean(p);
  const { error } = await createAdminClient()
    .from("email_settings")
    .upsert({ key: KEY, value: plan, updated_at: new Date().toISOString(), ...(employeeId ? { updated_by: employeeId } : {}) }, { onConflict: "key" });
  if (error) throw new Error("Couldn't save the plan.");
  return plan;
}

// List emails per day, after what's kept back.
export const perDay = (p: SendPlan) => Math.max(0, p.daily - p.reserve);
// List emails per month: the monthly limit less the everyday mail's share.
export const perMonth = (p: SendPlan) => Math.max(0, p.monthly - p.reserve * 30);

const DAY = 86_400_000;
export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

// Emails Undo called back from Resend (Ready to send), by the day (UTC)
// they were handed over. Their rows are gone, but Resend may still count
// them against that day's and month's limit, so they're counted here too
// (email_settings 'undone_at_resend', {days: {"2026-10-13": 25}}, the last
// 40 days). Written only under the call-back lease, one at a time.
const UNDONE = "undone_at_resend";

async function undoneDays(): Promise<Record<string, number>> {
  const { data, error } = await createAdminClient().from("email_settings").select("value").eq("key", UNDONE).maybeSingle();
  if (error) throw new Error("Couldn't count today's email.");
  const days = (data?.value as { days?: Record<string, unknown> } | undefined)?.days ?? {};
  return Object.fromEntries(Object.entries(days).map(([d, n]) => [d, Number(n) || 0]));
}

export async function addUndone(daysHandedOver: string[]): Promise<void> {
  if (!daysHandedOver.length) return;
  const days = await undoneDays();
  for (const d of daysHandedOver) days[d] = (days[d] ?? 0) + 1;
  const oldest = utcDay(new Date(Date.now() - 40 * DAY));
  for (const d of Object.keys(days)) if (d < oldest) delete days[d];
  const { error } = await createAdminClient()
    .from("email_settings")
    .upsert({ key: UNDONE, value: { days }, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error("Couldn't save the emails called back.");
}

// List emails handed to Resend today (UTC) and this month (UTC), counting
// ones handed over earlier to go out today, and ones Undo called back.
export async function listUsage(now = new Date()): Promise<{ today: number; month: number }> {
  const admin = createAdminClient();
  const start = new Date(`${utcDay(now)}T00:00:00Z`);
  const end = new Date(start.getTime() + DAY);
  const month = new Date(`${utcDay(now).slice(0, 8)}01T00:00:00Z`);
  const handed = ["submitted", "scheduled", "delivered", "bounced", "complained"];
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count: c, error } = await q;
    if (error) throw new Error("Couldn't count today's email.");
    return c ?? 0;
  };
  const [today, earlier, thisMonth, undone] = await Promise.all([
    count(admin.from("email_sends").select("id", { count: "exact", head: true }).in("status", handed).gte("submitted_at", start.toISOString()).lt("submitted_at", end.toISOString())),
    count(admin.from("email_sends").select("id", { count: "exact", head: true }).in("status", handed).lt("submitted_at", start.toISOString()).gte("deliver_at", start.toISOString()).lt("deliver_at", end.toISOString())),
    count(admin.from("email_sends").select("id", { count: "exact", head: true }).in("status", handed).gte("submitted_at", month.toISOString())),
    undoneDays(),
  ]);
  const day = utcDay(now);
  const undoneMonth = Object.entries(undone)
    .filter(([d]) => d.slice(0, 7) === day.slice(0, 7) && d <= day)
    .reduce((a, [, n]) => a + n, 0);
  return { today: today + earlier + (undone[day] ?? 0), month: thisMonth + undoneMonth };
}

// How many more list emails can go today in a wave.
export async function roomToday(now = new Date(), plan?: SendPlan): Promise<number> {
  const p = plan ?? (await getSendPlan());
  const used = await listUsage(now);
  return Math.max(0, Math.min(perDay(p) - used.today, p.cap - used.today, perMonth(p) - used.month));
}

// How many more can go today all at once ("Send to everyone now"): the
// day's cap and the month's limit, not the wave size.
export const everyoneLeft = (p: SendPlan, used: { today: number; month: number }) => Math.max(0, Math.min(p.cap - used.today, perMonth(p) - used.month));
export async function roomForEveryone(now = new Date(), plan?: SendPlan): Promise<number> {
  const p = plan ?? (await getSendPlan());
  return everyoneLeft(p, await listUsage(now));
}

// Whether a wave can still go out today: the send window (9 AM to 7 PM
// Central, Monday to Saturday) is open, or opens later today (UTC), so the
// wave is counted on the same Resend day it's sent.
export function waveCanGoToday(now = new Date()): boolean {
  return inSendWindow(now) || utcDay(nextSendSlot(now)) === utcDay(now);
}

// When the next wave can go, for the screen ("Mon Oct 5").
export function nextWaveDay(now = new Date()): Date {
  return waveCanGoToday(now) ? nextSendSlot(now) : nextSendSlot(new Date(Date.parse(`${utcDay(new Date(now.getTime() + DAY))}T13:00:00Z`)));
}

// When an email that's going out sends its next wave: the next morning
// run (the email cron, 13:00 UTC) on a Monday to Saturday, today's if it
// hasn't run yet and today's share isn't used up. That wave goes at its
// send slot (10:30 AM Central).
export function nextMorningWave(now = new Date(), roomLeftToday = true): Date {
  let run = new Date(`${utcDay(now)}T13:00:00Z`);
  if (run.getTime() <= now.getTime() || !roomLeftToday) run = new Date(run.getTime() + DAY);
  for (let i = 0; i < 3 && !waveCanGoToday(run); i++) run = new Date(run.getTime() + DAY);
  return nextSendSlot(run);
}

// Whether the ready-made emails' later waves go out by themselves on the
// morning run ("auto"), or only when staff press "Send the next wave" on
// Ready to send ("manual", the default: Andrew, 10/2, so each wave can be
// judged before the next). Either way, never more than a day's share.
export type WaveMode = "manual" | "auto";
const MODE_KEY = "design_waves";

export async function getWaveMode(): Promise<WaveMode> {
  try {
    const { data } = await createAdminClient().from("email_settings").select("value").eq("key", MODE_KEY).maybeSingle();
    return (data?.value as { auto?: unknown } | undefined)?.auto === true ? "auto" : "manual";
  } catch {
    return "manual";
  }
}

export async function saveWaveMode(mode: WaveMode, employeeId: string | null): Promise<void> {
  const { error } = await createAdminClient()
    .from("email_settings")
    .upsert({ key: MODE_KEY, value: { auto: mode === "auto" }, updated_at: new Date().toISOString(), ...(employeeId ? { updated_by: employeeId } : {}) }, { onConflict: "key" });
  if (error) throw new Error("Couldn't save it.");
}

// The first wave of each ready-made email (and of each Send again) goes to
// only this many, the most engaged, so a small wave can be judged before a
// full one (Andrew, 10/3). Waves after it are the wave size; the first is
// never bigger than that either.
export const FIRST_WAVE = 25;
export const firstWaveSize = (p: SendPlan) => Math.min(FIRST_WAVE, perDay(p));

// Wave size is the plan's list share a day: setting it keeps what's held
// back for receipts and makes Resend's daily figure the two added up.
export async function saveWaveSize(size: number, employeeId: string | null): Promise<SendPlan> {
  const n = Math.floor(Number(size));
  if (!Number.isFinite(n) || n < 1 || n > 100_000) throw new Error("A wave is 1 to 100,000 people.");
  const plan = await getSendPlan();
  return saveSendPlan({ ...plan, daily: plan.reserve + n }, employeeId);
}

// About how many sending days (Monday to Saturday) `n` people take, with
// `today` left today, one wave a day, the first no bigger than `first`
// (FIRST_WAVE for a Send that starts afresh). Ignores the month's limit
// (the screen says so when that's the one that bites).
export function sendingDays(n: number, daily: number, today: number, first = daily): number {
  if (n <= 0) return 0;
  if (daily <= 0) return Infinity;
  // The first wave goes today if there's room, otherwise on the next day.
  const day1 = Math.min(n, Math.max(1, first), today > 0 ? today : daily);
  return 1 + Math.ceil((n - day1) / daily);
}

// The date the last wave would go, counting Sundays off. `start`: when the
// first of them can go, if not today or the next day a wave can (a wave
// already went today: one a day).
export function finishDate(days: number, now = new Date(), firstToday = true, start?: Date): Date {
  let d = start ?? (firstToday ? nextSendSlot(now) : nextWaveDay(now));
  for (let i = 1; i < days; i++) d = nextSendSlot(new Date(Date.parse(`${utcDay(new Date(d.getTime() + DAY))}T13:00:00Z`)));
  return d;
}
