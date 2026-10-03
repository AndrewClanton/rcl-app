import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOftenOut } from "@/lib/ops/outages";
import { alertRecipients, getAlertRecipientIds, weekStartDate } from "@/lib/ops/ran-out-alert";
import { businessDayWindow } from "@/lib/ops/time";
import { qtyUnit, type OftenOut } from "@/lib/ops/shared";

// Back office → Ran out: what's out now (marked back in stock here, by the
// people who buy), what ran out this week so repeat offenders stand out, and
// who gets the ran-out email. Today shows the week's count.

const db = () => createAdminClient();
const firstName = (name: string) => name.trim().split(/\s+/)[0];

export interface OpenRanOut {
  id: string;
  name: string;
  area: string | null;
  source: string | null;
  par: string | null; // "1 quart"; null with no par or off the sheet
  onSheet: boolean;
  note: string | null;
  reportedAt: string;
  byName: string | null;
  stopped: string[];
  emailed: string[];
}

export interface WeekLine {
  key: string;
  name: string;
  times: number; // this week, false alarms left out
  lastAt: string;
  stillOut: boolean;
  par: string | null;
}

export interface RanOutWeek {
  start: string; // YYYY-MM-DD, the Monday
  reports: number;
  lines: WeekLine[]; // most times first
}

// Everything reported out since Monday, false alarms left out, by par line
// (or the words typed, for something off the sheet).
export async function getRanOutWeek(now = new Date()): Promise<RanOutWeek> {
  const start = weekStartDate(now);
  const { data, error } = await db()
    .from("stock_outages")
    .select("id, par_item_id, label, reported_at, resolved_at, resolution, item:par_items(name, par_qty, unit)")
    .gte("reported_at", businessDayWindow(start).start)
    .or("resolution.is.null,resolution.neq.mistake")
    .order("reported_at");
  if (error) throw new Error(error.message);
  type Row = { par_item_id: string | null; label: string; reported_at: string; resolved_at: string | null; item: { name: string; par_qty: number | string | null; unit: string | null } | null };
  const by = new Map<string, WeekLine>();
  for (const r of (data ?? []) as unknown as Row[]) {
    const key = r.par_item_id ?? `typed:${r.label.trim().toLowerCase()}`;
    const had = by.get(key);
    if (had) {
      had.times++;
      had.lastAt = r.reported_at;
      had.stillOut = had.stillOut || !r.resolved_at;
      continue;
    }
    by.set(key, {
      key,
      name: r.item?.name ?? r.label,
      times: 1,
      lastAt: r.reported_at,
      stillOut: !r.resolved_at,
      par: r.item && r.item.par_qty !== null ? qtyUnit(Number(r.item.par_qty), r.item.unit) : null,
    });
  }
  const lines = [...by.values()].sort((a, b) => b.times - a.times || Date.parse(b.lastAt) - Date.parse(a.lastAt));
  return { start, reports: (data ?? []).length, lines };
}

export async function getOpenRanOuts(): Promise<OpenRanOut[]> {
  const supabase = db();
  const { data, error } = await supabase
    .from("stock_outages")
    .select("id, par_item_id, label, note, reported_at, reported_by, alert_sent_to, item:par_items(name, area, par_qty, unit, unit_size, source)")
    .is("resolved_at", null)
    .order("reported_at");
  if (error) throw new Error(error.message);
  type Row = {
    id: string;
    par_item_id: string | null;
    label: string;
    note: string | null;
    reported_at: string;
    reported_by: string | null;
    alert_sent_to: string[] | null;
    item: { name: string; area: string; par_qty: number | string | null; unit: string | null; unit_size: string | null; source: string | null } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) return [];
  const [{ data: people }, { data: items }] = await Promise.all([
    supabase.from("employees").select("id, name"),
    supabase.from("menu_items").select("name, out_outage_id").in("out_outage_id", rows.map((r) => r.id)).order("sort_order"),
  ]);
  const names = new Map((people ?? []).map((p) => [p.id as string, firstName(p.name as string)]));
  const stopped = new Map<string, string[]>();
  for (const i of items ?? []) stopped.set(i.out_outage_id as string, [...(stopped.get(i.out_outage_id as string) ?? []), i.name as string]);
  return rows.map((r) => ({
    id: r.id,
    name: r.item?.name ?? r.label,
    area: r.item?.area ?? null,
    source: r.item?.source?.trim() || null,
    par: r.item && r.item.par_qty !== null ? `${qtyUnit(Number(r.item.par_qty), r.item.unit)}${r.item.unit_size ? ` (${r.item.unit_size})` : ""}` : null,
    onSheet: !!r.item,
    note: r.note,
    reportedAt: r.reported_at,
    byName: r.reported_by ? (names.get(r.reported_by) ?? null) : null,
    stopped: stopped.get(r.id) ?? [],
    emailed: (r.alert_sent_to ?? []).map((id) => names.get(id)).filter((n): n is string => !!n),
  }));
}

export interface AlertSetting {
  ids: string[];
  staff: { id: string; name: string; role: string; hasEmail: boolean }[]; // everyone who could be picked
}

export async function getAlertSetting(): Promise<AlertSetting> {
  const [ids, { data, error }] = await Promise.all([getAlertRecipientIds(), db().from("employees").select("id, name, role").eq("active", true).neq("role", "display").order("name")]);
  if (error) throw new Error(error.message);
  const withEmail = await alertRecipients((data ?? []).map((e) => e.id as string));
  const hasEmail = new Set(withEmail.filter((p) => p.email).map((p) => p.id));
  return {
    ids,
    staff: (data ?? []).map((e) => ({ id: e.id as string, name: (e.name as string).trim(), role: e.role as string, hasEmail: hasEmail.has(e.id as string) })),
  };
}

export interface RanOutBoard {
  open: OpenRanOut[];
  week: RanOutWeek;
  oftenOut: OftenOut[];
  alerts: AlertSetting;
}

export async function getRanOutBoard(): Promise<RanOutBoard> {
  const [open, week, oftenOut, alerts] = await Promise.all([getOpenRanOuts(), getRanOutWeek(), getOftenOut(), getAlertSetting()]);
  return { open, week, oftenOut, alerts };
}
