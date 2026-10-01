import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay } from "@/lib/ops/time";
import type { DailyCoffeeState } from "@/lib/daily-perk";

// Reading a member's Insiders+ daily coffee (lib/daily-perk.ts): the
// completed order that used it on a business day, if any. A refunded or
// voided order doesn't count, so its day's coffee is free again.

export interface DailyCoffeeUse {
  usedAt: string;
  orderNumber: number;
}

// Today's business date ("YYYY-MM-DD"), the day a coffee rung now counts for.
export function coffeeDay(now = new Date()) {
  return businessDay(now).date;
}

// null: not used that day. undefined: couldn't be read (a database hiccup,
// or migration 20261001220000_plus_daily_coffee.sql isn't applied yet).
export async function dailyCoffeeUse(memberId: string, date = coffeeDay()): Promise<DailyCoffeeUse | null | undefined> {
  const { data, error } = await createAdminClient()
    .from("orders")
    .select("order_number, completed_at, created_at")
    .eq("member_id", memberId)
    .eq("daily_perk_date", date)
    .eq("status", "completed")
    .order("completed_at", { ascending: true })
    .limit(1);
  if (error) return undefined;
  const row = data?.[0] as { order_number: number; completed_at: string | null; created_at: string } | undefined;
  return row ? { usedAt: row.completed_at ?? row.created_at, orderNumber: Number(row.order_number) } : null;
}

// The member's coffee today, as the register and the account page show it.
// null when it couldn't be read.
export async function dailyCoffeeToday(memberId: string): Promise<DailyCoffeeState | null> {
  const use = await dailyCoffeeUse(memberId);
  if (use === undefined) return null;
  return { usedAt: use?.usedAt ?? null, orderNumber: use?.orderNumber ?? null };
}
