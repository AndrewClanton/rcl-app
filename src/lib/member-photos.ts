import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Member photos live in the public member-avatars bucket, named
// `<memberId>-<timestamp>.<ext>` after the account that uploaded them
// (account/actions.ts). A merge can leave a member's photo named after the
// account merged into it, so removing someone's photos goes by every id
// they've had (member_merges), not only their own.

export const MEMBER_PHOTO_BUCKET = "member-avatars";
const MARKER = `/storage/v1/object/public/${MEMBER_PHOTO_BUCKET}/`;

// The stored file behind an avatar_url, or null for anything that isn't in
// our bucket (nothing of ours to delete).
export function memberPhotoPath(url: string | null | undefined): string | null {
  const at = url?.indexOf(MARKER) ?? -1;
  if (!url || at < 0) return null;
  return decodeURIComponent(url.slice(at + MARKER.length).split("?")[0]) || null;
}

// Deletes the stored photo files named after any of these member ids, plus
// any `extra` paths, except `keep`. `ok` is false if storage wouldn't list
// or delete them (the caller says so; nothing else depends on it).
export async function removeMemberPhotos(
  ids: string[],
  { extra = [], keep = null }: { extra?: (string | null)[]; keep?: string | null } = {},
): Promise<{ removed: number; ok: boolean }> {
  const bucket = createAdminClient().storage.from(MEMBER_PHOTO_BUCKET);
  const names = new Set<string>(extra.filter((p): p is string => !!p));
  let ok = true;
  const lists = await Promise.all(ids.map((id) => bucket.list("", { search: id, limit: 100 })));
  lists.forEach(({ data, error }, i) => {
    if (error) ok = false;
    for (const f of data ?? []) if (f.name.startsWith(ids[i])) names.add(f.name);
  });
  if (keep) names.delete(keep);
  if (!names.size) return { removed: 0, ok };
  const { error } = await bucket.remove([...names]);
  return error ? { removed: 0, ok: false } : { removed: names.size, ok };
}
