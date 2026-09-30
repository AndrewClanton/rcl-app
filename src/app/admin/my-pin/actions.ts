"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertStaff, hasManagerAccess } from "@/lib/auth";
import { hashPin, isDefaultPin, verifyPin } from "@/lib/pin";
import { pinProblem } from "@/lib/pin-rules";
import { checkOwnPin, checkPinFree } from "@/lib/manager-pin";

// A signed-in staff member sets their own PIN. Their current PIN is asked
// for unless it's still 9999 (everyone knows that one, so asking proves
// nothing); a wrong one counts toward a per-person guess limit.
export async function setMyPin(input: { current: string; next: string; confirm: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const staff = await assertStaff();
  const problem = pinProblem(input.next);
  if (problem) return { ok: false, error: problem };
  if (input.next !== input.confirm) return { ok: false, error: "The two new PINs don't match. Type them again." };

  const supabase = createAdminClient();
  const { data: me, error } = await supabase.from("employees").select("pin_hash").eq("id", staff.employeeId).single();
  if (error || !me) return { ok: false, error: "Couldn't load your account. Try again." };

  if (!isDefaultPin(me.pin_hash)) {
    const check = await checkOwnPin(staff.employeeId, input.current, me.pin_hash);
    if (!check.ok) return check;
    if (verifyPin(input.next, me.pin_hash)) return { ok: false, error: "That's the PIN you already have. Pick a new one." };
  }

  // A manager's PIN names them on every approval, so no two can share one.
  // A cashier's approves nothing, and telling them a PIN is taken would
  // hand them a manager's.
  if (hasManagerAccess(staff.role)) {
    const free = await checkPinFree(staff.employeeId, input.next);
    if (!free.ok) return free;
  }

  const { error: saveErr } = await supabase
    .from("employees")
    .update({ pin_hash: hashPin(input.next), pin_must_change: false, pin_set_at: new Date().toISOString() })
    .eq("id", staff.employeeId);
  if (saveErr) return { ok: false, error: "Couldn't save your PIN. Try again." };
  // The "still 9999" banner lives in the admin layout.
  revalidatePath("/admin", "layout");
  return { ok: true };
}
