import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDayWindow } from "@/lib/ops/time";
import { isTipMethod, type TipMethod } from "@/lib/tip-split";
import type { EmployeeRole } from "@/lib/types";
import { fetchAll, type DayReport } from "./reports";

// What the Day report's drill-downs need beyond the report itself: the
// day's shifts (Tips: who was on), who approved each refund, which showing
// each ticket was for, and the tip payout recorded for the day. The money
// comes from the report (getDayReport), so every drill-down adds up to the
// figure it opened from.

export interface DrillStaff {
  id: string;
  name: string;
  role: EmployeeRole;
  active: boolean;
}

export interface DrillShift {
  id: string;
  employeeId: string;
  startedAt: string;
  endedAt: string | null;
}

export interface DrillRefund {
  orderId: string;
  orderNumber: number;
  kind: "full" | "partial";
  amount: number;
  tax: number;
  card: number;
  cash: number;
  reason: string | null;
  approvedBy: string | null; // whose manager PIN (null: the shared PIN, or not recorded)
  refundedBy: string | null; // who was signed in (partial refunds only)
  at: string | null; // when it was refunded (partial refunds only; a full refund isn't timed)
  soldAt: string;
}

export interface DrillShowing {
  title: string;
  startsAt: string | null;
  room: string | null;
}

export interface TipPayout {
  method: TipMethod;
  rows: { employeeId: string; name: string; amount: number }[];
  total: number;
  note: string | null;
  recordedBy: string | null;
  recordedAt: string;
}

export interface DayDrillData {
  window: { start: string; end: string; now: string };
  staff: DrillStaff[];
  shifts: DrillShift[];
  refunds: DrillRefund[];
  showings: Record<string, DrillShowing>;
  payout: TipPayout | null;
  payoutsReady: boolean; // false until the tip_payouts migration is applied
}

function quiet(what: string, e: unknown) {
  console.warn(`day drill-down: ${what} not read:`, (e as PostgrestError)?.message ?? e);
}

export async function getDayDrill(r: DayReport, now = new Date()): Promise<DayDrillData> {
  const supabase = createAdminClient();
  const { start, end } = businessDayWindow(r.date);
  const refundedIds = r.orders.filter((o) => o.status === "refunded").map((o) => o.id);
  const partIds = r.orders.filter((o) => o.refunded > 0).map((o) => o.id);
  const screeningIds = [...new Set(r.ticketLines.map((t) => t.screeningId).filter((id): id is string => !!id))];

  const [staffRes, shiftsRes, fullRes, partRes, showRes, payouts] = await Promise.all([
    supabase.from("employees").select("id, name, role, active").order("name"),
    // Every shift that overlaps the day, including one still open from an
    // earlier day. (Quoted: the timestamps have dots and colons in them.)
    supabase.from("shifts").select("id, employee_id, started_at, ended_at").lt("started_at", end).or(`ended_at.is.null,ended_at.gt."${start}"`).order("started_at"),
    refundedIds.length ? supabase.from("orders").select("id, refund_approved_by").in("id", refundedIds) : Promise.resolve({ data: [], error: null }),
    partIds.length
      ? supabase.from("order_partial_refunds").select("order_id, amount, tax_amount, card_amount, cash_amount, reason, approved_by, refunded_by, created_at").in("order_id", partIds).order("created_at")
      : Promise.resolve({ data: [], error: null }),
    screeningIds.length ? supabase.from("screenings").select("id, starts_at, movie:movies(title), room:rooms(name)").in("id", screeningIds) : Promise.resolve({ data: [], error: null }),
    getTipPayouts(r.date, r.date),
  ]);
  if (staffRes.error) throw staffRes.error;
  if (shiftsRes.error) quiet("shifts", shiftsRes.error);
  if (fullRes.error) quiet("refund approvers", fullRes.error);
  if (partRes.error) quiet("partial refunds", partRes.error);
  if (showRes.error) quiet("showings", showRes.error);

  const staff = (staffRes.data ?? []) as DrillStaff[];
  const nameOf = new Map(staff.map((s) => [s.id, s.name]));
  const orderById = new Map(r.orders.map((o) => [o.id, o]));

  const refunds: DrillRefund[] = [];
  const approverByOrder = new Map(((fullRes.data ?? []) as { id: string; refund_approved_by: string | null }[]).map((o) => [o.id, o.refund_approved_by]));
  for (const o of r.orders) {
    if (o.status !== "refunded") continue;
    const by = approverByOrder.get(o.id);
    refunds.push({ orderId: o.id, orderNumber: o.orderNumber, kind: "full", amount: o.total, tax: o.tax, card: o.card, cash: o.cash, reason: null, approvedBy: by ? (nameOf.get(by) ?? null) : null, refundedBy: null, at: null, soldAt: o.at });
  }
  type PartRow = { order_id: string; amount: number; tax_amount: number; card_amount: number; cash_amount: number; reason: string | null; approved_by: string | null; refunded_by: string | null; created_at: string };
  for (const p of (partRes.data ?? []) as PartRow[]) {
    const o = orderById.get(p.order_id);
    if (!o || o.status !== "completed") continue; // the report only counts partial refunds on completed orders
    refunds.push({
      orderId: o.id,
      orderNumber: o.orderNumber,
      kind: "partial",
      amount: Number(p.amount),
      tax: Number(p.tax_amount),
      card: Number(p.card_amount),
      cash: Number(p.cash_amount),
      reason: p.reason,
      approvedBy: p.approved_by ? (nameOf.get(p.approved_by) ?? null) : null,
      refundedBy: p.refunded_by ? (nameOf.get(p.refunded_by) ?? null) : null,
      at: p.created_at,
      soldAt: o.at,
    });
  }

  type ShowRow = { id: string; starts_at: string | null; movie: { title: string } | null; room: { name: string } | null };
  const showings: Record<string, DrillShowing> = {};
  for (const s of (showRes.data ?? []) as unknown as ShowRow[]) {
    showings[s.id] = { title: s.movie?.title ?? "Untitled", startsAt: s.starts_at, room: s.room?.name ? s.room.name.split(" — ")[0] : null };
  }

  return {
    window: { start, end, now: now.toISOString() },
    staff,
    shifts: ((shiftsRes.data ?? []) as { id: string; employee_id: string; started_at: string; ended_at: string | null }[]).map((s) => ({ id: s.id, employeeId: s.employee_id, startedAt: s.started_at, endedAt: s.ended_at })),
    refunds,
    showings,
    payout: payouts.ready ? (payouts.days.get(r.date) ?? null) : null,
    payoutsReady: payouts.ready,
  };
}

