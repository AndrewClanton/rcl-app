import { createHash } from "node:crypto";
import { after, type NextRequest } from "next/server";
import { getEmployeeSession } from "@/lib/auth";
import { businessDay } from "@/lib/ops/time";
import { allowAttempt } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePath, parseBeacon, STAFF_AREAS } from "@/lib/usage";

// The page-view count's mailbox (Reports -> Website usage). Public: the
// browser's beacon (src/lib/usage-client.ts) posts one small JSON body per
// page view. Answers straight away with 204 and does the writing after,
// so a beacon never waits on the database.
//
// Kept anonymous: the connection is only hashed for the rate limit, the
// browser string is only looked at to skip robots, and for staff pages the
// server looks up the signed-in role (not the person) itself.

export const dynamic = "force-dynamic";

const MAX_BODY = 2_000;

// Search engines, link previews, uptime checks and scripts. Real browsers
// don't say any of these.
const BOT =
  /(?<!cu)bot\b|bot\/|crawl|spider|slurp|archiver|facebookexternalhit|facebookcatalog|embedly|preview|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl\/|wget|python|go-http-client|okhttp|java\/|node-fetch|axios|httpclient|vercel-screenshot/i;

function connectionKey(req: NextRequest) {
  const ip = req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(`rcl-usage:${ip}`).digest("base64url").slice(0, 22);
}

const nothing = () => new Response(null, { status: 204 });

export async function POST(req: NextRequest) {
  const ua = req.headers.get("user-agent") ?? "";
  if (!ua || BOT.test(ua)) return nothing();

  const text = await req.text().catch(() => "");
  if (!text || text.length > MAX_BODY) return new Response(null, { status: 400 });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const beacon = parseBeacon(raw);
  if (!beacon) return new Response(null, { status: 400 });

  const key = connectionKey(req);
  const staffPage = STAFF_AREAS.includes(beacon.area);
  const receivedAt = Date.now();

  after(async () => {
    try {
      // Two page views a second: plenty for a crowd on the lounge's Wi-Fi
      // behind one address, staff included; a flood stops here.
      if (!(await allowAttempt(`usage:${key}`, 120, 60))) return;
      const role = staffPage ? ((await getEmployeeSession())?.role ?? null) : null;
      const openedAt = new Date(receivedAt - beacon.w * 1000);
      const { path, pattern, entityId } = normalizePath(beacon.path);
      const { error } = await createAdminClient().rpc("record_page_view", {
        p_id: beacon.id,
        p_occurred_at: openedAt.toISOString(),
        p_business_date: businessDay(openedAt).date,
        p_path: path,
        p_pattern: pattern,
        p_entity_id: entityId,
        p_area: beacon.area,
        p_role: role,
        p_seconds: beacon.s,
        p_device: beacon.d,
        p_referrer_host: beacon.ref,
        p_visitor_id: beacon.vid,
        p_session_id: beacon.sid,
        p_is_new_visitor: beacon.new,
        p_is_entry: beacon.entry,
        p_not_found: beacon.nf,
        p_staff_browser: beacon.staff,
      });
      if (error) console.warn("usage: not recorded", error.message);
    } catch (e) {
      console.warn("usage: not recorded", e instanceof Error ? e.message : e);
    }
  });

  return nothing();
}
