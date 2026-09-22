import { createAdminClient } from "@/lib/supabase/admin";
import type { DevNote } from "@/lib/types";

const DEV_NOTE_SELECT = "id, page_path, page_title, message, status, created_at, updated_at, submitted_by:employees(name)";

export async function getDevNotes(): Promise<DevNote[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("dev_notes").select(DEV_NOTE_SELECT).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as DevNote[];
}

export async function getOpenDevNoteCount(): Promise<number> {
  const supabase = createAdminClient();
  const { count, error } = await supabase.from("dev_notes").select("id", { count: "exact", head: true }).eq("status", "new");
  if (error) throw error;
  return count ?? 0;
}
