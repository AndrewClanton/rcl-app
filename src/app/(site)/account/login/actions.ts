"use server";

import { connectionKey } from "@/lib/public-form-guard";
import { signInHelpForEmail, type PublicHelp } from "@/lib/sign-in-help";

// "Forgot password or first time here?" on the sign-in page: what to send
// for this email (lib/sign-in-help.ts), limited per connection and per
// address. Anyone can call it, so it says no more than the page shows.
export async function askSignInHelp(email: string): Promise<PublicHelp> {
  return signInHelpForEmail(String(email ?? ""), await connectionKey());
}
