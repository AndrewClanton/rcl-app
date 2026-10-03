import { SITE_URL } from "@/lib/site";

// The address of a "finish your Insiders+ on your phone" link: staff make
// one at the register for a member (pos/legacy-plus-actions.ts), and it
// opens Stripe's card page already tied to that member's account
// (/membership/finish). No server APIs here, so the customer tablet can
// check a link before turning it into a QR code.

export const PLUS_FINISH_PATH = "/membership/finish";

// A finish token is a fixed-size signed value in base64url (plus-finish-token.ts).
const TOKEN = /^[A-Za-z0-9_-]{40,60}$/;

export function plusFinishUrl(token: string): string {
  return `${SITE_URL}${PLUS_FINISH_PATH}?t=${token}`;
}

// A finish link on this site and nothing else: a stray or tampered message
// can't put some other address in front of a customer.
export function isPlusFinishUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const prefix = `${SITE_URL}${PLUS_FINISH_PATH}?t=`;
  return url.startsWith(prefix) && TOKEN.test(url.slice(prefix.length));
}
