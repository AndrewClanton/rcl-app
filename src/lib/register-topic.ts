import "server-only";
import { createHmac } from "node:crypto";

// The name of the register's live-order channel (register -> customer
// screen). The channel is private (lib/supabase/realtime.ts): Realtime only
// lets a signed-in active employee or display screen join it. The name is
// also a secret derived on the server and handed only to the signed-in
// register and customer-screen pages, as a second lock.
export function registerTopic(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return "register:" + createHmac("sha256", key).update("register-main").digest("hex").slice(0, 32);
}
