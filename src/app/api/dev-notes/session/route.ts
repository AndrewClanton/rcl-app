import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { canLeaveDevNotes } from "@/lib/dev-notes-access";

// Tiny, deliberately separate from the root layout: keeps the root layout
// free of any dynamic/cookie-reading API, so pages that don't otherwise need
// server-rendering (the public marketing pages) can stay statically
// generated. The Dev Notes widget calls this client-side on mount instead.
// isAdmin means "show the widget": admins, plus the register's shared login.
export async function GET() {
  const session = await getStaffSession();
  return NextResponse.json({ isAdmin: !!session && canLeaveDevNotes(session) });
}
