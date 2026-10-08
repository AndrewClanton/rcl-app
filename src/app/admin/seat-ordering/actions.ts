"use server";

import { revalidatePath } from "next/cache";
import { assertManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/seat-ordering-server";
import { SPOT_KINDS, isClock, newSpotCode, type SpotKind } from "@/lib/seat-ordering";

// Back office → Seat ordering (managers and up): the switch and its hours,
// and the spots the QR cards sit at.

type Result = { ok: true } | { ok: false; error: string };

const done = (): Result => {
  revalidatePath("/admin/seat-ordering");
  return { ok: true };
};

export async function saveSeatSettings(input: { enabled: boolean; opens: string; closes: string }): Promise<Result> {
  const staff = await assertManager();
  if (!isClock(input?.opens) || !isClock(input?.closes)) return { ok: false, error: "Set both times, like 4:00 PM and 11:30 PM." };
  if (input.opens === input.closes) return { ok: false, error: "The start and end can't be the same time." };
  const { error } = await createAdminClient()
    .from("seat_ordering_settings")
    .upsert({ id: 1, enabled: !!input.enabled, opens: input.opens, closes: input.closes, updated_at: new Date().toISOString(), updated_by: staff.employeeId || null });
  if (error) return { ok: false, error: "Couldn't save. Try again." };
  return done();
}

const cleanName = (v: unknown) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);

export async function addSpot(input: { kind: SpotKind; name: string }): Promise<Result> {
  await assertManager();
  if (!SPOT_KINDS.includes(input?.kind)) return { ok: false, error: "Pick what kind of spot it is." };
  const name = cleanName(input.name);
  if (!name) return { ok: false, error: "Give it a name, like “Booth 9” or “Cinema · Row F”." };
  const supabase = createAdminClient();
  const { data: last } = await supabase.from("order_spots").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  const { error } = await supabase
    .from("order_spots")
    .insert({ kind: input.kind, name, code: newSpotCode(), dark: input.kind === "cinema", sort_order: Number(last?.[0]?.sort_order ?? 0) + 1 });
  if (error) return { ok: false, error: error.code === "23505" ? `There's already a spot called “${name}”.` : "Couldn't add it. Try again." };
  return done();
}

export async function updateSpot(id: string, patch: { name?: string; active?: boolean; dark?: boolean }): Promise<Result> {
  await assertManager();
  if (!isUuid(id)) return { ok: false, error: "That spot isn't there anymore." };
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = cleanName(patch.name);
    if (!name) return { ok: false, error: "A spot needs a name." };
    row.name = name;
  }
  if (patch.active !== undefined) row.active = !!patch.active;
  if (patch.dark !== undefined) row.dark = !!patch.dark;
  const { error } = await createAdminClient().from("order_spots").update(row).eq("id", id);
  if (error) return { ok: false, error: error.code === "23505" ? "Another spot already has that name." : "Couldn't save. Try again." };
  return done();
}

// A new code: the old card's link stops working at once. Print a new card.
export async function rotateSpotCode(id: string): Promise<Result> {
  await assertManager();
  if (!isUuid(id)) return { ok: false, error: "That spot isn't there anymore." };
  const { error } = await createAdminClient().from("order_spots").update({ code: newSpotCode(), code_rotated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: "Couldn't make a new code. Try again." };
  return done();
}
