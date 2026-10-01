"use server";

import { revalidatePath } from "next/cache";
import { getSignedInMember } from "@/lib/member-auth";
import { allowAttempt } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { tidyText } from "@/lib/member-profile";
import { NOTE_MAX, SUGGESTION_MAX, canVote, isRoadmapStatus, type RoadmapStatus } from "@/lib/roadmap";

// What a signed-in member can do on What's new: say "I want this too",
// send the crew a private note about an item, and suggest something. Each
// one checks the member and the item itself (a Server Action is a public
// endpoint, whatever page it sits on) and is rate limited per member.

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGN_IN = "Sign in to your account first.";
const SLOW_DOWN = "That's a lot at once. Give it a minute and try again.";

// Text from a form: one tidy block, line breaks kept (a note can be a list).
function cleanBody(input: unknown, max: number): string | null {
  if (typeof input !== "string") return null;
  const lines = input.replace(/\r\n?/g, "\n").split("\n").map(tidyText);
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text || [...text].length > max) return null;
  return text;
}

async function publicItem(itemId: unknown) {
  if (typeof itemId !== "string" || !UUID.test(itemId)) return null;
  const { data } = await createAdminClient().from("roadmap_items").select("id, slug, status, is_public").eq("id", itemId).maybeSingle();
  if (!data || !data.is_public || !isRoadmapStatus(data.status)) return null;
  return data as { id: string; slug: string; status: RoadmapStatus; is_public: boolean };
}

function refresh(slug: string) {
  revalidatePath("/whats-new");
  revalidatePath(`/whats-new/${slug}`);
  revalidatePath("/admin/roadmap");
}

// "I want this too", or take it back. Returns the new count.
export async function toggleRoadmapVote(itemId: string): Promise<Result<{ voted: boolean; votes: number }>> {
  const member = await getSignedInMember();
  if (!member) return { ok: false, error: SIGN_IN };
  if (!(await allowAttempt(`roadmap:vote:${member.id}`, 30, 60))) return { ok: false, error: SLOW_DOWN };
  const item = await publicItem(itemId);
  if (!item) return { ok: false, error: "That item isn't on the list any more." };
  const db = createAdminClient();
  const { data: existing } = await db.from("roadmap_votes").select("item_id").eq("item_id", item.id).eq("member_id", member.id).maybeSingle();
  let voted: boolean;
  if (existing) {
    const { error } = await db.from("roadmap_votes").delete().eq("item_id", item.id).eq("member_id", member.id);
    if (error) return { ok: false, error: "That didn't go through. Try again." };
    voted = false;
  } else {
    if (!canVote(item.status)) return { ok: false, error: "This one is already done." };
    const { error } = await db.from("roadmap_votes").upsert({ item_id: item.id, member_id: member.id }, { onConflict: "item_id,member_id", ignoreDuplicates: true });
    if (error) return { ok: false, error: "That didn't go through. Try again." };
    voted = true;
  }
  const { count } = await db.from("roadmap_votes").select("item_id", { count: "exact", head: true }).eq("item_id", item.id);
  refresh(item.slug);
  return { ok: true, voted, votes: count ?? 0 };
}

// A private note to the crew about one item. Never shown publicly.
export async function sendRoadmapNote(itemId: string, body: string): Promise<Result> {
  const member = await getSignedInMember();
  if (!member) return { ok: false, error: SIGN_IN };
  const text = cleanBody(body, NOTE_MAX);
  if (!text) return { ok: false, error: `Write a note (up to ${NOTE_MAX} characters).` };
  if (!(await allowAttempt(`roadmap:note:${member.id}`, 5, 600))) return { ok: false, error: SLOW_DOWN };
  if (!(await allowAttempt(`roadmap:note-day:${member.id}`, 20, 86_400))) return { ok: false, error: "That's plenty of notes for today. Thank you! Try again tomorrow." };
  const item = await publicItem(itemId);
  if (!item) return { ok: false, error: "That item isn't on the list any more." };
  const { error } = await createAdminClient().from("roadmap_notes").insert({ item_id: item.id, member_id: member.id, body: text });
  if (error) return { ok: false, error: "That didn't send. Try again." };
  revalidatePath("/admin/roadmap");
  return { ok: true };
}

// "Suggest something": lands in Back office → Roadmap's inbox.
export async function suggestRoadmapIdea(input: { body: string; creditOk: boolean }): Promise<Result> {
  const member = await getSignedInMember();
  if (!member) return { ok: false, error: SIGN_IN };
  const text = cleanBody(input?.body, SUGGESTION_MAX);
  if (!text) return { ok: false, error: `Tell us your idea (up to ${SUGGESTION_MAX} characters).` };
  if (!(await allowAttempt(`roadmap:suggest:${member.id}`, 3, 600))) return { ok: false, error: SLOW_DOWN };
  if (!(await allowAttempt(`roadmap:suggest-day:${member.id}`, 10, 86_400))) return { ok: false, error: "That's plenty of ideas for today. Thank you! Send more tomorrow." };
  const { error } = await createAdminClient()
    .from("roadmap_suggestions")
    .insert({ member_id: member.id, body: text, credit_ok: input?.creditOk === true });
  if (error) return { ok: false, error: "That didn't send. Try again." };
  revalidatePath("/whats-new");
  revalidatePath("/admin/roadmap");
  return { ok: true };
}
