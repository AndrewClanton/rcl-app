import { NextResponse } from "next/server";
import { getStaffSession } from "@/lib/auth";
import { findOldCard } from "@/lib/old-card-offer";

// The register's "Old card on file?" lookup (lib/old-card-offer.ts), after a
// card sale is saved. A plain POST, not a Server Action: the browser runs
// Server Actions one at a time, so a Stripe read in flight here would hold
// up the next sale's Charge. Staff only. Answers { offer } or { offer: null }.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const staff = await getStaffSession();
  if (!staff) return NextResponse.json({ error: "Not authorized" }, { status: 401, headers: NO_STORE });
  const body = (await req.json().catch(() => null)) as { paymentIntentId?: unknown } | null;
  const pi = typeof body?.paymentIntentId === "string" ? body.paymentIntentId : "";
  return NextResponse.json({ offer: await findOldCard(pi, staff.employeeId) }, { headers: NO_STORE });
}
