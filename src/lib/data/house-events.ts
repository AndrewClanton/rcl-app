import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Trivia night, comedy, the book swap: public happenings that aren't films.
// Shown on the ramp TV next to the screenings; managed on the Showtimes page.
export interface HouseEvent {
  id: string;
  title: string;
  note: string | null;
  starts_at: string;
  ends_at: string | null;
  series?: string | null; // its series tag (lib/event-series.ts)
}

// Events still coming up, plus any that started in the last `minutes`.
export async function getRecentHouseEvents(minutes = 0, limit = 40): Promise<HouseEvent[]> {
  return getHouseEventsSince(new Date(Date.now() - minutes * 60_000).toISOString(), limit);
}

export async function getHouseEventsSince(sinceIso: string, limit = 40): Promise<HouseEvent[]> {
  const { data, error } = await createAdminClient()
    .from("house_events")
    .select("id, title, note, starts_at, ends_at, series")
    .or(`starts_at.gte."${sinceIso}",ends_at.gte."${sinceIso}"`)
    .order("starts_at")
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as HouseEvent[];
}
