import "server-only";
import { createHash } from "node:crypto";
import { cache } from "react";
import { headers } from "next/headers";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";
import { allowAttempt } from "@/lib/rate-limit";
import { badgeFor } from "@/lib/visits";
import { memberCards, type BadgeCard } from "@/lib/badges/server";
import {
  beforeToday,
  isShared,
  isValidHandle,
  normalizeHandle,
  profileAsOf,
  toPublicProfile,
  type EarnedBadgeRow,
  type ProfileMemberRow,
  type PublicProfile,
  type SeenRow,
} from "@/lib/member-profile";

// The shared profile page's reads (lib/member-profile.ts has the rules).
// Everything goes through the service role and comes back whitelisted: the
// page, its link preview and its photo never see the members row itself.

type SharedRow = ProfileMemberRow & { id: string };

// Looking pages up, per connection: a page view is a lookup or two (the
// page, its photo), so these are far beyond anyone reading profiles, and
// far below what it takes to find shared pages by trying names one after
// another. The IP is hashed, as in lib/public-form-guard.ts: the limit only
// has to tell connections apart.
const LOOKUPS_PER_MINUTE = 60;
const LOOKUPS_PER_HOUR = 400;

async function lookupAllowed(): Promise<boolean> {
  let ip = "unknown";
  try {
    const h = await headers();
    ip = h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  } catch {
    // outside a request (a script): one shared bucket
  }
  const key = `profile-view:${createHash("sha256").update(`rcl-profile-view:${ip}`).digest("base64url").slice(0, 22)}`;
  if (!(await allowAttempt(`${key}:m`, LOOKUPS_PER_MINUTE, 60))) return false;
  return allowAttempt(`${key}:h`, LOOKUPS_PER_HOUR, 3600);
}

// The member whose page this handle is, if it's shared. `*` rather than a
// column list: before the member_profiles migration there's no
// profile_handle, the query fails, and every page is simply not found.
// Over the lookup limit, every page is not found too. Once per request
// (the page and its metadata share it).
const sharedMember = cache(async (raw: string): Promise<SharedRow | null> => {
  const handle = normalizeHandle(safeDecode(raw));
  if (!isValidHandle(handle)) return null;
  if (!(await lookupAllowed())) return null;
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
});

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return "";
  }
}

// Visits, the week streak and badges as of the end of yesterday's business
// day (profileAsOf): today's check-in, and anything it earned, waits for
// tomorrow, so the page never says they're here right now.
async function pastFacts(memberId: string, now: Date): Promise<{ visits: number; weekStreak: number; badges: EarnedBadgeRow[] }> {
  const { today, through } = profileAsOf(now);
  const supabase = createAdminClient();
  const [streak, count, earned] = await Promise.all([
    supabase.rpc("member_week_streak", { p_member: memberId, p_date: through }),
    supabase.from("member_visits").select("id", { count: "exact", head: true }).eq("member_id", memberId).lt("business_date", today),
    supabase.from("member_badges").select("badge, period, earned_at").eq("member_id", memberId).order("earned_at"),
  ]);
  return {
    visits: count.error ? 0 : (count.count ?? 0),
    weekStreak: streak.error ? 0 : Math.max(0, Math.round(Number(streak.data) || 0)),
    badges: (earned.data ?? []).flatMap((r) =>
      badgeFor(r.badge) && beforeToday(r.earned_at as string, now) ? [{ key: r.badge as string, period: (r.period as string) ?? "", earnedAt: r.earned_at as string }] : [],
    ),
  };
}

// Screenings they had confirmed tickets for that started before today's
// business day. Only `bookings`: private events (the events table) and
// booths are never part of it.
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
    if (!s?.movie || !beforeToday(s.starts_at, now)) return [];
    return [{ screeningId: s.id, movieId: s.movie.id, title: s.movie.title, posterUrl: s.movie.poster_url, releaseYear: s.movie.release_year, startsAt: s.starts_at }];
  });
}

// The page, or null (no such handle, sharing off, turned off by staff):
// all of those look the same from outside. Cached per request, so the
// page, its metadata and its link preview share one lookup and one
// cut-off.
export const getPublicProfile = cache(async (handle: string): Promise<PublicProfile | null> => {
  const m = await sharedMember(handle);
  if (!m) return null;
  const now = new Date();
  const [facts, seen] = await Promise.all([pastFacts(m.id, now).catch(() => ({ visits: 0, weekStreak: 0, badges: [] })), seenScreenings(m.id, now)]);
  return toPublicProfile(m, { ...facts, seen }, now);
});

// Their badge case for the shared page: the signed copies as cards, drawn
// for a public page (lib/badges/server.ts toCard: no time of day, a
// birthday badge's year only), and nothing minted today (like the rest of
// the page). Empty if the page isn't shared.
export const getPublicProfileCards = cache(async (handle: string): Promise<BadgeCard[]> => {
  const m = await sharedMember(handle);
  if (!m) return [];
  const now = new Date();
  const cards = await memberCards(m.id, { publicView: true });
  return cards.filter((c) => beforeToday(c.mintedAt, now));
});

const AVATAR_MARKER = "/storage/v1/object/public/member-avatars/";

// Their photo for the shared page, re-encoded: a square JPEG with the
// camera's metadata (and any location in it) stripped. Only a photo in our
// own member-avatars bucket; anything else and the page shows their
// initial. Null if the page isn't shared.
export async function getProfilePhoto(handle: string, size = 480): Promise<Buffer | null> {
  const m = await sharedMember(handle);
  return avatarJpeg(m?.avatar_url, size);
}

// The member's photo for the customer screen in front of them (their card,
// reached by a sealed reference: lib/tablet-photo.ts), re-encoded the same
// way. Whether their page is shared doesn't matter: it's their own photo,
// shown to them. Null with no photo.
export async function getMemberPhoto(memberId: string, size = 360): Promise<Buffer | null> {
  const { data } = await createAdminClient().from("members").select("avatar_url").eq("id", memberId).is("erased_at", null).maybeSingle();
  return avatarJpeg((data?.avatar_url as string | null | undefined) ?? null, size);
}

async function avatarJpeg(url: string | null | undefined, size: number): Promise<Buffer | null> {
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
