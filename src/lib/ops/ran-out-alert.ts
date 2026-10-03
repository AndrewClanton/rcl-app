import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import { SITE_URL } from "@/lib/site";
import { ranOutHtml, ranOutSubject, ranOutText, type RanOutEmailData } from "@/lib/email/ran-out-email";
import { timesOut } from "./outages";
import { businessDay, businessDayWindow, shiftDate } from "./time";
import { qtyUnit, ranOutSuggestion } from "./shared";

// "Ran out" emails the people who buy for the week, the moment it's
// reported, so the cashier on shift isn't the one told to go buy it. Who
// gets it is the 'ran_out_alert_to' setting (Back office → Ran out), never a
// name in the code. Transactional mail (sendEmail), so it doesn't wait on
// the list-email Sending switch. One email per report: the report is claimed
// before sending, so a second tap, the same line reported again, or two
// registers at once never send it twice. Not server actions: callers check
// who's asking first.

export const ALERT_SETTING = "ran_out_alert_to";

const db = () => createAdminClient();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TZ = { timeZone: "America/Chicago" } as const;
const likeText = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const firstName = (name: string) => name.trim().split(/\s+/)[0];

// ---------- who gets it ----------

// The staff picked to get ran-out emails, in the order they were picked.
export async function getAlertRecipientIds(): Promise<string[]> {
  const { data, error } = await db().from("settings").select("value").eq("key", ALERT_SETTING).maybeSingle();
  if (error) throw new Error(`Couldn't read who gets ran-out emails: ${error.message}`);
  const v = data?.value as unknown;
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string" && UUID.test(x)).map((x) => x.toLowerCase()))];
}

