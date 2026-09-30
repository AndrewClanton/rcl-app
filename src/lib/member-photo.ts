import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Members' profile photos: shown on the customer-facing kiosk after a phone
// lookup, and on their account. They live in the public member-avatars
// bucket as "<member id>-<timestamp>.<ext>", uploaded by the member (or
// copied from their Google account) in (site)/account/actions.ts.

// Photos only (no SVG, which can carry script), with the extension each is
// stored under. The stored name comes from this list, never from the
// uploaded file's name or whatever type a server claims.
export const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

// Removing or replacing a photo deletes the stored file too, so the old
// picture doesn't stay reachable at its address. Only that member's own
// files are touched. True when there was nothing to delete or it's gone;
// false when storage refused (the file is then still up).
export async function deleteStoredPhoto(url: string | null | undefined, memberId: string): Promise<boolean> {
  const marker = "/storage/v1/object/public/member-avatars/";
  const at = url?.indexOf(marker) ?? -1;
  if (!url || at < 0) return true;
  let path: string;
  try {
    path = decodeURIComponent(url.slice(at + marker.length).split("?")[0]);
  } catch {
    return true;
  }
  if (!path.startsWith(`${memberId}-`) || path.includes("/")) return true;
  const { error } = await createAdminClient()
    .storage.from("member-avatars")
    .remove([path])
    .catch((e: unknown) => ({ error: e }));
  return !error;
}
