import { createClient } from "@/lib/supabase/server";
import type { Screening } from "@/lib/types";

// Upcoming screenings (now and later), soonest first, with movie + room joined.
export async function getUpcomingScreenings(): Promise<Screening[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("screenings")
    .select("*, movie:movies(*), room:rooms(*, addons:room_addons(*))")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at");

  if (error) throw error;
  return (data ?? []) as unknown as Screening[];
}
