// "Flag suspicious activity" (Andrew, 10/2): staff flag an account from the
// register's press-and-hold panel (pos/MemberGlance.tsx) instead of
// reversing anything there; an admin or owner looks at it on the member's
// Back office page (admin/members/[id]/FlagBox.tsx). Shared by both sides,
// so nothing here touches the database (that's member-flags-server.ts).

export const FLAG_REASONS = {
  someone_elses_number: "Used someone else's number",
  not_here: "Checked in without being here",
  other: "Other",
} as const;

export type FlagReason = keyof typeof FLAG_REASONS;

export const FLAG_REASON_KEYS = Object.keys(FLAG_REASONS) as FlagReason[];

export const FLAG_NOTE_MAX = 280;

export function isFlagReason(x: unknown): x is FlagReason {
  return typeof x === "string" && Object.prototype.hasOwnProperty.call(FLAG_REASONS, x);
}

// One flag, with staff by name. visitId: the check-in it was about, while
// it's still there (taking back its points removes it); visitDate stays.
export interface MemberFlag {
  id: string;
  memberId: string;
  reason: FlagReason;
  note: string | null;
  visitId: string | null;
  visitDate: string | null;
  flaggedBy: string | null;
  flaggedAt: string;
  takenBackBy: string | null;
  takenBackAt: string | null;
  takenBackPoints: number | null;
  clearedBy: string | null;
  clearedAt: string | null;
}

// "6:42 PM" today, "Oct 2, 6:42 PM" another day (the register's clock).
export function flagTime(iso: string, now = new Date()): string {
  const tz = "America/Chicago";
  const day = (d: Date) => d.toLocaleDateString("en-US", { timeZone: tz });
  const at = new Date(iso);
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  return day(at) === day(now) ? time : `${at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz })}, ${time}`;
}
