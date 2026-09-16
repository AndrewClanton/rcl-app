import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getScreeningById } from "@/lib/data/screening-detail";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import MoviePoster from "@/components/MoviePoster";
import TicketReservation from "./TicketReservation";

export const dynamic = "force-dynamic";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const screening = await getScreeningById(id);
  if (!screening) return { title: "Showtime" };

  const showtime = new Date(screening.starts_at).toLocaleString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
  const description = screening.movie.synopsis
    ? screening.movie.synopsis.slice(0, 155)
    : `${screening.movie.title} -- ${showtime} at Royale Cinema Lounge, Joplin, MO.`;

  return {
    title: `${screening.movie.title} -- ${showtime}`,
    description,
    openGraph: screening.movie.poster_path
      ? { images: [{ url: `https://image.tmdb.org/t/p/w780${screening.movie.poster_path}` }] }
      : undefined,
  };
}

export default async function ScreeningDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ checkout?: string; session_id?: string; booking_id?: string }>;
}) {
  const { id } = await params;
  const { checkout, session_id, booking_id } = await searchParams;
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

  // Insiders+ free-entry bookings skip Stripe entirely, so confirm those by
  // checking the booking's own DB status (already written server-side by
  // startCheckout) rather than a URL param.
  let freeEntryConfirmed = false;
  if (checkout === "free" && booking_id) {
    const { data: booking } = await createAdminClient()
      .from("bookings")
      .select("status")
      .eq("id", booking_id)
      .eq("screening_id", id)
      .maybeSingle();
    freeEntryConfirmed = booking?.status === "confirmed";
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="grid gap-8 sm:grid-cols-[200px_1fr]">
        <div className="mx-auto w-40 sm:mx-0 sm:w-full">
          <MoviePoster posterPath={screening.movie.poster_path} title={screening.movie.title} sizes="200px" priority />
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-3xl font-semibold">{screening.movie.title}</h1>
            {screening.room.name.toLowerCase().includes("outdoor") && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold tracking-wide text-emerald-800 uppercase dark:bg-emerald-900/40 dark:text-emerald-400">
                Outdoor
              </span>
            )}
          </div>
          <div className="mt-2 text-[var(--muted)]">
            {new Date(screening.starts_at).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })}
          </div>
          <div className="text-[var(--muted)]">
            {screening.room.name}
            {screening.movie.runtime_minutes ? ` · ${screening.movie.runtime_minutes} min` : ""}
            {screening.movie.rating ? ` · ${screening.movie.rating}` : ""}
          </div>
          {screening.movie.synopsis && <p className="mt-3 text-sm text-[var(--muted)]">{screening.movie.synopsis}</p>}
          <div className="mt-3 text-lg font-semibold text-[var(--accent)]">{money(screening.ticket_price)} / ticket</div>
        </div>
      </div>

      <div className="mt-8">
        {paymentConfirmed ? (
          <div className="notice notice-success">
            <h2 className="text-lg font-semibold">Payment received!</h2>
            <p className="mt-2 text-sm opacity-90">Your tickets are confirmed. A receipt was sent to your email by Stripe.</p>
          </div>
        ) : freeEntryConfirmed ? (
          <div className="notice notice-success">
            <h2 className="text-lg font-semibold">You&apos;re in!</h2>
            <p className="mt-2 text-sm opacity-90">Your Insiders+ membership covered this ticket — no charge. See you at the show.</p>
          </div>
        ) : (
          <>
            {checkout === "cancelled" && (
              <div className="notice notice-warn mb-4">Checkout was cancelled — your seats weren&apos;t held. Feel free to try again.</div>
            )}
            <TicketReservation screeningId={screening.id} ticketPrice={screening.ticket_price} seatsLeft={seatsLeft} />
          </>
        )}
      </div>
    </div>
  );
}
