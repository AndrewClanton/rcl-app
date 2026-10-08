"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPerkSlot, perkOption, type RewardKind } from "@/lib/rewards";
import { addFlag } from "@/lib/member-flags-server";
import { FLAG_NOTE_MAX } from "@/lib/member-flags";

// Back office -> Points (owners and admins): the rewards catalog, the
// earning and redeeming limits, and flagging a member from the watch list.

export type SaveResult = { ok: true; id?: string } | { ok: false; error: string };

export interface RewardInput {
  id?: string | null;
  name: string;
  description: string;
  kind: RewardKind;
  perkSlot: string | null;
  perkKey: string | null;
  perkDays: number | null;
  points: number;
  realCost: number | null;
  isAlcohol: boolean;
  dailyLimit: number | null;
  monthlyLimit: number | null;
  stock: number | null;
  active: boolean;
  sort: number;
}

const wholeOrNull = (n: unknown, min: number, max: number): number | null | undefined => {
  if (n === null || n === undefined || n === "") return null;
  const v = Number(n);
  return Number.isInteger(v) && v >= min && v <= max ? v : undefined;
};

export async function saveReward(input: RewardInput): Promise<SaveResult> {
  const staff = await assertAdmin();
  if (!input || typeof input !== "object") return { ok: false, error: "Nothing to save." };
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 60) return { ok: false, error: "Give it a name, up to 60 characters." };
  const description = String(input.description ?? "").trim().slice(0, 200) || null;
  const kind = input.kind;
  if (!["good", "discount", "perk"].includes(kind)) return { ok: false, error: "Pick a type." };
  let perkSlot: string | null = null;
  let perkKey: string | null = null;
  let perkDays: number | null = null;
  if (kind === "perk") {
    if (!isPerkSlot(input.perkSlot)) return { ok: false, error: "Pick what kind of perk it is." };
    if (!perkOption(input.perkSlot, input.perkKey)) return { ok: false, error: "Pick which one it unlocks." };
    perkSlot = input.perkSlot;
    perkKey = String(input.perkKey);
    const days = wholeOrNull(input.perkDays, 1, 3650);
    if (days === undefined) return { ok: false, error: "Days: a whole number from 1 to 3650, or blank for good." };
    perkDays = days;
  }
  const points = Number(input.points);
  if (!Number.isInteger(points) || points < 1 || points > 100000) return { ok: false, error: "Points: a whole number from 1 to 100,000." };
  const realCost = input.realCost === null || (input.realCost as unknown) === "" ? null : Number(input.realCost);
  if (realCost !== null && (!Number.isFinite(realCost) || realCost < 0 || realCost > 10000)) return { ok: false, error: "Real cost: dollars, or blank." };
  const daily = wholeOrNull(input.dailyLimit, 1, 1000);
  const monthly = wholeOrNull(input.monthlyLimit, 1, 10000);
  const stock = wholeOrNull(input.stock, 0, 1_000_000);
  if (daily === undefined || monthly === undefined || stock === undefined) return { ok: false, error: "Limits and stock: whole numbers, or blank for none." };
  const sort = Number.isInteger(Number(input.sort)) ? Number(input.sort) : 0;

  const row = {
    name,
    description,
    kind,
    perk_slot: perkSlot,
    perk_key: perkKey,
    perk_days: perkDays,
    points,
    real_cost: realCost === null ? null : Math.round(realCost * 100) / 100,
    is_alcohol: kind === "good" && !!input.isAlcohol,
    daily_limit: daily,
    monthly_limit: monthly,
    stock,
    active: !!input.active,
    sort,
    updated_at: new Date().toISOString(),
    updated_by: staff.employeeId,
  };
  const supabase = createAdminClient();
  const res = input.id ? await supabase.from("reward_catalog").update(row).eq("id", input.id).select("id").single() : await supabase.from("reward_catalog").insert(row).select("id").single();
  if (res.error) {
    if (res.error.code === "23505") return { ok: false, error: kind === "discount" ? "There's already a $5 off reward." : "That perk is already in the catalog." };
    return { ok: false, error: "That didn't save. Try again." };
  }
  revalidatePath("/admin/points");
  return { ok: true, id: res.data.id as string };
}

export interface SettingsInput {
  bonusDailyCap: number;
  earnDailyCap: number;
  goodsDailyLimit: number;
  goodsMonthlyLimit: number;
}

export async function saveSettings(input: SettingsInput): Promise<SaveResult> {
  const staff = await assertAdmin();
  const vals = [input?.bonusDailyCap, input?.earnDailyCap, input?.goodsDailyLimit, input?.goodsMonthlyLimit].map(Number);
  if (vals.some((v) => !Number.isInteger(v) || v < 0 || v > 1_000_000)) return { ok: false, error: "Each one is a whole number (0 for no limit)." };
  const [bonus, earn, goodsDay, goodsMonth] = vals;
  const { error } = await createAdminClient()
    .from("points_settings")
    .upsert({ id: true, bonus_daily_cap: bonus, earn_daily_cap: earn, goods_daily_limit: goodsDay, goods_monthly_limit: goodsMonth, updated_at: new Date().toISOString(), updated_by: staff.employeeId });
  if (error) return { ok: false, error: "That didn't save. Try again." };
  revalidatePath("/admin/points");
  return { ok: true };
}

// "Flag" on the watch list: a flag in the member flag system (reason
// "other"), with the watch list's reason as its note. An admin looks at it
// on the member's page like any other flag.
export async function flagFromWatchList(memberId: string, reason: string): Promise<SaveResult> {
  const staff = await assertAdmin();
  if (typeof memberId !== "string" || !/^[0-9a-f-]{36}$/i.test(memberId)) return { ok: false, error: "That member couldn't be read." };
  const note = `Points watch list: ${String(reason ?? "").trim()}`.slice(0, FLAG_NOTE_MAX);
  const flag = await addFlag(memberId, "other", note, staff.employeeId);
  if (!flag) return { ok: false, error: "The flag didn't save. Try again." };
  revalidatePath("/admin/points");
  return { ok: true };
}
