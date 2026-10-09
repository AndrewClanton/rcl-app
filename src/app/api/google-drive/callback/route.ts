import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getStaffSession, hasManagerAccess } from "@/lib/auth";
import { CALLBACK_PATH, STATE_COOKIE, exchangeCode, missingGoogleEnv, saveConnection, sealToken } from "@/lib/google-drive-calendar";

// Google sends the manager back here after "Connect Google Drive". The
// refresh token is saved encrypted; the calendar file is picked next, on
// the sync page (the Google Picker).
export const dynamic = "force-dynamic";
const BACK = "/admin/screenings/sync";

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const back = (drive: string) => {
    const res = NextResponse.redirect(new URL(`${BACK}?drive=${drive}`, url.origin));
    res.cookies.set(STATE_COOKIE, "", { path: "/api/google-drive", maxAge: 0 });
    return res;
  };
  const staff = await getStaffSession();
  if (!staff || !hasManagerAccess(staff.role)) return back("manager");
  if (missingGoogleEnv().length) return back("setup");
  const state = url.searchParams.get("state") ?? "";
  const kept = req.cookies.get(STATE_COOKIE)?.value ?? "";
  if (!state || !kept || !same(state, kept)) return back("expired");
  if (url.searchParams.get("error")) return back("declined");
  const code = url.searchParams.get("code");
  if (!code) return back("failed");
  const got = await exchangeCode(code, `${url.origin}${CALLBACK_PATH}`).catch(() => ({ ok: false as const, error: "network" }));
  if (!got.ok) return back(got.error === "scope_not_granted" ? "scope" : "failed");
  // A new connection replaces the old one. (The old one isn't revoked here:
  // for the same Google account that would cancel the new one too.)
  try {
    await saveConnection({ token: sealToken(got.refreshToken), fileId: null, fileName: null, connectedAt: new Date().toISOString(), connectedBy: staff.employeeId }, staff.employeeId);
  } catch (e) {
    console.error("google drive connect: save failed", e);
    return back("failed");
  }
  return back("connected");
}
