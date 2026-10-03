import "server-only";
import { checkinTopic } from "@/lib/checkin";
import { registerTopic } from "@/lib/register-topic";

// A message from the server to the customer tablet at the bar, on the
// check-in channel (lib/checkin.ts) the tablet already listens to. Used by
// Back office pages that aren't the register (Rewind's "give these points
// now"), so the channel's secret name never leaves the server.
//
// Realtime's broadcast-over-HTTP endpoint: no socket to open and close.
// Best effort by design: a tablet that's off or a slow network returns
// false within a few seconds, and whatever the caller did still stands.
export async function sendToTablet(event: string, payload: Record<string, unknown>): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic: checkinTopic(registerTopic()), event, payload }] }),
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    await res.body?.cancel().catch(() => {});
    return res.ok;
  } catch {
    return false;
  }
}
