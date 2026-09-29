import "server-only";
import { createHmac } from "node:crypto";

// The name of the register's live-order channel (register -> customer
// screen). A Realtime broadcast channel can be joined by anyone holding the
// site's public key who knows its name, so the name is a secret derived on
// the server and handed only to the signed-in register and customer-screen
// pages. (The permanent fix is a private channel with an access rule.)
export function registerTopic(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return "register:" + createHmac("sha256", key).update("register-main").digest("hex").slice(0, 32);
}
