import type { Metadata } from "next";
import { getStripe } from "@/lib/stripe";
import { getActiveBooths, getBoothReservationsForDate } from "@/lib/data/booths";
import BoothReservationForm from "./BoothReservationForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reserve a Booth",
  description: "Reserve one of our 8 lounge booths for a two-hour window -- pay online to hold your spot.",
};

function todayCentral() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

export default async function BoothsPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; session_id?: string }>;
}) {
  const { checkout, session_id } = await searchParams;
  const startDate = todayCentral();

  const [booths, reservationsToday] = await Promise.all([getActiveBooths(), getBoothReservationsForDate(startDate)]);

  let paymentConfirmed = false;
  if (checkout === "success" && session_id) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(session_id);
      paymentConfirmed = session.payment_status === "paid";
    } catch {
      paymentConfirmed = false;
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display mb-1 text-3xl font-semibold">Reserve a Booth</h1>
      <p className="mb-8 max-w-2xl text-sm text-[var(--muted)]">
        Hold one of our 8 lounge booths for a two-hour window with a flat reservation fee -- food, drinks, and any
        movie tickets are ordered separately once you're seated.
      </p>

      {paymentConfirmed ? (
        <div className="notice notice-success">
          <h2 className="text-lg font-semibold">Booth reserved!</h2>
          <p className="mt-2 text-sm opacity-90">A receipt was sent to your email by Stripe. See you soon.</p>
        </div>
      ) : (
        <>
          {checkout === "cancelled" && (
            <div className="notice notice-warn mb-4">Checkout was cancelled — the booth wasn&apos;t held. Feel free to try again.</div>
          )}
          <BoothReservationForm booths={booths} initialDate={startDate} initialReservations={reservationsToday} />
        </>
      )}
    </div>
  );
}
