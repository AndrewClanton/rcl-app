// A member's profile: the profile line, the display name, the link name
// (handle) for their shared page, and exactly what that page may show.
//
// The shared page (/m/<handle>) is off until the member turns it on, on the
// Profile tab of their account. Anyone with the link can open it, signed in
// or not; it's kept out of search engines and the sitemap. It shows only
// what toPublicProfile() below builds, never anything else off the members
// row:
//   - their display name (they choose it; defaultDisplayName() suggests
//     first name and last initial), photo and profile line (unless staff
//     hid the line);
//   - their badges with the day each was earned (Birthday Visit only with
//     its year: its day would say when their birthday is), weeks in a row,
//     how many visits, and the month they joined;
//   - movies they've seen: past screenings they had tickets for. Only this
//     year's releases are named (our MPLC license lets us advertise only
//     those; lib/mplc.ts); older films are a count, "+ 3 from the film
//     archive". No dates or times.
// Never purchases, spending, points, email, phone, their full name (unless
// they typed it as their display name), check-in times, Insiders+ status,
// upcoming tickets, or the member id (which works like a password: see
// lib/ticket-scan.ts). Their photo is served by handle
// (app/(profile)/m/[handle]/photo), never by its storage address, which
// contains the member id.
//
// No server imports: the account page, the public page and
// scripts/check-member-profile.mjs all use it.

import { isRestrictedRelease } from "@/lib/mplc";
import { BADGES, badgeFor, type BadgeKey } from "@/lib/visits";
import { flairKeys, parseFlair, type FlairKeys } from "@/lib/flair";

export const PROFILE_LINE_MAX = 120;
export const DISPLAY_NAME_MAX = 40;
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 24;

const TZ = "America/Chicago";

// ---------- text a member types ----------

// Control characters, zero-width and direction-changing characters (which
// can make a line read differently from what it says), after whitespace is
// collapsed to single spaces.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁩﻿]/g;
// Stacks of combining marks ("zalgo" text that spills over the lines
// around it): two in a row are plenty for any real language. RegExp
// constructor: \p{} needs a newer target than this project compiles to.
const MARK_PILES = new RegExp("(\\p{M}{2})\\p{M}+", "gu");
const LETTER_OR_DIGIT = new RegExp("[\\p{L}\\p{N}]", "u");

// Anything that isn't a string (a form posted by hand, say) is empty.
export function tidyText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.replace(/\s+/g, " ").replace(INVISIBLE, "").replace(MARK_PILES, "$1").trim();
}

export type Cleaned = { ok: true; value: string | null } | { ok: false; error: string };

// The profile line: optional, one line, PROFILE_LINE_MAX characters.
export function cleanProfileLine(input: unknown): Cleaned {
  const t = tidyText(input);
  if (!t) return { ok: true, value: null };
  if ([...t].length > PROFILE_LINE_MAX) return { ok: false, error: `Keep your profile line to ${PROFILE_LINE_MAX} characters.` };
  return { ok: true, value: t };
}

// A profile line off the check-in channel, for the customer screen: tidied
// and cut to length (the register already dropped one staff hid).
export function lineFromChannel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = tidyText(raw);
  return t ? [...t].slice(0, PROFILE_LINE_MAX).join("") : null;
}

function capitalize(word: string): string {
  return word.charAt(0).toLocaleUpperCase() + word.slice(1);
}

// "Maya Rodriguez" -> "Maya R.", "maya" -> "Maya". What the shared page
// calls them until they choose something else.
export function defaultDisplayName(name: string | null | undefined): string {
  const words = tidyText(name ?? "").split(" ").filter(Boolean);
  if (!words.length) return "A Royale Insider";
  const first = [...capitalize(words[0])].slice(0, DISPLAY_NAME_MAX - 3).join("");
  if (words.length === 1) return first;
  const initial = [...words[words.length - 1]].find((c) => LETTER_OR_DIGIT.test(c));
  return initial ? `${first} ${initial.toLocaleUpperCase()}.` : first;
}

// The display name they typed: null for "use the default".
export function cleanDisplayName(input: unknown): Cleaned {
  const t = tidyText(input);
  if (!t) return { ok: true, value: null };
  if ([...t].length > DISPLAY_NAME_MAX) return { ok: false, error: `Keep your display name to ${DISPLAY_NAME_MAX} characters.` };
  if (!LETTER_OR_DIGIT.test(t)) return { ok: false, error: "Your display name needs at least one letter or number." };
  return { ok: true, value: t };
}

// ---------- the link name (handle) ----------

