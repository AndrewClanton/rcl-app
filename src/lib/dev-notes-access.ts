import { hasAdminAccess, type StaffSession } from "@/lib/auth";
import { isRegisterLogin } from "@/lib/tip-split";

// Who gets the Dev Notes widget and can send a note: admins and owners,
// plus the register iPad's shared "Royale Cinema Lounge" login whatever
// its role, so it can drop to cashier without losing the widget. Reviewing
// notes (/admin/dev-notes) stays admin-only.
export function canLeaveDevNotes(session: Pick<StaffSession, "name" | "role">): boolean {
  return hasAdminAccess(session.role) || isRegisterLogin(session);
}
