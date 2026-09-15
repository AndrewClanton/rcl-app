import { createAdminClient } from "@/lib/supabase/admin";
import type { Member } from "@/lib/types";

// Members has no public-read RLS policy (unlike movies/menu/rooms) since
// it holds contact info -- always read via the service-role client. Only
// call this from admin/staff-only surfaces.
export async function getMembers(): Promise<Member[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("members").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}
