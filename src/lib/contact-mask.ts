import type { EmployeeRole } from "@/lib/types";

// How much of a member's contact details a staff login gets to see.
//
// Cashiers find and attach members all shift long, and for that a name, a
// photo and a hint of the email or phone ("is this the right Sarah?") is
// plenty. The full email and phone number are for managers and up, who
// handle billing, refunds and data requests. Searching still matches the
// full details (the database does the matching); only what comes back to a
// cashier's screen is shortened.
//
// Masking happens on the server, before anything reaches the browser: a
// hidden field in a client component is still in the page data.

export function seesFullContact(role: EmployeeRole): boolean {
  return role === "manager" || role === "admin" || role === "owner";
}

// "jane.doe@gmail.com" -> "j•••@gmail.com". Anything that doesn't look like
// an email gets the same treatment on the whole string.
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0) return `${email.slice(0, 1)}•••`;
  return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

// "(417) 555-1234" -> "••1234". Short or odd numbers show only the dots.
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 ? `••${digits.slice(-4)}` : "••";
}

// A copy of a member-shaped row with email and phone shortened for a
// cashier (and the digits-only phone copy some queries carry dropped
// entirely). Managers and up get the row back untouched.
export function contactForRole<T extends { email?: string | null; phone?: string | null }>(row: T, role: EmployeeRole): T {
  if (seesFullContact(role)) return row;
  const masked: T = { ...row, email: maskEmail(row.email), phone: maskPhone(row.phone) };
  if ("phone_digits" in masked) delete (masked as { phone_digits?: unknown }).phone_digits;
  return masked;
}
