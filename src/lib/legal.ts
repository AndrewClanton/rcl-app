import "server-only";
import { getStaffSession, hasAdminAccess } from "@/lib/auth";

// The privacy policy and data deletion pages. Andrew approved publishing them
// on September 24, 2026 (Meta requires both to be public for Facebook
// sign-in). While LEGAL_PAGES_PUBLISHED is false, only a signed-in admin can
// open them and they aren't linked anywhere. When the text changes, update
// LEGAL_EFFECTIVE_DATE.
export const LEGAL_PAGES_PUBLISHED = true;
export const LEGAL_EFFECTIVE_DATE: string | null = "October 1, 2026";

// The terms of service (/terms), written 10/1/2026 for Meta's app settings.
// Andrew approved publishing it on 10/1/2026 ("do all the steps").
export const TERMS_PUBLISHED = true;
export const TERMS_EFFECTIVE_DATE: string | null = "October 1, 2026";

export async function canViewTerms(): Promise<boolean> {
  if (TERMS_PUBLISHED) return true;
  const staff = await getStaffSession();
  return !!staff && hasAdminAccess(staff.role);
}

export async function canViewLegalPages(): Promise<boolean> {
  if (LEGAL_PAGES_PUBLISHED) return true;
  const staff = await getStaffSession();
  return !!staff && hasAdminAccess(staff.role);
}
