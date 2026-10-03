// Phone accounts (Andrew, 10/2): an account that's just a phone number. Many
// older guests will never want a password, an email login or a website
// account; they know their number. They type it at the check-in tablet (or
// staff make one at the register) and collect points like anyone else, and
// may add a name on a later visit.
//
// Such an account is saved with an empty name (the column is not null) and
// no email. Wherever staff or the tablet would show a name, they get
// "Guest ·· 0199" instead: the last four of the phone, never more. The
// helpers that pick a first name or "Sarah M." out of a name hand that
// label back whole, so it never turns into "Guest" or "Guest 0.".

const GUEST = /^Guest ·· \d{4}$/;

// "Guest ·· 0199", or "Guest" with no usable phone.
export function guestName(phone: string | null | undefined): string {
  const d = (phone ?? "").replace(/\D/g, "").slice(-4);
  return d.length === 4 ? `Guest ·· ${d}` : "Guest";
}

// A label from guestName (never a real name: those are letters only).
export function isGuestName(name: string | null | undefined): boolean {
  return GUEST.test((name ?? "").trim());
}

// Whether a name was given at all.
export function hasName(name: string | null | undefined): boolean {
  return !!(name ?? "").trim();
}

// Their name, or "Guest ·· 0199" when the account has none.
export function memberLabel(name: string | null | undefined, phone: string | null | undefined): string {
  return (name ?? "").trim() || guestName(phone);
}

// A phone account: no email and no website login, so nothing reaches them
// but what's said at the door (no setup links, no list email, no QR code
// pushed at them on the tablet).
export function isPhoneAccount(m: { email?: string | null; auth_user_id?: string | null; hasLogin?: boolean }): boolean {
  return !(m.email ?? "").trim() && !m.auth_user_id && !m.hasLogin;
}
