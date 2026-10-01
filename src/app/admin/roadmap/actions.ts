"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin, assertManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { maskEmail, maskPhone } from "@/lib/contact-mask";
import { tidyText } from "@/lib/member-profile";
import { appVersion } from "@/lib/app-version";
import { privateNamesIn } from "@/lib/data/roadmap";
import { SUGGESTION_MAX, SUMMARY_MAX, TITLE_MAX, isRoadmapStatus, roadmapSlug, type RoadmapStatus } from "@/lib/roadmap";

// Back office → Roadmap. Owners and admins run the list (add, edit,
// reorder, change status, publish, accept or decline suggestions);
// managers can look, find a member, and log a request for the inbox.
// Every action checks the role itself: a Server Action is a public
// endpoint whatever page it sits under. Failures come back as
// { ok: false, error } (production hides thrown messages). `confirm` lists
// names that mustn't go public (archive films, private events), for a
// "Save anyway" when the match is a false alarm.

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; confirm?: string[] };

export interface RoadmapItemInput {
  title: string;
  summary: string;
  notes: string;
  status: RoadmapStatus;
  isPublic: boolean;
  requesterMemberId: string | null;
  requesterName: string | null;
  creditOk: boolean;
  confirmNames?: boolean; // "Save anyway"
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidate(slug?: string) {
  revalidatePath("/admin/roadmap");
  revalidatePath("/whats-new");
  if (slug) revalidatePath(`/whats-new/${slug}`);
}

// Several lines allowed (a summary can be two short paragraphs).
function cleanText(input: unknown, max: number): string | null {
  if (typeof input !== "string") return "";
  const text = input
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(tidyText)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return [...text].length > max ? null : text;
}

type Clean =
  | { ok: true; row: { title: string; public_summary: string; internal_notes: string | null; status: RoadmapStatus; is_public: boolean; requested_by_member_id: string | null; requested_by_name: string | null; credit_ok: boolean } }
  | { ok: false; error: string };

async function cleanInput(input: RoadmapItemInput): Promise<Clean> {
  const title = tidyText(input?.title);
  if (!title) return { ok: false, error: "Give it a title." };
  if ([...title].length > TITLE_MAX) return { ok: false, error: `Keep the title to ${TITLE_MAX} characters.` };
  const summary = cleanText(input?.summary, SUMMARY_MAX);
  if (summary === null) return { ok: false, error: `Keep the public summary to ${SUMMARY_MAX} characters.` };
  const notes = cleanText(input?.notes, 4000);
  if (notes === null) return { ok: false, error: "Keep the internal notes to 4,000 characters." };
  if (!isRoadmapStatus(input?.status)) return { ok: false, error: "Pick a status." };
  const isPublic = input?.isPublic === true;
  if (isPublic && !summary) return { ok: false, error: "A public item needs a public summary: a line or two a customer would understand." };

  let memberId: string | null = null;
  let name: string | null = null;
  if (input?.requesterMemberId) {
    if (!UUID.test(input.requesterMemberId)) return { ok: false, error: "That member wasn't found." };
    const { data } = await createAdminClient().from("members").select("id, erased_at").eq("id", input.requesterMemberId).maybeSingle();
    if (!data || data.erased_at) return { ok: false, error: "That member wasn't found." };
    memberId = data.id as string;
  } else if (input?.requesterName) {
    name = tidyText(input.requesterName) || null;
    if (name && [...name].length > 60) return { ok: false, error: "Keep the name to 60 characters." };
  }
  return {
    ok: true,
    row: {
      title,
      public_summary: summary,
      internal_notes: notes || null,
      status: input.status,
      is_public: isPublic,
      requested_by_member_id: memberId,
      requested_by_name: name,
      credit_ok: (memberId || name) && input?.creditOk === true ? true : false,
    },
  };
}

async function namesCheck(row: { is_public: boolean; title: string; public_summary: string }, confirmed: boolean | undefined) {
  if (!row.is_public || confirmed) return null;
  const names = await privateNamesIn(`${row.title}\n${row.public_summary}`).catch(() => []);
  if (!names.length) return null;
  return {
    ok: false as const,
    error: `This would show ${names.join(", ")} on the public page. Archive films and private events must never be named publicly. Reword it, or save anyway if it's a false alarm.`,
    confirm: names,
  };
}

async function uniqueSlug(title: string): Promise<string> {
  const base = roadmapSlug(title);
  const { data } = await createAdminClient().from("roadmap_items").select("slug").like("slug", `${base}%`);
  const taken = new Set((data ?? []).map((r) => r.slug as string));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

// Add an item: from scratch, or from a suggestion in the inbox (which is
// then marked accepted and linked to it).
export async function createRoadmapItem(input: RoadmapItemInput, fromSuggestionId?: string | null): Promise<Result<{ slug: string }>> {
  const staff = await assertAdmin();
  const clean = await cleanInput(input);
  if (!clean.ok) return clean;
  const blocked = await namesCheck(clean.row, input?.confirmNames);
  if (blocked) return blocked;
  const db = createAdminClient();

  let suggestion: { id: string } | null = null;
  if (fromSuggestionId) {
    if (!UUID.test(fromSuggestionId)) return { ok: false, error: "That suggestion wasn't found." };
    const { data } = await db.from("roadmap_suggestions").select("id, status").eq("id", fromSuggestionId).maybeSingle();
    if (!data) return { ok: false, error: "That suggestion wasn't found." };
    if (data.status !== "new") return { ok: false, error: "Someone already answered that suggestion. Refresh the page." };
    suggestion = { id: data.id as string };
  }

  const slug = await uniqueSlug(clean.row.title);
  const { data: item, error } = await db
    .from("roadmap_items")
    .insert({ ...clean.row, slug, shipped_in_version: clean.row.status === "live" ? appVersion().version : null })
    .select("id, slug")
    .single();
  if (error || !item) return { ok: false, error: "That didn't save. Try again." };

  if (suggestion) {
    await db
      .from("roadmap_suggestions")
      .update({ status: "accepted", item_id: item.id, decided_by: staff.employeeId, decided_at: new Date().toISOString() })
      .eq("id", suggestion.id)
      .eq("status", "new");
  }
  revalidate(item.slug as string);
  return { ok: true, slug: item.slug as string };
}

export async function updateRoadmapItem(id: string, input: RoadmapItemInput): Promise<Result> {
  await assertAdmin();
  if (!UUID.test(id)) return { ok: false, error: "That item wasn't found." };
  const clean = await cleanInput(input);
  if (!clean.ok) return clean;
  const blocked = await namesCheck(clean.row, input?.confirmNames);
  if (blocked) return blocked;
  const db = createAdminClient();
  const { data: old } = await db.from("roadmap_items").select("status, slug").eq("id", id).maybeSingle();
  if (!old) return { ok: false, error: "That item wasn't found." };
  const goingLive = clean.row.status === "live" && old.status !== "live";
  const { error } = await db
    .from("roadmap_items")
    .update({ ...clean.row, ...(goingLive && { shipped_in_version: appVersion().version }) })
    .eq("id", id);
  if (error) return { ok: false, error: "That didn't save. Try again." };
  revalidate(old.slug as string);
  return { ok: true };
}

// The status menu on a row. Going live stamps the date (the database does)
// and the release it shipped in.
export async function setRoadmapStatus(id: string, status: RoadmapStatus): Promise<Result> {
  await assertAdmin();
  if (!UUID.test(id) || !isRoadmapStatus(status)) return { ok: false, error: "That item wasn't found." };
  const db = createAdminClient();
  const { data: old } = await db.from("roadmap_items").select("status, slug").eq("id", id).maybeSingle();
  if (!old) return { ok: false, error: "That item wasn't found." };
  if (old.status === status) return { ok: true };
  const { error } = await db
    .from("roadmap_items")
    .update({ status, ...(status === "live" && { shipped_in_version: appVersion().version }) })
    .eq("id", id);
  if (error) return { ok: false, error: "That didn't save. Try again." };
  revalidate(old.slug as string);
  return { ok: true };
}

export async function setRoadmapPublic(id: string, isPublic: boolean, confirmNames?: boolean): Promise<Result> {
  await assertAdmin();
  if (!UUID.test(id)) return { ok: false, error: "That item wasn't found." };
  const db = createAdminClient();
  const { data: item } = await db.from("roadmap_items").select("slug, title, public_summary").eq("id", id).maybeSingle();
  if (!item) return { ok: false, error: "That item wasn't found." };
  if (isPublic) {
    if (!String(item.public_summary ?? "").trim()) return { ok: false, error: "Write a public summary first (Edit), so customers know what it is." };
    const blocked = await namesCheck({ is_public: true, title: item.title as string, public_summary: item.public_summary as string }, confirmNames);
    if (blocked) return blocked;
  }
  const { error } = await db.from("roadmap_items").update({ is_public: isPublic === true }).eq("id", id);
  if (error) return { ok: false, error: "That didn't save. Try again." };
  revalidate(item.slug as string);
  return { ok: true };
}

// The queue after a drag: only the items whose rank changed.
export async function reorderRoadmap(changes: { id: string; rank: number }[]): Promise<Result> {
  await assertAdmin();
  if (!Array.isArray(changes) || changes.length > 500) return { ok: false, error: "That didn't save. Refresh and try again." };
  const valid = changes.filter((c) => c && typeof c.id === "string" && UUID.test(c.id) && Number.isInteger(c.rank) && c.rank > 0 && c.rank < 1_000_000);
  if (valid.length !== changes.length) return { ok: false, error: "That didn't save. Refresh and try again." };
  const db = createAdminClient();
  for (let i = 0; i < valid.length; i += 20) {
    const results = await Promise.all(valid.slice(i, i + 20).map((c) => db.from("roadmap_items").update({ rank: c.rank }).eq("id", c.id)));
    if (results.some((r) => r.error)) {
      revalidate();
      return { ok: false, error: "Part of the new order didn't save. Refresh and try again." };
    }
  }
  revalidate();
  return { ok: true };
}

export async function declineRoadmapSuggestion(id: string): Promise<Result> {
  const staff = await assertAdmin();
  if (!UUID.test(id)) return { ok: false, error: "That suggestion wasn't found." };
  const { error } = await createAdminClient()
    .from("roadmap_suggestions")
    .update({ status: "declined", decided_by: staff.employeeId, decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "new");
  if (error) return { ok: false, error: "That didn't save. Try again." };
  revalidate();
  return { ok: true };
}

// Put a declined suggestion back in the inbox.
export async function reopenRoadmapSuggestion(id: string): Promise<Result> {
  await assertAdmin();
  if (!UUID.test(id)) return { ok: false, error: "That suggestion wasn't found." };
  const { error } = await createAdminClient().from("roadmap_suggestions").update({ status: "new", decided_by: null, decided_at: null }).eq("id", id).eq("status", "declined");
  if (error) return { ok: false, error: "That didn't save. Try again." };
  revalidate();
  return { ok: true };
}

// Managers and up: someone asked for something at the bar. It goes to the
// inbox, where an owner or admin says yes (it becomes an item) or no.
export async function logRoadmapRequest(input: { body: string; requesterMemberId: string | null; requesterName: string | null; creditOk: boolean }): Promise<Result> {
  const staff = await assertManager();
  const body = cleanText(input?.body, SUGGESTION_MAX);
  if (!body) return { ok: false, error: `Write what they asked for (up to ${SUGGESTION_MAX} characters).` };
  let memberId: string | null = null;
  let name: string | null = null;
  if (input?.requesterMemberId) {
    if (!UUID.test(input.requesterMemberId)) return { ok: false, error: "That member wasn't found." };
    const { data } = await createAdminClient().from("members").select("id, erased_at").eq("id", input.requesterMemberId).maybeSingle();
    if (!data || data.erased_at) return { ok: false, error: "That member wasn't found." };
    memberId = data.id as string;
  } else {
    name = tidyText(input?.requesterName) || null;
    if (name && [...name].length > 60) return { ok: false, error: "Keep the name to 60 characters." };
  }
  const { error } = await createAdminClient()
    .from("roadmap_suggestions")
    .insert({ member_id: memberId, name, body, credit_ok: (memberId || name) && input?.creditOk === true ? true : false, logged_by: staff.employeeId });
  if (error) return { ok: false, error: "That didn't save. Try again." };
  revalidate();
  return { ok: true };
}

// Who asked: members by name, email or phone. Contact comes back shortened
// for everyone, enough to tell two Sarahs apart.
export async function searchRoadmapRequesters(query: string): Promise<Result<{ members: { id: string; name: string; hint: string }[] }>> {
  await assertManager();
  const q = String(query ?? "").trim().slice(0, 80);
  if (q.length < 2) return { ok: true, members: [] };
  const escaped = q.replace(/[%_]/g, (c) => `\\${c}`).replace(/[,()"\\]/g, " ");
  const digits = q.replace(/\D/g, "");
  const filters = [`name.ilike.%${escaped}%`, `email.ilike.%${escaped}%`];
  if (digits.length >= 4) filters.push(`phone_digits.like.%${digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits}%`);
  const { data, error } = await createAdminClient().from("members").select("id, name, email, phone").is("erased_at", null).or(filters.join(",")).order("name").limit(8);
  if (error) return { ok: false, error: "Search didn't work. Try again." };
  return {
    ok: true,
    members: (data ?? []).map((m) => ({ id: m.id as string, name: (m.name as string) || "No name", hint: [maskEmail(m.email as string), maskPhone(m.phone as string)].filter(Boolean).join(" · ") })),
  };
}