// Words that belong to the Royale or to the site's own pages. Anything
// starting with one of RESERVED_PREFIXES is out too ("royale-staff").
const RESERVED = new Set([
  "about", "account", "accounts", "admin", "administrator", "api", "app", "bartender", "booth", "booths", "box-office", "boxoffice",
  "cinema", "data-deletion", "display", "events", "help", "home", "info", "insider", "insiders", "insiders-plus", "joplin", "login",
  "logout", "manager", "me", "member", "members", "menu", "mod", "moderator", "null", "owner", "photo", "pos", "privacy", "profile",
  "register", "settings", "showtimes", "signin", "signup", "staff", "support", "system", "team", "theater", "theatre", "undefined", "www",
]);
const RESERVED_PREFIXES = ["royale", "rcl", "staff", "admin", "official", "support", "manager", "owner"];

// As they type: lowercase, accents off, spaces and dots and underscores to
// hyphens, nothing else but letters, digits and hyphens. (A trailing hyphen
// can stay while they're still typing.)
export function handleInput(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[\s._]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, HANDLE_MAX);
}

// What gets saved: handleInput, without a hyphen at either end.
export function normalizeHandle(input: unknown): string {
  return handleInput(input).replace(/-+$/, "");
}

// Why a (normalized) handle can't be used, or null if it can.
export function handleProblem(handle: string): string | null {
  if (!handle) return "Pick a name for your link.";
  if (handle.length < HANDLE_MIN) return `Use at least ${HANDLE_MIN} characters.`;
  if (handle.length > HANDLE_MAX) return `Use ${HANDLE_MAX} characters or fewer.`;
  if (!/^[a-z]/.test(handle)) return "Start with a letter.";
  if (!/^[a-z0-9-]+$/.test(handle)) return "Use letters, numbers and hyphens only.";
  if (handle.includes("--") || handle.endsWith("-")) return "Use single hyphens between words.";
  if (RESERVED.has(handle) || RESERVED_PREFIXES.some((p) => handle.startsWith(p))) return "That one's reserved. Try another.";
  return null;
}

export function isValidHandle(handle: string): boolean {
  return handleProblem(handle) === null;
}

// A first suggestion, from their name: "Maya Rodriguez" -> "maya-r".
export function suggestHandle(name: string | null | undefined): string {
  let h = normalizeHandle(defaultDisplayName(name));
  if (h && !/^[a-z]/.test(h)) h = `fan-${h}`;
  if (h.length < HANDLE_MIN || handleProblem(h)) h = normalizeHandle(`${h || "movie"}-fan`);
  return handleProblem(h) ? "" : h;
}

export function profilePath(handle: string): string {
  return `/m/${handle}`;
}

// ---------- what the shared page shows ----------

// The members columns the page is built from. Anything else on the row is
// ignored (toPublicProfile copies field by field).
export interface ProfileMemberRow {
  name: string;
  display_name?: string | null;
  profile_handle?: string | null;
  share_profile?: boolean | null;
  profile_hidden_at?: string | null;
  erased_at?: string | null;
  tagline?: string | null;
  tagline_hidden_at?: string | null;
  avatar_url?: string | null;
  created_at: string;
  flair_color?: string | null;
  flair_effect?: string | null;
  flair_sticker?: string | null;
}

// Their page is up: they turned it on, have a handle, staff haven't turned
// it off, and the account hasn't been erased.
export function isShared(m: Pick<ProfileMemberRow, "share_profile" | "profile_handle" | "profile_hidden_at" | "erased_at">): boolean {
  return m.share_profile === true && !!m.profile_handle && !m.profile_hidden_at && !m.erased_at;
}

// Their line wherever it shows (the page, the check-in screen): nothing
// while staff have it hidden.
export function visibleLine(m: Pick<ProfileMemberRow, "tagline" | "tagline_hidden_at">): string | null {
  if (m.tagline_hidden_at) return null;
  const c = cleanProfileLine(m.tagline);
  return c.ok ? c.value : null;
}

export function displayNameFor(m: Pick<ProfileMemberRow, "display_name" | "name">): string {
  const c = cleanDisplayName(m.display_name);
  return (c.ok && c.value) || defaultDisplayName(m.name);
}

// A past booking of theirs (confirmed tickets), as the server reads it.
export interface SeenRow {
  screeningId: string;
  movieId: string;
  title: string;
  posterUrl: string | null;
  releaseYear: number | null;
  startsAt: string;
}

export interface PublicMovie {
  title: string;
  posterUrl: string | null;
  times: number; // different screenings of it they had tickets for
}

export interface PublicMovies {
  named: PublicMovie[]; // this (Central) year's releases, most recent first
  archive: number; // how many other films: counted, never named
  total: number; // different films, all told
}

