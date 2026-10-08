import type { Metadata, Viewport } from "next";
import { getSignedInMember } from "@/lib/member-auth";
import { dailyCoffeeUse } from "@/lib/daily-perk-server";
import { getSeatMenu, getSeatSettings, spotByCode } from "@/lib/seat-ordering-server";
import { seatOrderingOpen } from "@/lib/seat-ordering";
import SeatOrderApp, { type SeatGuest } from "./SeatOrderApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Order from your seat",
  robots: { index: false, follow: false },
};

export async function generateViewport({ params }: PageProps<"/order/[spot]">): Promise<Viewport> {
  const spot = await spotByCode((await params).spot).catch(() => null);
  return { themeColor: spot?.dark || spot?.kind === "booth" ? "#0b0a08" : "#f8f5ec", width: "device-width", initialScale: 1 };
}

// /order/<code>: the phone menu a spot's QR card opens (Back office → Seat
// ordering). Public. ?o=<checkout> shows that order's status instead (where
// the phone comes back to after paying, or on a reload).
export default async function SeatOrderPage({ params, searchParams }: PageProps<"/order/[spot]">) {
  const [{ spot: code }, sp] = await Promise.all([params, searchParams]);
  const spot = await spotByCode(code);
  if (!spot) {
    return (
      <main className="site mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16 text-center">
        <p className="eyebrow">Royale Cinema</p>
        <h1 className="font-display mt-2 text-3xl">This QR code isn&apos;t working</h1>
        <p className="mt-3" style={{ color: "var(--muted)" }}>
          Please order at the counter, and let us know about the card.
        </p>
      </main>
    );
  }
  const [settings, member] = await Promise.all([getSeatSettings(), getSignedInMember().catch(() => null)]);
  const state = seatOrderingOpen(settings);
  const menu = state.open ? await getSeatMenu() : [];
  let guest: SeatGuest | null = null;
  if (member) {
    const plus = member.tier === "Insiders+";
    const coffee = plus ? await dailyCoffeeUse(member.id) : undefined;
    guest = { firstName: (member.name ?? "").trim().split(/\s+/)[0] || "there", tier: member.tier, points: Number(member.points), coffeeReady: plus && coffee === null };
  }
  const checkout = typeof sp.o === "string" && /^[0-9a-f-]{36}$/i.test(sp.o) ? sp.o : null;
  return <SeatOrderApp code={spot.code} spotName={spot.name} dark={spot.dark} dim={spot.dark || spot.kind === "booth"} open={state.open} menu={menu} guest={guest} initialCheckout={checkout} publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ""} />;
}
