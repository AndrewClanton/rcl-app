import { NextResponse, after } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { allowAttempt } from "@/lib/rate-limit";
import { registerSeatOrders, sweepSeatCheckouts } from "@/lib/seat-ordering-server";

// The register's Order up poll (pos/SeatOrders.tsx), every 15 seconds. A
// plain GET, not a Server Action: the browser runs Server Actions one at a
// time, so a poll in flight would hold up the cashier's Charge behind it.
// Staff only.
//
// It also gives the seat-order sweep a heartbeat (lib/seat-ordering-server.ts
// sweepSeatCheckouts): at most once a minute, after the answer, paid phone
// orders whose phone never came back are made into their orders; at most
// once an hour, old unpaid checkouts are tidied (a paid one never is).
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const staff = await getStaffSession();
  if (!staff) return NextResponse.json({ error: "Not authorized" }, { status: 401, headers: NO_STORE });

  after(async () => {
    try {
      if (!(await allowAttempt("seat-sweep:recent", 1, 60))) return;
      const cleanup = await allowAttempt("seat-sweep:old", 1, 3600);
      const r = await sweepSeatCheckouts({ recentMs: 3 * 3_600_000, cleanup });
      if (r.finished || r.removed) console.log("seat sweep", r);
    } catch (e) {
      console.error("seat sweep failed", e);
    }
  });

  try {
    return NextResponse.json(await registerSeatOrders(), { headers: NO_STORE });
  } catch (e) {
    console.error("register seat orders: not read", e);
    return NextResponse.json({ error: "Couldn't check phone orders" }, { status: 503, headers: NO_STORE });
  }
}
