"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertAdmin } from "@/lib/auth";
import { DESCRIPTION_MAX, EIN, EIN_SETTING, isCategory, parseMoney, type ImpactCategory } from "@/lib/org-invoices";

// Back office → Community impact (lib/data/impact.ts). Owners and admins.

type Result = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export interface ActivityFields {
  date: string;
  orgId: string; // "" for none
  category: ImpactCategory;
  description: string;
  people: string;
  value: string;
}

export async function addActivity(f: ActivityFields): Promise<Result> {
  const staff = await assertAdmin();
  const date = String(f.date ?? "");
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) return { ok: false, error: "Pick the date." };
  const orgId = String(f.orgId ?? "");
  if (orgId && !UUID.test(orgId)) return { ok: false, error: "Pick an organization (or none)." };
  if (!isCategory(f.category)) return { ok: false, error: "Pick who it served." };
  const description = String(f.description ?? "").trim().replace(/\s+/g, " ");
  if (!description || description.length > DESCRIPTION_MAX) return { ok: false, error: `Describe it (up to ${DESCRIPTION_MAX} characters).` };
  const people = Number(String(f.people ?? "").trim() || "0");
  if (!Number.isInteger(people) || people < 0 || people > 100000) return { ok: false, error: "People should be a whole number." };
  const value = String(f.value ?? "").trim() ? parseMoney(f.value) : 0;
  if (value === null) return { ok: false, error: "The value should be a dollar amount, like 176." };
  const { error } = await createAdminClient()
    .from("community_activities")
    .insert({
      activity_date: date,
      organization_id: orgId || null,
      category: f.category,
      description,
      people,
      value,
      created_by: staff.employeeId,
      created_by_name: staff.name.slice(0, 120),
    });
  if (error) return { ok: false, error: "Couldn't save it. Try again." };
  revalidatePath("/admin/impact");
  return { ok: true };
}

export async function deleteActivity(id: string): Promise<Result> {
  await assertAdmin();
  if (!UUID.test(id)) return { ok: false, error: "Couldn't find that activity." };
  const { error } = await createAdminClient().from("community_activities").delete().eq("id", id);
  if (error) return { ok: false, error: "Couldn't remove it. Try again." };
  revalidatePath("/admin/impact");
  return { ok: true };
}

// The nonprofit's EIN (12-3456789), shown on invoices and the printable
// summary. Blank clears it.
export async function saveEin(raw: string): Promise<Result> {
  const staff = await assertAdmin();
  const ein = String(raw ?? "").trim();
  if (ein && !EIN.test(ein)) return { ok: false, error: "An EIN looks like 12-3456789." };
  const db = createAdminClient();
  const { error } = ein
    ? await db.from("settings").upsert({ key: EIN_SETTING, value: ein, updated_at: new Date().toISOString(), updated_by: staff.employeeId }, { onConflict: "key" })
    : await db.from("settings").delete().eq("key", EIN_SETTING);
  if (error) return { ok: false, error: "Couldn't save it. Try again." };
  revalidatePath("/admin/impact");
  return { ok: true };
}
