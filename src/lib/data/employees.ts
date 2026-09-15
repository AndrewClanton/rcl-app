import { createAdminClient } from "@/lib/supabase/admin";
import type { Employee } from "@/lib/types";

// No public-read RLS policy on employees -- always read via service role.
export async function getActiveEmployees(): Promise<Employee[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("employees").select("id, name, role, active").eq("active", true).order("name");
  if (error) throw error;
  return data ?? [];
}
