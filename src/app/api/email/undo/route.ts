import { getStaffSession, hasManagerAccess } from "@/lib/auth";
import { undoPress } from "@/lib/email/designs/undo-press";

// Undo on Back office -> Email -> Ready to send (lib/email/designs/
// undo-press.ts). A Route Handler rather than a Server Action: the browser
// sends Server Actions one at a time, so an Undo pressed while another was
// running would wait behind it and could miss its minute.
//
// Managers and up, signed in (the same as Send). Only from our own pages:
// the browser must say the request came from this site, and send JSON (a
// form on another site can do neither).

export const dynamic = "force-dynamic";
// Calling back a wave of up to 200 takes a few minutes at Resend's pace.
export const maxDuration = 300;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// The site the request came from is this one (the host it was sent to).
function sameSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!sameSite(req)) return json({ ok: false, error: "Reload the page and try again." }, 403);
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return json({ ok: false, error: "Reload the page and try again." }, 415);
  const staff = await getStaffSession();
  if (!staff) return json({ ok: false, error: "You've been signed out. Sign in again, then press Undo." }, 401);
  if (!hasManagerAccess(staff.role)) return json({ ok: false, error: "Only a manager, admin or owner can undo a send." }, 403);
  const body = (await req.json().catch(() => null)) as { key?: unknown; campaignId?: unknown; undoKey?: unknown } | null;
  if (!body) return json({ ok: false, error: "Reload the page and try again." }, 400);
  return json(await undoPress(body.key, body.campaignId, body.undoKey));
}
