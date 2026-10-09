import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { getCalendarStatus } from "@/lib/calendar-status-server";

// The schedule check's last result, for the "Schedule not checked" banner
// (Back office and the register ask every few minutes). Staff only.
export const dynamic = "force-dynamic";

export async function GET() {
  const staff = await getStaffSession();
  if (!staff) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const s = await getCalendarStatus();
  // Only what the banner needs.
  return NextResponse.json(
    { status: s ? { ok: s.ok, at: s.at, source: s.source, ...(s.lastOkAt ? { lastOkAt: s.lastOkAt } : {}) } : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
