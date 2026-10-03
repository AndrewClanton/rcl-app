"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin, assertStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowAttempt } from "@/lib/rate-limit";
import { closeOutage } from "@/lib/ops/outages";
import { saveAlertRecipientIds } from "@/lib/ops/ran-out-alert";
import type { OutageResolution } from "@/lib/ops/shared";

// Back office → Ran out. Back in stock (or Found some, False alarm) closes a
// report: the register's "Out of …" line goes away and what it stopped goes
// back on sale. Any signed-in staff member can, since the email's link lands
// here. Who gets the email is for owners and admins.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESOLUTIONS: OutageResolution[] = ["bought", "found", "mistake"];

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function closeRanOut(outageId: string, resolution: OutageResolution): Promise<Result<{ back: string[]; already: boolean }>> {
  const staff = await assertStaff();
  if (typeof outageId !== "string" || !UUID.test(outageId) || !RESOLUTIONS.includes(resolution)) return { ok: false, error: "That didn't come through. Reload and try again." };
  if (!(await allowAttempt(`ran-out-fix:${staff.employeeId}`, 60, 60))) return { ok: false, error: "Too many tries just now. Wait a minute and try again." };
  const r = await closeOutage(outageId.toLowerCase(), resolution, staff.employeeId);
  revalidatePath("/admin/ran-out");
  return r.ok ? { ok: true, back: r.back, already: r.already } : r;
}

export async function saveRanOutAlertTo(ids: string[]): Promise<Result> {
  const staff = await assertAdmin();
  if (!Array.isArray(ids) || ids.length > 30 || !ids.every((id) => typeof id === "string" && UUID.test(id))) return { ok: false, error: "That list didn't come through. Reload and try again." };
  const want = [...new Set(ids.map((id) => id.toLowerCase()))];
  if (want.length) {
    const { data } = await createAdminClient().from("employees").select("id").in("id", want).eq("active", true).neq("role", "display");
    if ((data ?? []).length !== want.length) return { ok: false, error: "Someone on that list isn't on the staff anymore. Reload and pick again." };
  }
  try {
    await saveAlertRecipientIds(want, staff.employeeId);
  } catch (e) {
    console.error("ran out: saving who gets the email failed", e);
    return { ok: false, error: "Couldn't save that. Try again." };
  }
  revalidatePath("/admin/ran-out");
  return { ok: true };
}
