"use server";

import { revalidatePath } from "next/cache";
import { assertManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { maskEmail, maskPhone } from "@/lib/contact-mask";
import { awardByHand, createDef } from "@/lib/badges/server";
import { RULE_TYPES, type RuleParams, type RuleType } from "@/lib/badges/rules";

// Back office -> Badges (managers and up): make a badge, and give one by
// hand. Every action checks again (assertManager).

export type BadgeResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface NewBadgeInput {
  name: string;
  flavor: string;
  spec: unknown; // the maker's recipe; lib/badges/art.ts cleanSpec checks it
  formLabel: string;
  ruleType: string;
  count?: number | null;
  weeks?: number | null;
  from?: string | null; // "23:00"
  before?: string | null;
  eventKind?: string | null;
  eventMatch?: string | null;
  points: number;
}

const whole = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const minutes = (v: unknown): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? ""));
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  return h < 24 && mm < 60 ? h * 60 + mm : null;
};
const tidy = (s: unknown, max: number) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export async function createBadge(input: NewBadgeInput): Promise<BadgeResult<{ id: string }>> {
  const staff = await assertManager();
  const name = tidy(input?.name, 32);
  if (name.length < 2) return { ok: false, error: "Give it a name." };
  const flavor = tidy(input?.flavor, 80);
  const ruleType = input?.ruleType as RuleType;
  if (!RULE_TYPES.includes(ruleType)) return { ok: false, error: "Pick how it's earned." };
  const points = whole(input?.points, 0, 1000);
  if (points === null) return { ok: false, error: "Points: a whole number from 0 to 1,000." };
  let params: RuleParams = {};
  if (ruleType === "visit_count") {
    const count = whole(input.count, 2, 10000);
    if (count === null) return { ok: false, error: "Which check-in earns it? A number, 2 or more." };
    params = { count };
  } else if (ruleType === "week_streak") {
    const weeks = whole(input.weeks, 2, 520);
    if (weeks === null) return { ok: false, error: "How many weeks in a row? A number, 2 or more." };
    params = { weeks };
  } else if (ruleType === "checkin_time") {
    const from = minutes(input.from);
    const before = minutes(input.before);
    if (from === null || before === null || from === before) return { ok: false, error: "Pick the times it's earned between." };
    params = { from, before };
  } else if (ruleType === "event") {
    const kind = input.eventKind === "screening" || input.eventKind === "house_event" || input.eventKind === "series" ? input.eventKind : null;
    if (!kind) return { ok: false, error: "Pick the kind of event." };
    params = { kind, match: tidy(input.eventMatch, 80) || undefined, times: 1 };
  }
  const r = await createDef({
    name,
    flavor,
    spec: input?.spec,
    formLabel: tidy(input?.formLabel, 30) || null,
    ruleType,
    params,
    points,
    cheer: null,
    createdBy: staff.employeeId,
  });
  if (r.ok) revalidatePath("/admin/badges");
  return r;
}

export async function searchMembersForBadge(query: string): Promise<BadgeResult<{ members: { id: string; name: string; hint: string }[] }>> {
  await assertManager();
  const q = String(query ?? "").trim().slice(0, 80);
  if (q.length < 2) return { ok: true, members: [] };
  const escaped = q.replace(/[%_]/g, (c) => `\\${c}`).replace(/[,()"\\]/g, " ");
  const digits = q.replace(/\D/g, "");
  const filters = [`name.ilike.%${escaped}%`, `email.ilike.%${escaped}%`];
  if (digits.length >= 4) filters.push(`phone_digits.like.%${digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits}%`);
  const { data, error } = await createAdminClient().from("members").select("id, name, email, phone").is("erased_at", null).or(filters.join(",")).order("name").limit(8);
  if (error) return { ok: false, error: "Search didn't work. Try again." };
  return { ok: true, members: (data ?? []).map((m) => ({ id: m.id, name: m.name, hint: [maskEmail(m.email), maskPhone(m.phone)].filter(Boolean).join(" · ") })) };
}

export async function awardBadge(defId: string, memberId: string, note: string): Promise<BadgeResult<{ code: string | null }>> {
  const staff = await assertManager();
  if (typeof defId !== "string" || typeof memberId !== "string") return { ok: false, error: "Pick a member." };
  const r = await awardByHand(defId, memberId, tidy(note, 40) || null, staff.employeeId);
  if (r.ok) revalidatePath(`/admin/badges/${defId}`);
  return r;
}
