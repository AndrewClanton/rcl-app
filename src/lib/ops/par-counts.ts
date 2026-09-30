import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDay, businessDayWindow } from "./time";

// Par counts are saved a section at a time (candy at 9:11, the bar at
// 9:22), so "the count" is never one save: it's each item's latest line.
// Everything that reads counts goes through here.

export interface LatestLine {
  itemId: string;
  qty: number;
  par: number | null; // the par when it was counted
  countId: string;
  at: string;
  by: string | null; // employee id
}

// Each item's latest count line saved in [since, before). Either end open.
export async function latestLines(range: { since?: string | null; before?: string | null } = {}): Promise<Map<string, LatestLine>> {
  const { data, error } = await createAdminClient().rpc("par_latest_lines", { p_since: range.since ?? null, p_before: range.before ?? null });
  if (error) throw new Error(`Couldn't read the par counts: ${error.message}`);
  type Row = { item_id: string; qty: number | string; par_qty: number | string | null; count_id: string; completed_at: string; counted_by: string | null };
  return new Map(
    ((data ?? []) as Row[]).map((r) => [
      r.item_id,
      { itemId: r.item_id, qty: Number(r.qty), par: r.par_qty === null ? null : Number(r.par_qty), countId: r.count_id, at: r.completed_at, by: r.counted_by },
    ]),
  );
}

// The count that stands right now: every line counted this business day
// (4 a.m. to 4 a.m.), the latest one per item. With nothing counted yet
// today, each item's latest line ever.
export async function currentLines(now = new Date()): Promise<{ today: boolean; date: string; start: string; lines: Map<string, LatestLine> }> {
  const { date } = businessDay(now);
  const { start } = businessDayWindow(date);
  const today = await latestLines({ since: start });
  if (today.size) return { today: true, date, start, lines: today };
  return { today: false, date, start, lines: await latestLines() };
}

// The saves a set of lines came from, oldest first.
export function countsOf(lines: Iterable<LatestLine>, names: Map<string, string>): { id: string; at: string; byName: string | null }[] {
  const seen = new Map<string, { id: string; at: string; byName: string | null }>();
  for (const l of lines) if (!seen.has(l.countId)) seen.set(l.countId, { id: l.countId, at: l.at, byName: l.by ? (names.get(l.by) ?? null) : null });
  return [...seen.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
