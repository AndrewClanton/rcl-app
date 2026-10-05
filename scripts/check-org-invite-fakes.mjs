// In-memory stand-ins for scripts/check-org-invite.mjs: the email marketing
// fakes (Supabase service-role client, Resend as a fetch, a signed-in staff
// login) plus next/headers and the organization tables. Nothing is sent.
import { db } from "./check-email-marketing-fakes.mjs";

export * from "./check-email-marketing-fakes.mjs";

db.organizations ??= [];
db.org_invite_sends ??= [];

export async function headers() {
  return new Headers({ host: "royale.test", "x-forwarded-proto": "https" });
}
