import type { createClient } from "@/lib/supabase/client";

type Client = ReturnType<typeof createClient>;
type Channel = ReturnType<Client["channel"]>;
type OnStatus = Parameters<Channel["subscribe"]>[0];

// Every Realtime channel this app opens is private. Realtime lets a client
// join one (and send on it) only when the policies on realtime.messages
// allow its signed-in user: an active employee, display screens included
// (supabase/migrations/20260929233000_private_realtime_channels.sql). With
// the project's "Allow public access" Realtime setting off, a public channel
// can't connect at all, so a new channel needs this config and a policy for
// its topic in that migration's style.
export const PRIVATE_CHANNEL = { config: { private: true } };

// Private channels need the signed-in user's token on the socket before
// joining (Supabase's docs: `await supabase.realtime.setAuth()` first);
// otherwise the join can go out on the public key alone and be refused.
// Never rejects, so a caller waiting on it always goes on to subscribe.
// Later token refreshes reach open channels through supabase-js itself.
export function realtimeReady(supabase: Client): Promise<void> {
  return supabase.realtime.setAuth().catch(() => undefined);
}

// Subscribes a private channel once realtimeReady() has resolved. Returns
// the effect's cleanup: it removes the channel, and a subscribe still
// waiting on the token then never happens.
export function subscribePrivate(supabase: Client, channel: Channel, onStatus?: OnStatus): () => void {
  let removed = false;
  realtimeReady(supabase).then(() => {
    if (!removed) channel.subscribe(onStatus);
  });
  return () => {
    removed = true;
    supabase.removeChannel(channel);
  };
}
