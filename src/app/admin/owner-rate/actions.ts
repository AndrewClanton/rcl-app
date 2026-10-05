"use server";

import { revalidatePath } from "next/cache";
import { assertOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Back office -> Owner rate, for the owners: which owners get it.

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

function revalidate() {
  revalidatePath("/admin/owner-rate");
  revalidatePath("/admin");
  revalidatePath("/pos");
}

// Who gets the owner rate: a tick on an owner (employees.owner_rate). Only
// an active owner login can be ticked. Every change is kept
// (owner_rate_changes): who, when, on or off.
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
    .eq("role", "owner")
    .select("name");
  if (error) return { ok: false, error: error.code === "42703" || error.code === "PGRST204" ? "The database update for the owner rate hasn't been applied yet." : "Couldn't save that. Try again." };
  if (!data?.length) return { ok: false, error: "Only an active owner login can get the owner rate." };
  if (!!before?.owner_rate !== (on === true)) {
    const { error: logError } = await db.from("owner_rate_changes").insert({ employee_id: employeeId, turned_on: on === true, changed_by: staff.employeeId });
    if (logError) console.error("owner rate change not logged", logError.message);
  }
  revalidate();
  const name = firstName(String(data[0].name ?? "They"));
  return { ok: true, message: on ? `${name} gets the owner rate now.` : `${name} doesn't get the owner rate anymore.` };
}
