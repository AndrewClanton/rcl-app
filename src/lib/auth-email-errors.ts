// Plain words for Supabase's answer to a password reset email request, for
// the sign-in page (browser) and the Back office (server) alike.

export const TOO_MANY_EMAILS = "Too many emails just now, try again in a minute.";

export function plainResetError(error: { status?: number; code?: string; message?: string }): string {
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") return TOO_MANY_EMAILS;
  // "For security purposes, you can only request this after N seconds":
  // a second email to the same address within a minute.
  if (/after \d+ seconds?/i.test(error.message ?? "")) return TOO_MANY_EMAILS;
  if (error.code === "email_address_invalid" || error.code === "email_address_not_authorized") return "That email address was turned down. Check it's a real address.";
  return "Couldn't send the email just now. Try again in a minute.";
}
