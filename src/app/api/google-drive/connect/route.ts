import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { getStaffSession, hasManagerAccess } from "@/lib/auth";
import { CALLBACK_PATH, STATE_COOKIE, authUrl, missingGoogleEnv } from "@/lib/google-drive-calendar";

// "Connect Google Drive" (Back office > Showtimes > Sync from calendar):
// sends a manager to Google to allow the drive.file scope. The state is
// kept in a short-lived cookie and checked on the way back.
export const dynamic = "force-dynamic";
const BACK = "/admin/screenings/sync";

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;
  const staff = await getStaffSession();
  if (!staff || !hasManagerAccess(staff.role)) return NextResponse.redirect(new URL(`${BACK}?drive=manager`, origin));
  if (missingGoogleEnv().length) return NextResponse.redirect(new URL(`${BACK}?drive=setup`, origin));
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authUrl(`${origin}${CALLBACK_PATH}`, state));
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: "/api/google-drive", maxAge: 600 });
  return res;
}
