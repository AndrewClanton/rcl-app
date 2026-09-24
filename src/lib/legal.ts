import "server-only";
import { getStaffSession, hasAdminAccess } from "@/lib/auth";

// The privacy policy and data deletion pages are drafts until Andrew
// approves them. Until then only a signed-in admin can open them (everyone
// else gets a 404) and they aren't linked anywhere. To publish: set
// LEGAL_PAGES_PUBLISHED to true and fill in LEGAL_EFFECTIVE_DATE.
export const LEGAL_PAGES_PUBLISHED = false;
export const LEGAL_EFFECTIVE_DATE: string | null = null; // e.g. "October 1, 2026"

export async function canViewLegalPages(): Promise<boolean> {
  if (LEGAL_PAGES_PUBLISHED) return true;
  const staff = await getStaffSession();
  return !!staff && hasAdminAccess(staff.role);
}
