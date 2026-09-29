import { SITE_URL } from "@/lib/site";

// The address of a "claim your account" link (see lib/member-claim.ts), in
// one place for the server that makes them and the screens that show them.
// No server APIs here, so the customer tablet can check a link too.

export const CLAIM_PATH = "/account/claim";

// A claim token is a fixed-size signed value in base64url (member-claim-token.ts).
const TOKEN = /^[A-Za-z0-9_-]{40,80}$/;

export function claimUrl(token: string): string {
  return `${SITE_URL}${CLAIM_PATH}?t=${token}`;
}

// A claim link on this site and nothing else. The tablet and the receipt
// only ever turn one of these into a QR code, so a stray or tampered
// message can't put some other address in front of a customer.
export function isClaimUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const prefix = `${SITE_URL}${CLAIM_PATH}?t=`;
  return url.startsWith(prefix) && TOKEN.test(url.slice(prefix.length));
}

// Whether a path on this site (already cleaned by safePath) is the claim
// page, for /account/callback: the claim page does its own linking.
export function isClaimPath(path: string): boolean {
  return path === CLAIM_PATH || path.startsWith(`${CLAIM_PATH}?`);
}
