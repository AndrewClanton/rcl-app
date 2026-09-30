"use server";

import { revalidatePath } from "next/cache";
import { assertManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/data/reports";
import { businessDay, businessDayWindow } from "@/lib/ops/time";
import { isSharedLogin, isTipMethod, type TipMethod } from "@/lib/tip-split";

// Reports -> Day -> Tips -> "Record tip payout": saves how a day's tips were
// split, one row per person (tip_payouts, migration 20260930041500).
// Managers and up. Recording a day again replaces it. Not logged to
// ops_changes: that log's entities are the register's shift tools, and a
// payout isn't one of them (the rows keep who recorded them, and when).

export type TipPayoutResult = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSING = "Tip payouts need a database update first (migration 20260930041500_tip_payouts.sql). Nothing was saved.";

function isMissingTable(e: { code?: string; message?: string } | null) {
  return !!e && (e.code === "42P01" || e.code === "PGRST205" || /tip_payouts/.test(e.message ?? ""));
}

function checkDate(date: unknown): date is string {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= businessDay().date;
}

export async function recordTipPayout(input: { date: string; method: TipMethod; rows: { employeeId: string; amount: number }[]; note?: string }): Promise<TipPayoutResult> {
  const staff = await assertManager();
  const { date, method } = input ?? {};
  if (!checkDate(date)) return { ok: false, error: "That isn't a day that has happened yet." };
  if (!isTipMethod(method)) return { ok: false, error: "Pick how to split the tips." };
  const rows = (Array.isArray(input.rows) ? input.rows : [])
    .map((r) => ({ employeeId: String(r?.employeeId ?? ""), amount: Math.round(Number(r?.amount) * 100) / 100 }))
    .filter((r) => r.amount > 0);
  if (rows.length === 0) return { ok: false, error: "Nobody is getting anything. Tick who's in the split first." };
  if (rows.length > 50 || rows.some((r) => !UUID.test(r.employeeId) || !Number.isFinite(r.amount) || r.amount > 10_000)) return { ok: false, error: "Those amounts don't look right. Reload and try again." };
  if (new Set(rows.map((r) => r.employeeId)).size !== rows.length) return { ok: false, error: "Someone is in the list twice. Reload and try again." };
  const note = String(input.note ?? "").trim().slice(0, 500) || null;

  const supabase = createAdminClient();
  const { start, end } = businessDayWindow(date);
  const [people, tips] = await Promise.all([
    supabase.from("employees").select("id, name, role").in("id", rows.map((r) => r.employeeId)),
    // The day's tips, the way the Day report counts them: finished orders.
    fetchAll<{ tip: number }>((a, b) => supabase.from("orders").select("tip").eq("status", "completed").gte("completed_at", start).lt("completed_at", end).order("id").range(a, b)),
  ]);
  if (people.error) throw people.error;
  if ((people.data ?? []).length !== rows.length) return { ok: false, error: "Someone in the split isn't on the staff list. Reload and try again." };
  const shared = (people.data ?? []).find((p) => isSharedLogin(p));
  if (shared) return { ok: false, error: `${shared.name} is a shared login, not a person, so it can't be paid tips.` };
  const dayTips = Math.round(tips.reduce((s, o) => s + Number(o.tip), 0) * 100);
  const paying = rows.reduce((s, r) => s + Math.round(r.amount * 100), 0);
  if (paying > dayTips) return { ok: false, error: `That's $${(paying / 100).toFixed(2)}, more than the day's $${(dayTips / 100).toFixed(2)} in tips. Reload: a sale may have been refunded.` };

  const recordedAt = new Date().toISOString();
  const { error } = await supabase.from("tip_payouts").upsert(
    rows.map((r) => ({ business_date: date, method, employee_id: r.employeeId, amount: r.amount, recorded_by: staff.employeeId, recorded_at: recordedAt, note })),
    { onConflict: "business_date,employee_id" },
  );
  if (error) {
    if (isMissingTable(error)) return { ok: false, error: MISSING };
    throw error;
  }
  // Anyone recorded earlier who isn't in this split any more.
  const { error: dropErr } = await supabase
    .from("tip_payouts")
    .delete()
    .eq("business_date", date)
    .not("employee_id", "in", `(${rows.map((r) => r.employeeId).join(",")})`);
  if (dropErr) return { ok: false, error: "Saved, but someone from the earlier payout is still listed. Record it again to tidy up." };

  revalidatePath("/admin/reports");
  revalidatePath("/admin/reports/week");
  return { ok: true };
}

// Takes a day's recorded payout off (recorded on the wrong day, say).
export async function clearTipPayout(date: string): Promise<TipPayoutResult> {
  await assertManager();
  if (!checkDate(date)) return { ok: false, error: "That isn't a day that has happened yet." };
  const { error } = await createAdminClient().from("tip_payouts").delete().eq("business_date", date);
  if (error) {
    if (isMissingTable(error)) return { ok: false, error: MISSING };
    throw error;
  }
  revalidatePath("/admin/reports");
  revalidatePath("/admin/reports/week");
  return { ok: true };
}
