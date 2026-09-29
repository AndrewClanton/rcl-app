"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertStaff } from "@/lib/auth";
import { hashPin, isDefaultPin, verifyPin } from "@/lib/pin";
import { pinProblem } from "@/lib/pin-rules";
import { checkOwnPin } from "@/lib/manager-pin";

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

  // pin_must_change arrives with migration 20260929100000_manager_pins.sql;
  // save the PIN without it until then.
  const pin_hash = hashPin(input.next);
  const { error: saveErr } = await supabase.from("employees").update({ pin_hash, pin_must_change: false }).eq("id", staff.employeeId);
  if (saveErr) {
    const { error: retryErr } = await supabase.from("employees").update({ pin_hash }).eq("id", staff.employeeId);
    if (retryErr) return { ok: false, error: "Couldn't save your PIN. Try again." };
  }
  // The "still 9999" banner lives in the admin layout.
  revalidatePath("/admin", "layout");
  return { ok: true };
}
