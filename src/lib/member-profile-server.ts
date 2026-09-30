import "server-only";
import { cache } from "react";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";
import { visitSummary } from "@/lib/visits-server";
import { isShared, isValidHandle, normalizeHandle, toPublicProfile, type ProfileMemberRow, type PublicProfile, type SeenRow } from "@/lib/member-profile";

// The shared profile page's reads (lib/member-profile.ts has the rules).
// Everything goes through the service role and comes back whitelisted: the
// page, its link preview and its photo never see the members row itself.

type SharedRow = ProfileMemberRow & { id: string };

// The member whose page this handle is, if it's shared. `*` rather than a
// column list: before the member_profiles migration there's no
// profile_handle, the query fails, and every page is simply not found.
async function sharedMember(raw: string): Promise<SharedRow | null> {
  const handle = normalizeHandle(safeDecode(raw));
  if (!isValidHandle(handle)) return null;
  const { data, error } = await createAdminClient()
    .from("members")
    .select("*")
    .eq("profile_handle", handle)
    .eq("share_profile", true)
    .is("profile_hidden_at", null)
    .is("erased_at", null)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as SharedRow;
  return isShared(row) ? row : null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return "";
  }
}

// Past screenings they had confirmed tickets for. Only `bookings`: private
// events (the events table) and booths are never part of it.
async function seenScreenings(memberId: string, now: Date): Promise<SeenRow[]> {
  const { data, error } = await createAdminClient()
    .from("bookings")
    .select("screening:screenings(id, starts_at, movie:movies(id, title, poster_url, release_year))")
    .eq("member_id", memberId)
    .eq("status", "confirmed")
    .limit(2000);
  if (error) return [];
  type Row = { screening: { id: string; starts_at: string; movie: { id: string; title: string; poster_url: string | null; release_year: number | null } | null } | null };
  return ((data ?? []) as unknown as Row[]).flatMap((r) => {
    const s = r.screening;
    if (!s?.movie || Date.parse(s.starts_at) > now.getTime()) return [];
    return [{ screeningId: s.id, movieId: s.movie.id, title: s.movie.title, posterUrl: s.movie.poster_url, releaseYear: s.movie.release_year, startsAt: s.starts_at }];
  });
}

// The page, or null (no such handle, sharing off, turned off by staff):
// all of those look the same from outside. Cached per request, so the
// page, its metadata and its link preview share one lookup.
export const getPublicProfile = cache(async (handle: string): Promise<PublicProfile | null> => {
  const m = await sharedMember(handle);
  if (!m) return null;
  const now = new Date();
  const [summary, seen] = await Promise.all([visitSummary(m.id, now).catch(() => null), seenScreenings(m.id, now)]);
  return toPublicProfile(
    m,
    {
      visits: summary?.visits ?? 0,
      weekStreak: summary?.weekStreak ?? 0,
      badges: (summary?.badges ?? []).map((b) => ({ key: b.key, period: b.period, earnedAt: b.earnedAt })),
      seen,
    },
    now,
  );
});

const AVATAR_MARKER = "/storage/v1/object/public/member-avatars/";

// Their photo for the shared page, re-encoded: a square JPEG with the
// camera's metadata (and any location in it) stripped. Only a photo in our
// own member-avatars bucket; anything else and the page shows their
// initial. Null if the page isn't shared.
export async function getProfilePhoto(handle: string, size = 480): Promise<Buffer | null> {
  const m = await sharedMember(handle);
  const url = m?.avatar_url;
  const at = url?.indexOf(AVATAR_MARKER) ?? -1;
  if (!url || at < 0) return null;
  const path = decodeURIComponent(url.slice(at + AVATAR_MARKER.length).split("?")[0]);
  const { data, error } = await createAdminClient().storage.from("member-avatars").download(path);
  if (error || !data) return null;
  try {
    return await sharp(Buffer.from(await data.arrayBuffer()))
      .rotate()
      .resize(size, size, { fit: "cover", position: "attention" })
      .flatten({ background: "#14110c" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    return null;
  }
}