// ---------- tip payouts ----------

// Recorded payouts for the business days from..to, by day. `ready` is false
// (and nothing is recorded) until the tip_payouts migration is applied.
export async function getTipPayouts(from: string, to: string): Promise<{ ready: boolean; days: Map<string, TipPayout> }> {
  const supabase = createAdminClient();
  type Row = { business_date: string; method: string; employee_id: string; amount: number; recorded_by: string | null; recorded_at: string; note: string | null; employee: { name: string } | null; recorder: { name: string } | null };
  let rows: Row[];
  try {
    rows = await fetchAll<Row>((a, b) =>
      supabase
        .from("tip_payouts")
        .select("business_date, method, employee_id, amount, recorded_by, recorded_at, note, employee:employees!tip_payouts_employee_id_fkey(name), recorder:employees!tip_payouts_recorded_by_fkey(name)")
        .gte("business_date", from)
        .lte("business_date", to)
        .order("id")
        .range(a, b),
    );
  } catch (e) {
    quiet("tip_payouts (migration 20260930041500_tip_payouts.sql applied?)", e);
    return { ready: false, days: new Map() };
  }
  const days = new Map<string, TipPayout>();
  for (const row of rows) {
    let d = days.get(row.business_date);
    if (!d) {
      d = { method: isTipMethod(row.method) ? row.method : "even", rows: [], total: 0, note: row.note, recordedBy: row.recorder?.name ?? null, recordedAt: row.recorded_at };
      days.set(row.business_date, d);
    }
    d.rows.push({ employeeId: row.employee_id, name: row.employee?.name ?? "Someone", amount: Number(row.amount) });
    d.total = Math.round((d.total + Number(row.amount)) * 100) / 100;
    // The latest recording speaks for the day.
    if (row.recorded_at > d.recordedAt) {
      d.recordedAt = row.recorded_at;
      d.recordedBy = row.recorder?.name ?? null;
      d.note = row.note;
    }
  }
  for (const d of days.values()) d.rows.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
  return { ready: true, days };
}

// Reports -> Week, "Tips this week": the recorded payouts added up per
// person, and the days that had tips but nothing recorded yet.
export interface TipWeek {
  ready: boolean;
  people: { employeeId: string; name: string; amount: number; days: number }[];
  paid: number;
  tips: number; // all the week's tips (the Day report's figure, day by day)
  unrecorded: { date: string; tips: number }[];
}

export function tipWeek(days: { date: string; tips: number }[], payouts: { ready: boolean; days: Map<string, TipPayout> }): TipWeek {
  const people = new Map<string, TipWeek["people"][number]>();
  let paid = 0;
  for (const d of days) {
    const p = payouts.days.get(d.date);
    if (!p) continue;
    for (const row of p.rows) {
      const e = people.get(row.employeeId) ?? { employeeId: row.employeeId, name: row.name, amount: 0, days: 0 };
      e.amount = Math.round((e.amount + row.amount) * 100) / 100;
      e.days++;
      people.set(row.employeeId, e);
    }
    paid += p.total;
  }
  return {
    ready: payouts.ready,
    people: [...people.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)),
    paid: Math.round(paid * 100) / 100,
    tips: Math.round(days.reduce((s, d) => s + d.tips, 0) * 100) / 100,
    unrecorded: days.filter((d) => d.tips > 0 && !payouts.days.has(d.date)),
  };
}
