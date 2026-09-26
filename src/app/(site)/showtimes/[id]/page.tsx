import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getScreeningById } from "@/lib/data/screening-detail";
import { isRestrictedRelease, isWithinPublicWindow } from "@/lib/data/screenings";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import MoviePoster from "@/components/MoviePoster";
import { jsonLdScript, screeningEventJsonLd } from "@/lib/seo/screening-events";
import TicketReservation from "./TicketReservation";

export const dynamic = "force-dynamic";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const screening = await getScreeningById(id);
  if (!screening || !isWithinPublicWindow(screening.starts_at)) return { title: "Showtime" };

  // An older title (MPLC) can be reached by direct link -- the members'
  // email -- but must not be advertised. Keep it out of search results, and
  // give link previews (a share on Facebook, a text message) nothing that
  // names the movie.
  if (isRestrictedRelease(screening.movie)) {
    return {
      title: "Members' screening",
      robots: { index: false, follow: false },
      openGraph: { title: "A screening at Royale Cinema Lounge", description: "Royale Cinema Lounge, Joplin, MO." },
      twitter: { title: "A screening at Royale Cinema Lounge", description: "Royale Cinema Lounge, Joplin, MO." },
    };
  }

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
    alternates: { canonical: `/showtimes/${screening.id}` },
    openGraph: screening.movie.poster_url ? { images: [{ url: screening.movie.poster_url }] } : undefined,
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
  if (!screening || !isWithinPublicWindow(screening.starts_at)) notFound();

  const seatsLeft = Math.max(0, screening.capacity - screening.booked_quantity);
  const eventJsonLd = screeningEventJsonLd(screening, seatsLeft);

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
      {eventJsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(eventJsonLd) }} />}
      <div className="grid gap-8 sm:grid-cols-[200px_1fr]">
        <div className="mx-auto w-40 sm:mx-0 sm:w-full">
          <MoviePoster posterUrl={screening.movie.poster_url} title={screening.movie.title} sizes="200px" priority />
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-3xl font-semibold">{screening.movie.title}</h1>
            {screening.room.name.toLowerCase().includes("outdoor") && <span className="stamp-tag stamp-tag-gold">Outdoor</span>}
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
          <div className="mt-3 text-lg font-semibold text-[var(--accent)]">
            {screening.ticket_price === 0 ? "Free" : `${money(screening.ticket_price)} / ticket`}
          </div>
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