// Films seen, split for the MPLC license: only this year's releases (by
// the theater's calendar, lib/mplc.ts) by name. A film with no confirmed
// release year counts as archive. Upcoming screenings aren't "seen" (and
// would say where they'll be).
export function publicMovies(rows: SeenRow[], now = new Date()): PublicMovies {
  const byMovie = new Map<string, { title: string; posterUrl: string | null; releaseYear: number | null; screenings: Set<string>; last: number }>();
  for (const r of rows) {
    const at = Date.parse(r.startsAt);
    if (!Number.isFinite(at) || at > now.getTime() || !r.movieId) continue;
    const m = byMovie.get(r.movieId) ?? { title: r.title, posterUrl: r.posterUrl, releaseYear: r.releaseYear, screenings: new Set<string>(), last: 0 };
    m.screenings.add(r.screeningId);
    m.last = Math.max(m.last, at);
    byMovie.set(r.movieId, m);
  }
  const named: (PublicMovie & { last: number })[] = [];
  let archive = 0;
  for (const m of byMovie.values()) {
    if (isRestrictedRelease({ release_year: m.releaseYear }, now)) archive++;
    else named.push({ title: m.title, posterUrl: m.posterUrl, times: m.screenings.size, last: m.last });
  }
  named.sort((a, b) => b.last - a.last);
  return { named: named.map(({ title, posterUrl, times }) => ({ title, posterUrl, times })), archive, total: byMovie.size };
}

export interface EarnedBadgeRow {
  key: string;
  period: string; // "" or, for Birthday Visit, the birthday's year
  earnedAt: string;
}

export interface PublicBadge {
  key: BadgeKey;
  emoji: string;
  label: string;
  earned: string; // "Sep 30, 2026"; Birthday Visit: just "2026"
  times: number; // Birthday Visit can come every year
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ });
}

// Earned badges for the page, in the cabinet's order: no points, no times
// of day, and Birthday Visit with its year only.
export function publicBadges(rows: EarnedBadgeRow[]): PublicBadge[] {
  const latest = new Map<string, { row: EarnedBadgeRow; times: number }>();
  for (const r of rows) {
    if (!badgeFor(r.key)) continue;
    const had = latest.get(r.key);
    const newer = !had || Date.parse(r.earnedAt) >= Date.parse(had.row.earnedAt);
    latest.set(r.key, { row: newer ? r : had.row, times: (had?.times ?? 0) + 1 });
  }
  return BADGES.flatMap((b) => {
    const e = latest.get(b.key);
    if (!e) return [];
    const earned = b.key === "birthday" ? (/^\d{4}$/.test(e.row.period) ? e.row.period : "") : dayLabel(e.row.earnedAt);
    return [{ key: b.key, emoji: b.emoji, label: b.label, earned, times: e.times }];
  });
}

export interface PublicProfile {
  handle: string;
  displayName: string;
  line: string | null;
  photo: string | null; // this page's own photo address, never the storage one
  initial: string; // for the circle when there's no photo
  flair: FlairKeys;
  memberSince: string; // "Sep 2026"
  visits: number;
  weekStreak: number;
  badges: PublicBadge[];
  badgeTotal: number;
  movies: PublicMovies;
}

// FNV-1a, so the photo's address changes when the photo does (browsers and
// link previews cache it) without saying anything about where it's stored.
export function photoVersion(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// Everything the shared page gets, field by field. Nothing else off the
// row reaches the page (or its link preview).
export function toPublicProfile(
  m: ProfileMemberRow,
  facts: { visits: number; weekStreak: number; badges: EarnedBadgeRow[]; seen: SeenRow[] },
  now = new Date(),
): PublicProfile | null {
  const handle = normalizeHandle(m.profile_handle);
  if (!isShared(m) || handle !== m.profile_handle || !isValidHandle(handle)) return null;
  const displayName = displayNameFor(m);
  const since = new Date(m.created_at);
  return {
    handle,
    displayName,
    line: visibleLine(m),
    photo: m.avatar_url ? `${profilePath(handle)}/photo?v=${photoVersion(m.avatar_url)}` : null,
    initial: ([...displayName].find((c) => LETTER_OR_DIGIT.test(c)) ?? "R").toLocaleUpperCase(),
    flair: flairKeys(parseFlair(m)),
    memberSince: Number.isNaN(since.getTime()) ? "" : since.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: TZ }),
    visits: Math.max(0, Math.round(Number(facts.visits) || 0)),
    weekStreak: Math.max(0, Math.round(Number(facts.weekStreak) || 0)),
    badges: publicBadges(facts.badges),
    badgeTotal: BADGES.length,
    movies: publicMovies(facts.seen, now),
  };
}

// The link preview's words: their display name and counts, nothing else.
export function profileBlurb(p: Pick<PublicProfile, "displayName" | "badges" | "visits" | "movies">): string {
  const bits = [
    `${p.badges.length} ${p.badges.length === 1 ? "badge" : "badges"}`,
    `${p.visits} ${p.visits === 1 ? "visit" : "visits"}`,
    `${p.movies.total} ${p.movies.total === 1 ? "movie" : "movies"} seen`,
  ];
  return `${p.displayName} at Royale Cinema Lounge, Joplin's dine-in cinema: ${bits.join(", ")}.`;
}
