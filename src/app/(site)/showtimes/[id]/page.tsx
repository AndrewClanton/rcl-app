import { notFound } from "next/navigation";
import { getScreeningById } from "@/lib/data/screening-detail";
import { getStripe } from "@/lib/stripe";
import TicketReservation from "./TicketReservation";

export const dynamic = "force-dynamic";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default async function ScreeningDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checkout?: string; session_id?: string }>;
}) {
  const { id } = await params;
  const { checkout, session_id } = await searchParams;
  const screening = await getScreeningById(id);
  if (!screening) notFound();

  const seatsLeft = Math.max(0, screening.capacity - screening.booked_quantity);

  // Never trust the ?checkout=success URL param on its own -- verify the
  // session actually shows as paid with Stripe before showing a
  // confirmation. The webhook is what actually flips the booking to
  // 'confirmed' in the DB; this is purely about what message to show the
  // customer who just got redirected back here.
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
    <div className="mx-auto max-w-lg">
      <h1 className="text-2xl font-semibold">{screening.movie.title}</h1>
      <div className="mt-1 text-neutral-500">
        {new Date(screening.starts_at).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}
      </div>
      <div className="text-neutral-500">
        {screening.room.name}
        {screening.movie.runtime_minutes ? ` · ${screening.movie.runtime_minutes} min` : ""}
        {screening.movie.rating ? ` · ${screening.movie.rating}` : ""}
      </div>
      {screening.movie.synopsis && <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">{screening.movie.synopsis}</p>}
      <div className="mt-2 text-lg font-medium">{money(screening.ticket_price)} / ticket</div>

      <div className="mt-6">
        {paymentConfirmed ? (
          <div className="rounded-xl border border-green-300 bg-green-50 p-6 dark:border-green-800 dark:bg-green-950">
            <h2 className="text-lg font-semibold text-green-900 dark:text-green-300">Payment received!</h2>
            <p className="mt-2 text-sm text-green-800 dark:text-green-400">
              Your tickets are confirmed. A receipt was sent to your email by Stripe.
            </p>
          </div>
        ) : (
          <>
            {checkout === "cancelled" && (
              <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                Checkout was cancelled — your seats weren&apos;t held. Feel free to try again.
              </div>
            )}
            <TicketReservation screeningId={screening.id} ticketPrice={screening.ticket_price} seatsLeft={seatsLeft} />
          </>
        )}
      </div>
    </div>
  );
}
