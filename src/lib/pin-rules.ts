// PIN rules shared by the screens (to explain a problem before saving) and
// the server (which has the final say). No crypto here, so the browser can
// use it too -- hashing lives in src/lib/pin.ts, the checks in
// src/lib/manager-pin.ts.

// Every staff account started with this PIN. It keeps working for anyone
// who hasn't picked their own yet, so nothing breaks while the team
// switches over; the back office nags them until they do.
export const DEFAULT_PIN = "9999";

// 4 to 6 digits. Checks the type too: a Server Action's arguments come
// from the browser and could be anything.
export function isPinShaped(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4,6}$/.test(pin);
}

// Why a new PIN can't be used, or null when it's fine. 9999, 0000, 1234 and
// the like are the first things anyone would try.
export function pinProblem(pin: string): string | null {
  if (!isPinShaped(pin)) return "A PIN is 4 to 6 digits, numbers only.";
  if (pin === DEFAULT_PIN) return "That's the old shared PIN everyone knows. Pick your own.";
  if (/^(\d)\1+$/.test(pin)) return "Too easy to guess: that's the same digit over and over.";
  const d = [...pin].map(Number);
  const up = d.every((n, i) => i === 0 || n === d[i - 1] + 1);
  const down = d.every((n, i) => i === 0 || n === d[i - 1] - 1);
  if (up || down) return "Too easy to guess: that's counting up or down, like 1234.";
  return null;
}

// Who approved something with a manager PIN. approvedBy is the first name
// of the manager whose PIN matched, or null when more than one manager has
// that PIN (everyone still on 9999, say), so there's no telling who.
export interface Approval {
  approvedBy: string | null;
  defaultPin: boolean; // approved with 9999, which everyone knows
}

export type ApprovalResult = ({ ok: true } & Approval) | { ok: false; error: string };

// The line shown after an approval goes through.
export function approvalText(a: Approval): string {
  if (a.defaultPin) {
    return a.approvedBy
      ? `Approved with ${a.approvedBy}'s PIN, which is still 9999. ${a.approvedBy}: set your own under My PIN in the back office.`
      : "Approved with the old 9999 PIN, so there's no name on it. Managers: set your own under My PIN in the back office.";
  }
  return a.approvedBy ? `Approved by ${a.approvedBy}.` : "Approved.";
}
