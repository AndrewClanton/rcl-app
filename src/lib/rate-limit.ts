import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Per-server fallback: used until the rate_limit_hits migration
// (20260929200000) is applied, or if the database can't be asked. Weaker --
// each server instance counts on its own -- but the limit still holds on the
// one answering.
const memory = new Map<string, number[]>();

function memoryHit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const hits = (memory.get(key) ?? []).filter((t) => now - t < windowMs);
  const allowed = hits.length < max;
  if (allowed) hits.push(now);
  memory.set(key, hits);
  return allowed;
}

// Records one attempt under `key` and says whether it's allowed: false once
// `max` attempts have landed in the last `windowSeconds`. Refused attempts
// don't count against the next window.
export async function allowAttempt(key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", { p_key: key, p_max: max, p_window_seconds: windowSeconds });
    if (!error && typeof data === "boolean") return data;
  } catch {
    // fall through to the per-server count
  }
  return memoryHit(key, max, windowSeconds * 1000);
}

export const TOO_MANY_TRIES = "Too many tries just now. Ask a staff member, or try again in a minute.";