export async function saveAlertRecipientIds(ids: string[], by: string | null): Promise<void> {
  const { error } = await db()
    .from("settings")
    .upsert({ key: ALERT_SETTING, value: ids, updated_at: new Date().toISOString(), updated_by: by }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export interface AlertRecipient {
  id: string;
  name: string;
  firstName: string;
  email: string | null; // the email they sign in with; null: no login, so no email
}

// The picked staff who are still active, with the email they sign in with.
export async function alertRecipients(ids?: string[]): Promise<AlertRecipient[]> {
  const want = ids ?? (await getAlertRecipientIds());
  if (!want.length) return [];
  const supabase = db();
  const { data, error } = await supabase.from("employees").select("id, name, auth_user_id").in("id", want).eq("active", true).neq("role", "display");
  if (error) throw new Error(error.message);
  const people = await Promise.all(
    (data ?? []).map(async (e) => {
      const email = e.auth_user_id
        ? await supabase.auth.admin
            .getUserById(e.auth_user_id as string)
            .then((r) => r.data.user?.email ?? null)
            .catch(() => null)
        : null;
      return { id: e.id as string, name: (e.name as string).trim(), firstName: firstName(e.name as string), email };
    }),
  );
  return people.sort((a, b) => want.indexOf(a.id) - want.indexOf(b.id));
}

// ---------- "this week" ----------

// The shopping week starts Monday (business days run 4 a.m. to 4 a.m.).
export function weekStartDate(now = new Date()): string {
  const { date } = businessDay(now);
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return shiftDate(date, -((dow + 6) % 7));
}

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { ...TZ, weekday: "short" })} ${d.toLocaleDateString("en-US", { ...TZ, month: "short", day: "numeric" })}`;
};

// This week's par counts for a line ("Mon Sep 28: 2 quarts", the day's last
// count), and what they say was bought: a count that went up since the one
// before ("Tue Sep 29: +2 quarts"), plus earlier Ran out reports this week
// closed as bought.
async function weekOnSheet(parItemId: string, unit: string | null, reportedAt: string): Promise<{ counts: string[]; bought: string[] }> {
  const supabase = db();
  const weekStart = businessDayWindow(weekStartDate(new Date(reportedAt))).start;
  const lookBack = new Date(Date.parse(weekStart) - 14 * 86_400_000).toISOString();
  const [{ data: lines }, { data: boughtBefore }] = await Promise.all([
    supabase.from("par_count_lines").select("qty, pc:par_counts!inner(completed_at)").eq("item_id", parItemId).gte("pc.completed_at", lookBack).lte("pc.completed_at", reportedAt),
    supabase.from("stock_outages").select("resolved_at").eq("par_item_id", parItemId).eq("resolution", "bought").gte("resolved_at", weekStart).lte("resolved_at", reportedAt).order("resolved_at"),
  ]);
  type Line = { qty: number | string; pc: { completed_at: string } | null };
  const sorted = ((lines ?? []) as unknown as Line[])
    .filter((l) => l.pc)
    .map((l) => ({ qty: Number(l.qty), at: l.pc!.completed_at }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  // One per business day: the day's last count.
  const byDay = new Map<string, { qty: number; at: string }>();
  for (const l of sorted) byDay.set(businessDay(new Date(l.at)).date, l);
  const days = [...byDay.values()];
  const counts: string[] = [];
  const bought: string[] = [];
  let before: number | null = null;
  for (const d of days) {
    const inWeek = Date.parse(d.at) >= Date.parse(weekStart);
    if (inWeek) {
      counts.push(`${dayLabel(d.at)}: ${qtyUnit(d.qty, unit)}`);
      if (before !== null && d.qty > before) bought.push(`${dayLabel(d.at)}: +${qtyUnit(Math.round((d.qty - before) * 100) / 100, unit)} (the count went up)`);
    }
    before = d.qty;
  }
  for (const b of boughtBefore ?? []) bought.push(`${dayLabel(b.resolved_at as string)}: bought after it ran out`);
  return { counts, bought };
}

// ---------- the email ----------

export async function ranOutEmailData(outageId: string): Promise<RanOutEmailData | null> {
  const supabase = db();
  const { data: o } = await supabase
    .from("stock_outages")
    .select("id, par_item_id, label, note, reported_at, reported_by, stopped_item_ids, item:par_items(name, par_qty, unit, unit_size, source)")
    .eq("id", outageId)
    .maybeSingle();
  if (!o) return null;
  const item = o.item as unknown as { name: string; par_qty: number | string | null; unit: string | null; unit_size: string | null; source: string | null } | null;
  const reportedAt = o.reported_at as string;
  const parQty = item?.par_qty === null || item?.par_qty === undefined ? null : Number(item.par_qty);
  const stoppedIds = (o.stopped_item_ids as string[] | null) ?? [];
  const [reporter, stopped, times, week] = await Promise.all([
    o.reported_by ? supabase.from("employees").select("name").eq("id", o.reported_by).maybeSingle().then((r) => (r.data ? firstName(r.data.name as string) : null)) : null,
    stoppedIds.length ? supabase.from("menu_items").select("name").in("id", stoppedIds).order("sort_order").then((r) => (r.data ?? []).map((m) => m.name as string)) : [],
    timesOut({ parItemId: (o.par_item_id as string | null) ?? null, label: o.label as string, reportedAt }),
    item && o.par_item_id ? weekOnSheet(o.par_item_id as string, item.unit, reportedAt).catch(() => ({ counts: [], bought: [] })) : null,
  ]);
  const at = new Date(reportedAt);
  return {
    what: item?.name ?? (o.label as string),
    when: `${at.toLocaleTimeString("en-US", { ...TZ, hour: "numeric", minute: "2-digit" })} ${dayLabel(reportedAt)}`,
    byName: reporter,
    par: item && parQty !== null ? `${qtyUnit(parQty, item.unit)}${item.unit_size ? ` (${item.unit_size})` : ""}` : null,
    source: item?.source?.trim() || null,
    note: (o.note as string | null) || null,
    stopped,
    counts: week ? week.counts : null,
    bought: week ? week.bought : null,
    suggestion: ranOutSuggestion({ onSheet: !!item, parQty, unit: item?.unit ?? null, times }),
  };
}

export const backInStockUrl = (outageId: string) => `${SITE_URL}/admin/ran-out?id=${outageId}`;

export interface AlertResult {
  emailed: string[]; // first names it reached (this time or before)
  skipped?: "closed" | "already" | "duplicate" | "nobody" | "failed";
}

async function firstNamesOf(ids: string[] | null | undefined): Promise<string[]> {
  if (!ids?.length) return [];
  const { data } = await db().from("employees").select("id, name").in("id", ids);
  const by = new Map((data ?? []).map((e) => [e.id as string, firstName(e.name as string)]));
  return ids.map((id) => by.get(id)).filter((n): n is string => !!n);
}

// Emails a report to the picked staff, once. Never throws: the report is
// saved either way, and the register says if no email went out.
export async function sendRanOutAlert(outageId: string): Promise<AlertResult> {
  try {
    const supabase = db();
    const { data: o } = await supabase.from("stock_outages").select("id, par_item_id, label, resolved_at, alert_claimed_at, alert_sent_to").eq("id", outageId).maybeSingle();
    if (!o || o.resolved_at) return { emailed: [], skipped: "closed" };
    if (o.alert_claimed_at) return { emailed: await firstNamesOf(o.alert_sent_to as string[]), skipped: "already" };

    // Something off the par sheet typed in again while the first report is
    // still open: that report's email already covers it.
    if (!o.par_item_id) {
      const { data: twins } = await supabase
        .from("stock_outages")
        .select("id, alert_sent_to")
        .is("resolved_at", null)
        .is("par_item_id", null)
        .ilike("label", likeText(o.label as string))
        .neq("id", outageId)
        .not("alert_claimed_at", "is", null)
        .limit(1);
      const twin = twins?.[0];
      if (twin && ((twin.alert_sent_to as string[] | null) ?? []).length) {
        await supabase.from("stock_outages").update({ alert_claimed_at: new Date().toISOString(), alert_sent_to: twin.alert_sent_to }).eq("id", outageId).is("alert_claimed_at", null);
        return { emailed: await firstNamesOf(twin.alert_sent_to as string[]), skipped: "duplicate" };
      }
    }

    const { data: won } = await supabase.from("stock_outages").update({ alert_claimed_at: new Date().toISOString() }).eq("id", outageId).is("alert_claimed_at", null).select("id");
    if (!won?.length) {
      // Another register claimed it a moment ago.
      const { data: again } = await supabase.from("stock_outages").select("alert_sent_to").eq("id", outageId).maybeSingle();
      return { emailed: await firstNamesOf(again?.alert_sent_to as string[] | undefined), skipped: "already" };
    }
    const release = () => supabase.from("stock_outages").update({ alert_claimed_at: null }).eq("id", outageId);

    const [people, data] = await Promise.all([alertRecipients(), ranOutEmailData(outageId)]);
    const to = people.filter((p) => p.email);
    if (!to.length || !data) {
      await release();
      return { emailed: [], skipped: "nobody" };
    }
    const url = backInStockUrl(outageId);
    const subject = ranOutSubject(data);
    const html = ranOutHtml(data, url);
    const text = ranOutText(data, url);
    const results = await Promise.all(
      to.map(async (p) => ({ p, r: await sendEmail(p.email!, subject, html, { text, idempotencyKey: `ran-out-${outageId}-${p.id}` }) })),
    );
    for (const { p, r } of results) if (!r.ok) console.error(`ran out: email to ${p.name} failed`, r.error);
    const sent = results.filter((x) => x.r.ok).map((x) => x.p);
    if (!sent.length) {
      await release();
      return { emailed: [], skipped: "failed" };
    }
    await supabase.from("stock_outages").update({ alert_sent_to: sent.map((p) => p.id) }).eq("id", outageId);
    return { emailed: sent.map((p) => p.firstName) };
  } catch (e) {
    console.error("ran out: alert email failed", e);
    return { emailed: [], skipped: "failed" };
  }
}
