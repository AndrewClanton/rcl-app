import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isWithinPublicWindow } from "@/lib/public-window";

// Expired and unknown showtime links, answered with the real 404 page.
//
// A showtime page that calls notFound() while rendering can only send an
// empty HTML shell: Next has already started the page when the showtime
// turns out to be missing, so the "This reel's missing" page is drawn by
// JavaScript in the browser, and crawlers and link previews see a blank
// page. Those links are everywhere (shared on social media after the show
// starts), so the proxy checks first and rewrites a dead one to an address
// no route matches. Next then serves app/not-found.tsx, prerendered at build,
// with a 404 status and the whole page in the HTML.
//
// Same rule as the page's own check (isWithinPublicWindow). Restricted (MPLC)
// titles aren't checked here: their direct links are meant to work (the
// members' email), and the page itself keeps them out of search results.
// If the database can't be reached, the page decides as before.

const SHOWTIME_PATH = /^\/showtimes\/([^/]+)\/?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Nothing is routed here, so it gets the site's 404 page.
const NOT_FOUND_PATH = "/_missing-showtime";

export async function rewriteMissingShowtime(request: NextRequest): Promise<NextResponse | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  // Only whole-page loads (an opened link, a crawler). Taps inside the site
  // and link prefetches fetch RSC data instead: the page's own notFound()
  // shows the 404 there, and checking every prefetched time chip would cost
  // a database query each.
  if (request.headers.has("rsc") || request.headers.has("next-router-prefetch")) return null;
  const match = SHOWTIME_PATH.exec(request.nextUrl.pathname);
  if (!match) return null;

  const id = match[1];
  if (UUID.test(id)) {
    const startsAt = await screeningStart(id);
    if (startsAt === undefined) return null;
    if (startsAt && isWithinPublicWindow(startsAt)) return null;
  }
  return NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url));
}

// The showtime's start, null if there's no such showtime, undefined if the
// lookup itself failed. Screenings aren't readable with the public key, so
// this uses the service role (server side only, like lib/supabase/admin.ts,
// which the proxy can't import because it's marked server-only).
async function screeningStart(id: string): Promise<string | null | undefined> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return undefined;
  try {
    const { data, error } = await createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
      .from("screenings")
      .select("starts_at")
      .eq("id", id)
      .maybeSingle();
    if (error) return undefined;
    return (data?.starts_at as string | undefined) ?? null;
  } catch {
    return undefined;
  }
}
