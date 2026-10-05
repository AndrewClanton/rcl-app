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
// If the database can't be reached (or takes too long), the page decides as
// before.

const SHOWTIME_PATH = /^\/showtimes\/([^/]+)\/?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Nothing is routed here, so it gets the site's 404 page.
const NOT_FOUND_PATH = "/_missing-showtime";
// What the browser says it's loading a whole page into (Sec-Fetch-Dest).
const PAGE_LOADS = new Set(["document", "iframe", "frame"]);
// The lookup gets this long before the page is left to decide.
const LOOKUP_TIMEOUT_MS = 1500;

export async function rewriteMissingShowtime(request: NextRequest): Promise<NextResponse | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const match = SHOWTIME_PATH.exec(request.nextUrl.pathname);
  if (!match) return null;

  // Only whole-page loads: an opened link, a crawler, a link preview. Taps
  // inside the site, router.refresh() and the prefetch of every time chip on
  // Home and Showtimes are fetch() calls for the page's data, and checking
  // each of those would cost a database query apiece; the page's own
  // notFound() shows the 404 there. Next strips its own RSC and prefetch
  // headers before the proxy sees the request, so it's told apart by
  // Sec-Fetch-Dest, which browsers send on everything ("empty" for fetch(),
  // "document" for a page). Crawlers and link-preview bots don't send it at
  // all, so a request without it is checked.
  const dest = request.headers.get("sec-fetch-dest");
  if (dest && !PAGE_LOADS.has(dest)) return null;

  // The return from checkout. Stripe's page can stay open for 30 minutes,
  // so someone who clicked Buy just before the show and paid just after it
  // started comes back here after the start time. The page checks the
  // payment (or the free booking) itself and shows their ticket.
  const params = request.nextUrl.searchParams;
  const checkout = params.get("checkout");
  if ((checkout === "success" && params.has("session_id")) || (checkout === "free" && params.has("booking_id"))) return null;

  const id = match[1];
  if (UUID.test(id)) {
    const startsAt = await screeningStart(id);
    if (startsAt === undefined) return null;
    if (startsAt && isWithinPublicWindow(startsAt)) return null;
  }
  return NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url));
}

// The showtime's start, null if there's no such showtime, undefined if the
// lookup itself failed or timed out. Screenings aren't readable with the
// public key, so this uses the service role (server side only, like
// lib/supabase/admin.ts, which the proxy can't import because it's marked
// server-only). It runs before the page's own queries, so a slow database
// mustn't hold the page up twice: after LOOKUP_TIMEOUT_MS it gives up, and
// it's never retried (supabase-js retries a failed read up to 3 times with
// 1-2-4 second waits; the page makes its own read anyway).
async function screeningStart(id: string): Promise<string | null | undefined> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return undefined;
  try {
    const { data, error } = await createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
      .from("screenings")
      .select("*")
      .eq("id", id)
      .abortSignal(AbortSignal.timeout(LOOKUP_TIMEOUT_MS))
      .maybeSingle()
      .retry(false);
    if (error) return undefined;
    // A private group's showing has no public page at all: same as no showtime.
    if (data?.visibility === "private") return null;
    return (data?.starts_at as string | undefined) ?? null;
  } catch {
    return undefined;
  }
}
