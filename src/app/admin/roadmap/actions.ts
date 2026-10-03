"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin, assertManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { maskEmail, maskPhone } from "@/lib/contact-mask";
import { tidyText } from "@/lib/member-profile";
import { appVersion } from "@/lib/app-version";
import { NOTES_MAX, SUMMARY_MAX, TITLE_MAX, isRoadmapStatus, roadmapSlug, type RoadmapStatus } from "@/lib/roadmap";

// Back office → Roadmap, staff only. Owners and admins run the list (add,
// edit, reorder, change status); managers can look, find a member, and log
// a request someone made, which goes on the list as an idea. Every action
// checks the role itself: a Server Action is a public endpoint whatever
// page it sits under. Failures come back as { ok: false, error }
// (production hides thrown messages).

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface RoadmapItemInput {
  title: string;
  summary: string;
  notes: string;
  status: RoadmapStatus;
  requesterMemberId: string | null;
  requesterName: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidate() {
  revalidatePath("/admin/roadmap");
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

// Who asked: a member (checked to exist), a typed name, or nobody.
async function cleanRequester(memberId: unknown, name: unknown): Promise<{ ok: true; memberId: string | null; name: string | null } | { ok: false; error: string }> {
  if (memberId) {
    if (typeof memberId !== "string" || !UUID.test(memberId)) return { ok: false, error: "That member wasn't found." };
    const { data } = await createAdminClient().from("members").select("id, erased_at").eq("id", memberId).maybeSingle();
    if (!data || data.erased_at) return { ok: false, error: "That member wasn't found." };
    return { ok: true, memberId: data.id as string, name: null };
  }
  const typed = tidyText(name) || null;
  if (typed && [...typed].length > 60) return { ok: false, error: "Keep the name to 60 characters." };
  return { ok: true, memberId: null, name: typed };
}

function cleanTitle(input: unknown, empty = "Give it a title."): { ok: true; title: string } | { ok: false; error: string } {
  const title = tidyText(input);
  if (!title) return { ok: false, error: empty };
  if ([...title].length > TITLE_MAX) return { ok: false, error: `Keep the title to ${TITLE_MAX} characters.` };
  return { ok: true, title };
}

type Clean =
  | { ok: true; row: { title: string; public_summary: string; internal_notes: string | null; status: RoadmapStatus; requested_by_member_id: string | null; requested_by_name: string | null } }
  | { ok: false; error: string };

async function cleanInput(input: RoadmapItemInput): Promise<Clean> {
  const title = cleanTitle(input?.title);
  if (!title.ok) return title;
  const summary = cleanText(input?.summary, SUMMARY_MAX);
  if (summary === null) return { ok: false, error: `Keep the summary to ${SUMMARY_MAX} characters.` };
  const notes = cleanText(input?.notes, NOTES_MAX);
  if (notes === null) return { ok: false, error: "Keep the internal notes to 4,000 characters." };
  if (!isRoadmapStatus(input?.status)) return { ok: false, error: "Pick a status." };
  const requester = await cleanRequester(input?.requesterMemberId, input?.requesterName);
  if (!requester.ok) return requester;
  return {
    ok: true,
    row: {
      title: title.title,
      public_summary: summary,
      internal_notes: notes || null,
      status: input.status,
      requested_by_member_id: requester.memberId,
      requested_by_name: requester.name,
    },
  };
}

async function uniqueSlug(title: string): Promise<string> {
  const base = roadmapSlug(title);
  const { data } = await createAdminClient().from("roadmap_items").select("slug").like("slug", `${base}%`);
  const taken = new Set((data ?? []).map((r) => r.slug as string));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export async function createRoadmapItem(input: RoadmapItemInput): Promise<Result> {
  await assertAdmin();
  const clean = await cleanInput(input);
  if (!clean.ok) return clean;
  const slug = await uniqueSlug(clean.row.title);
  const { error } = await createAdminClient()
    .from("roadmap_items")
    .insert({ ...clean.row, slug, shipped_in_version: clean.row.status === "live" ? appVersion().version : null });
  if (error) return { ok: false, error: "That didn't save. Try again." };
  revalidate();
  return { ok: true };
}

export async function updateRoadmapItem(id: string, input: RoadmapItemInput): Promise<Result> {
  await assertAdmin();
  if (!UUID.test(id)) return { ok: false, error: "That item wasn't found." };
  const clean = await cleanInput(input);
  if (!clean.ok) return clean;
  const db = createAdminClient();
  const { data: old } = await db.from("roadmap_items").select("status").eq("id", id).maybeSingle();
  if (!old) return { ok: false, error: "That item wasn't found." };
  const goingLive = clean.row.status === "live" && old.status !== "live";
  const { error } = await db
    .from("roadmap_items")
    .update({ ...clean.row, ...(goingLive && { shipped_in_version: appVersion().version }) })
    .eq("id", id);
  if (error) return { ok: false, error: "That didn't save. Try again." };
  revalidate();
  return { ok: true };
}

// The status buttons on an item. Going live stamps the date (the database
// does) and the release it shipped in.
export async function setRoadmapStatus(id: string, status: RoadmapStatus): Promise<Result> {
  await assertAdmin();
  if (!UUID.test(id) || !isRoadmapStatus(status)) return { ok: false, error: "That item wasn't found." };
  const db = createAdminClient();
  const { data: old } = await db.from("roadmap_items").select("status").eq("id", id).maybeSingle();
  if (!old) return { ok: false, error: "That item wasn't found." };
  if (old.status === status) return { ok: true };
  const { error } = await db
    .from("roadmap_items")
    .update({ status, ...(status === "live" && { shipped_in_version: appVersion().version }) })
    .eq("id", id);
  if (error) return { ok: false, error: "That didn't save. Try again." };
  revalidate();
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

// Managers and up: someone asked for something at the bar. It goes on the
// list as an idea, with who asked, for an owner or admin to move along.
export async function logRoadmapRequest(input: { title: string; details: string; requesterMemberId: string | null; requesterName: string | null }): Promise<Result> {
  await assertManager();
  const title = cleanTitle(input?.title, "Write what they asked for.");
  if (!title.ok) return title;
  const details = cleanText(input?.details, NOTES_MAX);
  if (details === null) return { ok: false, error: "Keep the details to 4,000 characters." };
  const requester = await cleanRequester(input?.requesterMemberId, input?.requesterName);
  if (!requester.ok) return requester;
  const slug = await uniqueSlug(title.title);
  const { error } = await createAdminClient()
    .from("roadmap_items")
    .insert({ slug, title: title.title, internal_notes: details || null, status: "idea", requested_by_member_id: requester.memberId, requested_by_name: requester.name });
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
