import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { inSendWindow, nextSendSlot } from "./timing";

// Resend's sending limits, and how much of today's is left for list email.
//
// The account is on Resend's free plan: 100 emails a day and 3,000 a month,
// for everything it sends (receipts, tickets, the daily report and these
// lists alike). Resend counts the day by the UTC calendar (it resets at
// midnight UTC). So a list that's bigger than a day's share goes out in
// daily waves: the morning email run (8 AM Central) sends the next wave,
// until everyone has it. Part of each day is kept back for the everyday
// mail, so a big send can never stop a receipt.
//
// The numbers live in email_settings ('resend_plan'), so when the plan is
// upgraded an admin changes them on Back office -> Email -> Ready to send.

export interface SendPlan {
  daily: number; // Resend's daily limit
  monthly: number; // Resend's monthly limit
  reserve: number; // kept back each day for receipts, tickets and the daily report
}

export const FREE_PLAN: SendPlan = { daily: 100, monthly: 3000, reserve: 20 };
const KEY = "resend_plan";

function clean(v: Partial<SendPlan> | null | undefined): SendPlan {
  const n = (x: unknown, d: number, max: number) => (Number.isFinite(Number(x)) && Number(x) >= 0 ? Math.min(max, Math.floor(Number(x))) : d);
  const daily = n(v?.daily, FREE_PLAN.daily, 1_000_000) || FREE_PLAN.daily;
  const monthly = n(v?.monthly, FREE_PLAN.monthly, 50_000_000) || FREE_PLAN.monthly;
  const reserve = Math.min(n(v?.reserve, FREE_PLAN.reserve, 1_000_000), Math.max(0, daily - 1));
  return { daily, monthly, reserve };
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

// List emails handed to Resend today (UTC) and this month (UTC), counting
// ones handed over earlier to go out today.
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
  const [today, earlier, thisMonth] = await Promise.all([
    count(admin.from("email_sends").select("id", { count: "exact", head: true }).in("status", handed).gte("submitted_at", start.toISOString()).lt("submitted_at", end.toISOString())),
    count(admin.from("email_sends").select("id", { count: "exact", head: true }).in("status", handed).lt("submitted_at", start.toISOString()).gte("deliver_at", start.toISOString()).lt("deliver_at", end.toISOString())),
    count(admin.from("email_sends").select("id", { count: "exact", head: true }).in("status", handed).gte("submitted_at", month.toISOString())),
  ]);
  return { today: today + earlier, month: thisMonth };
}

// How many more list emails can go today.
export async function roomToday(now = new Date(), plan?: SendPlan): Promise<number> {
  const p = plan ?? (await getSendPlan());
  const used = await listUsage(now);
  return Math.max(0, Math.min(perDay(p) - used.today, perMonth(p) - used.month));
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

// Wave size is the plan's list share a day: setting it keeps what's held
// back for receipts and makes Resend's daily figure the two added up.
export async function saveWaveSize(size: number, employeeId: string | null): Promise<SendPlan> {
  const n = Math.floor(Number(size));
  if (!Number.isFinite(n) || n < 1 || n > 100_000) throw new Error("A wave is 1 to 100,000 people.");
  const plan = await getSendPlan();
  return saveSendPlan({ ...plan, daily: plan.reserve + n }, employeeId);
}

// About how many sending days (Monday to Saturday) `n` people take, with
// `today` left today. Ignores the month's limit (the screen says so when
// that's the one that bites).
export function sendingDays(n: number, daily: number, today: number): number {
  if (n <= 0) return 0;
  if (daily <= 0) return Infinity;
  const first = Math.min(n, Math.max(0, today));
  return (first > 0 ? 1 : 0) + Math.ceil((n - first) / daily);
}

// The date the last wave would go, counting Sundays off.
export function finishDate(days: number, now = new Date(), firstToday = true): Date {
  let d = firstToday ? nextSendSlot(now) : nextWaveDay(now);
  for (let i = 1; i < days; i++) d = nextSendSlot(new Date(Date.parse(`${utcDay(new Date(d.getTime() + DAY))}T13:00:00Z`)));
  return d;
}
