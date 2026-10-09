"use server";

import { revalidatePath } from "next/cache";
import { assertManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { maskEmail, maskPhone } from "@/lib/contact-mask";
import { awardByHand, createDef } from "@/lib/badges/server";
import { approveDraft, awardEventBadges, countEarners, eventRule, refreshDrafts, skipDraft, type EventRule } from "@/lib/badges/events";
import { cleanSeriesName } from "@/lib/event-series";
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
  eventTimes?: number | null; // a series: how many times
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

export async function createBadge(input: NewBadgeInput): Promise<BadgeResult<{ id: string; awarded: number }>> {
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
    const rule = readEventRule(input);
    if ("error" in rule) return { ok: false, error: rule.error };
    params = rule;
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
  if (!r.ok) return r;
  revalidatePath("/admin/badges");
  // An event badge goes to everyone who already came, now; anyone who comes
  // later gets it then (lib/badges/events.ts).
  let awarded = 0;
  if (ruleType === "event") {
    const done = await awardEventBadges({ defIds: [r.id], fresh: true }).catch((e: unknown) => {
      console.error("event badge first award", e instanceof Error ? e.message : e);
      return null;
    });
    awarded = done?.perDef[r.id]?.awarded ?? 0;
  }
  return { ...r, awarded };
}

// What "For an event" was set to, checked.
function readEventRule(input: { eventKind?: string | null; eventMatch?: string | null; eventTimes?: number | null }): EventRule | { error: string } {
  const kind = input?.eventKind === "screening" || input?.eventKind === "house_event" || input?.eventKind === "series" ? input.eventKind : null;
  if (!kind) return { error: "Pick a showing, a house event or a series." };
  const match = tidy(input.eventMatch, 80);
  if (!match) return { error: kind === "series" ? "Pick the series." : kind === "screening" ? "Pick the showing." : "Pick the event." };
  if (kind !== "series" && !/^[0-9a-f-]{36}$/.test(match)) return { error: "Pick it from the list." };
  const times = kind === "series" ? whole(input.eventTimes ?? 1, 1, 100) : 1;
  if (times === null) return { error: "How many times? A number from 1 to 100." };
  const rule = eventRule({ kind, match, times });
  return rule ?? { error: "Pick it from the list." };
}

// The dry run before an event badge is made: how many members it would go
// to right now.
export async function countEventBadge(input: { eventKind: string; eventMatch: string; eventTimes?: number | null }): Promise<BadgeResult<{ came: number }>> {
  await assertManager();
  const rule = readEventRule(input);
  if ("error" in rule) return { ok: false, error: rule.error };
  try {
    return { ok: true, ...(await countEarners(rule)) };
  } catch {
    return { ok: false, error: "Couldn't count who came. Try again." };
  }
}

// An event badge's "Award to everyone who came": its dry run, or the award.
export async function awardEventBadgeNow(defId: string, dryRun: boolean): Promise<BadgeResult<{ came: number; toAward: number; awarded: number }>> {
  await assertManager();
  if (typeof defId !== "string") return { ok: false, error: "That badge isn't in the catalog." };
  try {
    const r = await awardEventBadges({ defIds: [defId], dryRun, fresh: true });
    const d = r.perDef[defId];
    if (!d) return { ok: false, error: "That badge isn't an event badge that's switched on." };
    if (!dryRun) revalidatePath(`/admin/badges/${defId}`);
    return { ok: true, came: d.came, toAward: d.toAward, awarded: d.awarded };
  } catch {
    return { ok: false, error: "It didn't go through. Try again." };
  }
}

// ---------- drafts from the calendar ----------

export async function refreshBadgeDrafts(): Promise<BadgeResult<{ added: number }>> {
  await assertManager();
  try {
    const r = await refreshDrafts();
    revalidatePath("/admin/badges");
    return { ok: true, ...r };
  } catch {
    return { ok: false, error: "Couldn't read the calendar. Try again." };
  }
}

export async function approveBadgeDraft(id: string, edits: { name: string; flavor: string; points: number }): Promise<BadgeResult<{ defId: string; awarded: number }>> {
  const staff = await assertManager();
  const name = tidy(edits?.name, 32);
  if (name.length < 2) return { ok: false, error: "Give it a name." };
  const points = whole(edits?.points, 0, 1000);
  if (points === null) return { ok: false, error: "Points: a whole number from 0 to 1,000." };
  if (typeof id !== "string") return { ok: false, error: "That draft was already handled." };
  const r = await approveDraft(id, { name, flavor: tidy(edits?.flavor, 80), points }, staff.employeeId);
  if (r.ok) revalidatePath("/admin/badges");
  return r;
}

export async function skipBadgeDraft(id: string): Promise<BadgeResult> {
  const staff = await assertManager();
  if (typeof id !== "string") return { ok: false, error: "That draft was already handled." };
  await skipDraft(id, staff.employeeId);
  revalidatePath("/admin/badges");
  return { ok: true };
}

// ---------- series tags ----------

export async function addSeriesTag(name: string): Promise<BadgeResult> {
  const staff = await assertManager();
  const clean = cleanSeriesName(name);
  if (!clean) return { ok: false, error: "A name from 2 to 40 characters." };
  const db = createAdminClient();
  const { data: last } = await db.from("event_series").select("sort").order("sort", { ascending: false }).limit(1).maybeSingle();
  const { error } = await db.from("event_series").insert({ name: clean, sort: (Number(last?.sort) || 0) + 10, created_by: staff.employeeId });
  if (error) return { ok: false, error: error.code === "23505" ? "That series is already on the list." : "It didn't save. Try again." };
  revalidatePath("/admin/badges/series");
  revalidatePath("/admin/screenings");
  return { ok: true };
}

// Switched off: it leaves the pickers, and showings that have it keep it.
export async function setSeriesTagActive(name: string, active: boolean): Promise<BadgeResult> {
  await assertManager();
  const { error } = await createAdminClient().from("event_series").update({ active: !!active }).eq("name", String(name));
  if (error) return { ok: false, error: "It didn't save. Try again." };
  revalidatePath("/admin/badges/series");
  revalidatePath("/admin/screenings");
  return { ok: true };
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
