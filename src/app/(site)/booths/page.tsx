import type { Metadata } from "next";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveBooths, getBoothReservationsForDate } from "@/lib/data/booths";
import BoothReservationForm from "./BoothReservationForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reserve a Booth",
  description: "Reserve one of our 8 lounge booths for a two-hour window -- pay online to hold your spot. Insiders+ members get 2 free reservations a month.",
};

function tomorrowCentral() {
  const now = new Date();
  const centralToday = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  centralToday.setDate(centralToday.getDate() + 1);
  return centralToday.toLocaleDateString("en-CA");
}

export default async function BoothsPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; session_id?: string; reservation_id?: string }>;
}) {
  const { checkout, session_id, reservation_id } = await searchParams;
  // Booths can't be reserved for today -- only from tomorrow on, so nobody
  // books a seat out from under a customer who's already sitting in it.
  const startDate = tomorrowCentral();

  const [booths, reservationsForStartDate] = await Promise.all([getActiveBooths(), getBoothReservationsForDate(startDate)]);

  let paymentConfirmed = false;
  if (checkout === "success" && session_id) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(session_id);
      paymentConfirmed = session.payment_status === "paid";
    } catch {
      paymentConfirmed = false;
    }
  }

  // Insiders+ free-reservation bookings skip Stripe entirely, so confirm
  // those by checking the reservation's own DB status (already written
  // server-side by startBoothCheckout) rather than a URL param.
  let freeReservationConfirmed = false;
  if (checkout === "free" && reservation_id) {
    const { data: reservation } = await createAdminClient().from("booth_reservations").select("status").eq("id", reservation_id).maybeSingle();
    freeReservationConfirmed = reservation?.status === "confirmed";
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display mb-1 text-3xl font-semibold">Reserve a Booth</h1>
      <p className="mb-8 max-w-2xl text-sm text-[var(--muted)]">
        Pick a booth below to hold it for a two-hour window with a flat reservation fee — food, drinks, and any movie
        tickets are ordered separately once you&apos;re seated.{" "}
        <a href="/membership" className="font-bold text-[var(--accent)] hover:underline">
          Insiders+ members get 2 free reservations every month
        </a>
        .
      </p>

      {paymentConfirmed || freeReservationConfirmed ? (
        <div className="notice notice-success">
          <h2 className="text-lg font-semibold">Booth reserved!</h2>
          <p className="mt-2 text-sm opacity-90">
            {freeReservationConfirmed
              ? "Your Insiders+ membership covered this one — no charge. See you soon."
              : "A receipt was sent to your email by Stripe. See you soon."}
          </p>
        </div>
      ) : (
        <>
          {checkout === "cancelled" && (
            <div className="notice notice-warn mb-4">Checkout was cancelled — the booth wasn&apos;t held. Feel free to try again.</div>
          )}
          <BoothReservationForm booths={booths} initialDate={startDate} initialReservations={reservationsForStartDate} />
        </>
      )}
    </div>
  );
}
