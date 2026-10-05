import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanNote, cleanOrganization, type MemberNote } from "@/lib/member-notes";

// Account notes and the organization label (lib/member-notes.ts; the table
// is supabase/migrations/20261005030000_member_notes.sql). Server-only: the
// register and Back office reach these through their own staff-checked
// server actions. Nothing customer-facing calls these.

const SELECT = "id, note, created_at, writer:employees!member_notes_created_by_fkey(name)";

type Named = { name: string } | { name: string }[] | null;
const nameOf = (e: Named) => (Array.isArray(e) ? e[0]?.name : e?.name) ?? null;

function toNote(r: Record<string, unknown>): MemberNote {
  return { id: r.id as string, note: r.note as string, by: nameOf(r.writer as Named), at: r.created_at as string };
}

// A member's notes, newest first. Empty when there are none or they
// couldn't be read (say, before the migration).
export async function memberNotes(memberId: string, limit = 50): Promise<MemberNote[]> {
  const { data, error } = await createAdminClient()
    .from("member_notes")
    .select(SELECT)
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as unknown as Record<string, unknown>[]).map(toNote);
}

// Saves a note by an employee (or none). Null if it couldn't be saved.
export async function addNote(memberId: string, text: string, by: string | null): Promise<MemberNote | null> {
  const note = cleanNote(text);
  if (!note) return null;
  const { data, error } = await createAdminClient().from("member_notes").insert({ member_id: memberId, note, created_by: by }).select(SELECT).single();
  if (error || !data) {
    if (error) console.error("addNote:", error.code, error.message);
    return null;
  }
  return toNote(data as unknown as Record<string, unknown>);
}

// A member's organization label, or null.
export async function memberOrganization(memberId: string): Promise<string | null> {
  const { data } = await createAdminClient().from("members").select("organization").eq("id", memberId).maybeSingle();
  return (data?.organization as string | null | undefined) ?? null;
}

// Sets (or, with an empty value, clears) the label. An organization already
// used with other capitals ("easter seals") is saved as it's spelled there,
// so the Members filter finds everyone. Undefined if it couldn't be saved.
export async function setOrganization(memberId: string, value: unknown): Promise<string | null | undefined> {
  let org = cleanOrganization(value);
  const db = createAdminClient();
  if (org) {
    const same = (await organizationsInUse()).find((o) => o.toLowerCase() === org!.toLowerCase());
    if (same) org = same;
  }
  const { data, error } = await db.from("members").update({ organization: org }).eq("id", memberId).is("erased_at", null).select("id");
  if (error || !data?.length) {
    if (error) console.error("setOrganization:", error.code, error.message);
    return undefined;
  }
  return org;
}

// Every organization in use, most members first: the register's
// suggestions and the Members filter.
export async function organizationsInUse(): Promise<string[]> {
  const { data, error } = await createAdminClient().from("members").select("organization").not("organization", "is", null).is("erased_at", null).limit(5000);
  if (error || !data) return [];
  const counts = new Map<string, number>();
  for (const r of data) {
    const o = r.organization as string;
    counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([o]) => o);
}

// The organization of each of these members that has one.
export async function organizationsAmong(memberIds: string[]): Promise<Map<string, string>> {
  if (!memberIds.length) return new Map();
  const { data, error } = await createAdminClient().from("members").select("id, organization").in("id", memberIds.slice(0, 200)).not("organization", "is", null);
  if (error || !data) return new Map();
  return new Map(data.map((r) => [r.id as string, r.organization as string]));
}
