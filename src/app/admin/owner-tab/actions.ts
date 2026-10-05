"use server";

import { revalidatePath } from "next/cache";
import { assertOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay } from "@/lib/ops/time";
import { OWNER_PAYMENT_METHODS, monthLabel } from "@/lib/data/owner-tab";
import { cents } from "@/lib/register-totals";
import { schemaMissing } from "@/lib/schema-missing";

// Back office -> Owner tab, for the owners: who gets the owner rate, and
// recording what an owner paid against a month's statement.

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function revalidate() {
  revalidatePath("/admin/owner-tab");
  revalidatePath("/admin");
  revalidatePath("/pos");
}

// Who gets the owner rate: a tick on the person (employees.owner_rate),
// not a role. Any active staff login can be ticked (never a TV login).
// Every change is kept (owner_rate_changes): who, when, on or off.
export async function setOwnerRate(employeeId: string, on: boolean): Promise<Result<{ message: string }>> {
  const staff = await assertOwner();
  if (typeof employeeId !== "string" || !UUID.test(employeeId)) return { ok: false, error: "Reload the page and try again." };
  const db = createAdminClient();
  const { data: before } = await db.from("employees").select("owner_rate").eq("id", employeeId).maybeSingle();
  const { data, error } = await db
    .from("employees")
    .update({ owner_rate: on === true })
    .eq("id", employeeId)
    .eq("active", true)
    .neq("role", "display")
    .select("name");
  if (error) return { ok: false, error: error.code === "42703" || error.code === "PGRST204" ? "The database update for the owner tab hasn't been applied yet." : "Couldn't save that. Try again." };
  if (!data?.length) return { ok: false, error: "Only an active staff login can get the owner rate." };
  if (!!before?.owner_rate !== (on === true)) {
    const { error: logError } = await db.from("owner_rate_changes").insert({ employee_id: employeeId, turned_on: on === true, changed_by: staff.employeeId });
    if (logError) console.error("owner rate change not logged", logError.message);
  }
  revalidate();
  const name = firstName(String(data[0].name ?? "They"));
  return { ok: true, message: on ? `${name} gets the owner rate now.` : `${name} doesn't get the owner rate anymore. Their tab stays here until it's paid.` };
}

export interface PaymentInput {
  ownerId: string;
  month: string; // "2026-10"
  amount: number;
  method: string;
  paidOn: string; // "2026-11-02"
  note: string;
}

// A payment against one owner's month. Part payments add up; more than
// what's left on the month is turned down (a typo, most likely). The
// database function checks what's left and records it in one step, with
// the owner's row locked, so two people recording at once can't overpay.
export async function recordOwnerPayment(input: PaymentInput): Promise<Result<{ message: string }>> {
  const staff = await assertOwner();
  const ownerId = String(input?.ownerId ?? "");
  const month = String(input?.month ?? "");
  const method = String(input?.method ?? "");
  const paidOn = String(input?.paidOn ?? "");
  const note = String(input?.note ?? "").trim().slice(0, 300) || null;
  const amount = Math.round(Number(input?.amount) * 100) / 100;
  const today = businessDay().date;

  if (!UUID.test(ownerId)) return { ok: false, error: "Pick whose tab it's for." };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > today.slice(0, 7)) return { ok: false, error: "Pick the month it pays." };
  if (!(amount > 0) || amount > 100_000) return { ok: false, error: "Enter how much they paid, like 42.50." };
  if (!(OWNER_PAYMENT_METHODS as readonly string[]).includes(method)) return { ok: false, error: "Pick how they paid: card, cash, check or transfer." };
  const d = new Date(`${paidOn}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== paidOn || paidOn > today) {
    return { ok: false, error: "Enter the date it was paid (not a future date)." };
  }

  const db = createAdminClient();
  const { data: owner } = await db.from("employees").select("name").eq("id", ownerId).maybeSingle();
  if (!owner) return { ok: false, error: "That person isn't on the staff list." };
  const { data, error } = await db.rpc("record_owner_tab_payment", {
    p_owner: ownerId,
    p_month: month,
    p_amount: amount,
    p_method: method,
    p_paid_on: paidOn,
    p_note: note,
    p_by: staff.employeeId,
  });
  if (error) {
    // No function yet (PGRST202, 42883): the migration isn't in.
    if (schemaMissing(error) || error.code === "PGRST202" || error.code === "42883") return { ok: false, error: "The owner tab needs its database update first (20261003060000_owner_tab.sql)." };
    console.error("owner tab payment not saved", error.message);
    return { ok: false, error: "Couldn't save the payment. Nothing was recorded. Try again." };
  }
  const r = (data ?? {}) as { id?: string | null; paid?: number; balance?: number };
  const balance = cents(Number(r.balance ?? 0));
  if (!r.id) {
    if (balance <= 0.005) return { ok: false, error: `Nothing is owed on ${monthLabel(month)}${Number(r.paid ?? 0) > 0 ? ": it's paid" : ""}. Nothing was recorded.` };
    return { ok: false, error: `That's more than the ${money(balance)} left on ${monthLabel(month)}. Nothing was recorded.` };
  }
  revalidate();
  revalidatePath("/admin/reports");
  const rest = balance;
  const who = firstName(String(owner.name ?? ""));
  return {
    ok: true,
    message: rest > 0.005 ? `Recorded ${money(amount)} from ${who} for ${monthLabel(month)}. ${money(rest)} is still owed.` : `Recorded ${money(amount)} from ${who}. ${monthLabel(month)} is settled.`,
  };
}
