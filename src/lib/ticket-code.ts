import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// The code in an online ticket's QR, which the register scans to print the
// keepsake tickets (lib/ticket-scan.ts):
//
//   RCLT:<booking id, 32 hex digits, no dashes>.<16 hex digit signature>
//
// The signature is an HMAC of the booking id under a key only the server
// has (derived from the service key, like the register's channel name in
// register-topic.ts), cut to 64 bits. Without that key nobody can make a
// code for a booking, or turn one booking's code into another's, and the
// register refuses a burst of wrong guesses on top of that.
//
// It's all upper case on purpose. "RCLT:", hex digits and "." are all in a
// QR code's compact alphanumeric set, so the 54 characters fit a version 3
// code (29 x 29 squares): small and quick to scan off a phone. And a scanner
// typing with Caps Lock on still works, since reading ignores case.

const PREFIX = "RCLT:";
const SIG_LENGTH = 16;
const CODE = /^RCLT:([0-9A-F]{32})\.([0-9A-F]{16})$/;
const BOOKING_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

function key(): Buffer {
  // Fail closed: with no secret, a code could be made by anyone.
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createHmac("sha256", secret).update("ticket-code-v1").digest();
}

// hex: the booking id as 32 lower-case hex digits.
function signature(hex: string): string {
  return createHmac("sha256", key()).update(`booking:${hex}`).digest("hex").slice(0, SIG_LENGTH).toUpperCase();
}

export function ticketCode(bookingId: string): string {
  if (!BOOKING_ID.test(bookingId)) throw new Error("Not a booking id");
  const hex = bookingId.replace(/-/g, "").toLowerCase();
  return `${PREFIX}${hex.toUpperCase()}.${signature(hex)}`;
}

// The booking id (with dashes, lower case) a scanned code is for, or null
// if it isn't a ticket code or its signature doesn't match.
export function readTicketCode(text: string): string | null {
  const m = text.trim().toUpperCase().match(CODE);
  if (!m) return null;
  const hex = m[1].toLowerCase();
  let expected: string;
  try {
    expected = signature(hex);
  } catch {
    return null;
  }
  if (!timingSafeEqual(Buffer.from(m[2]), Buffer.from(expected))) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
