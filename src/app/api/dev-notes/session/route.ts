import { NextResponse } from "next/server";
import { getStaffSession, hasAdminAccess } from "@/lib/auth";

// Tiny, deliberately separate from the root layout: keeps the root layout
// free of any dynamic/cookie-reading API, so pages that don't otherwise need
// server-rendering (the public marketing pages) can stay statically
// generated. The Dev Notes widget calls this client-side on mount instead.
export async function GET() {
  const session = await getStaffSession();
  return NextResponse.json({ isAdmin: !!session && hasAdminAccess(session.role) });
}
