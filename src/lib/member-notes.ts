// Account notes and the "Group / organization" label (Andrew, 10/5): staff
// note things on an account ("With Easter Seals, to go on their corporate
// account later") from the register's press-and-hold panel
// (pos/MemberGlance.tsx) or the member's Back office page (admin/members/
// [id]/NotesBox.tsx). Staff only: never on the customer screen, My Account,
// the profile or emails. Shared by both sides, so nothing here touches the
// database (that's member-notes-server.ts).

export const NOTE_MAX = 500;
export const ORG_MAX = 80;

export interface MemberNote {
  id: string;
  note: string;
  by: string | null; // the employee's name
  at: string;
}

// A note as saved: spaces tidied, at most NOTE_MAX. Empty means nothing.
export function cleanNote(x: unknown): string {
  return String(x ?? "").trim().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").slice(0, NOTE_MAX).trim();
}

// An organization as saved: one line, at most ORG_MAX. Null clears it.
export function cleanOrganization(x: unknown): string | null {
  return String(x ?? "").trim().replace(/\s+/g, " ").slice(0, ORG_MAX).trim() || null;
}
