import { createAdminClient } from "@/lib/supabase/admin";
import type { CommunityProgram, Member } from "@/lib/types";

// Members has no public-read RLS policy (unlike movies/menu/rooms) since
// it holds contact info -- always read via the service-role client. Only
// call this from admin/staff-only surfaces.
export async function getMembers(): Promise<Member[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("members").select("*, community_program:community_programs(name)").order("name");
  if (error) throw error;
  return (data ?? []) as unknown as Member[];
}

export async function getCommunityPrograms(): Promise<CommunityProgram[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("community_programs").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}
