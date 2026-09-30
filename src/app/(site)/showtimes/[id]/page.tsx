import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getScreeningById, memberHasBookingFor } from "@/lib/data/screening-detail";
import { isRestrictedRelease, isWithinPublicWindow } from "@/lib/data/screenings";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import MoviePoster from "@/components/MoviePoster";
import { jsonLdScript, screeningEventJsonLd } from "@/lib/seo/screening-events";
import TicketReservation from "./TicketReservation";
import TicketCard, { type TicketCardTicket } from "@/components/TicketCard";
import { SpecFoot } from "@/components/print";
import { getSignedInMember } from "@/lib/member-auth";
import { hasPlusPerks } from "@/lib/plus-checkout";
import { RATE_PRICE } from "@/lib/membership-rates";
import { issueFormToken } from "@/lib/public-form-guard";
import { pageMeta } from "@/lib/seo/page-meta";

export const dynamic = "force-dynamic";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Cut at a word, for a description that stops mid-sentence cleanly.
function clip(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).replace(/[\s,;:.-]+$/, "")}…`;
}

// The title and link preview name the film and when it plays ("The Musical ·
// Wed 10/1, 7:00 PM"). The preview image is opengraph-image.tsx next to this
// page: the poster with the day and time.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const path = `/showtimes/${id}`;
  const screening = await getScreeningById(id);
  if (!screening || !isWithinPublicWindow(screening.starts_at)) return { title: "Showtime", robots: { index: false, follow: false } };

  // An older title (MPLC) can be reached by direct link -- the members'
  // email -- but must not be advertised. Keep it out of search results, and
  // give link previews (a share on Facebook, a text message) nothing that
  // names the movie. (Its preview image is the plain site card.)
  if (isRestrictedRelease(screening.movie)) {
    const generic = "A screening at Royale Cinema Lounge";
    const meta = pageMeta({ title: "Members' screening", description: "Royale Cinema Lounge, Joplin, MO.", path, image: null, noindex: true });
    return { ...meta, openGraph: { ...meta.openGraph, title: generic }, twitter: { ...meta.twitter, title: generic } };
  }

  const start = new Date(screening.starts_at);
  const day = start.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "America/Chicago" }).replace(",", "");
  const when = `${day}, ${start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })}`;
  const price = screening.ticket_price === 0 ? "Free" : `${money(screening.ticket_price)} + tax`;
  const lead = `${screening.movie.title} at Royale Cinema Lounge, Joplin, MO · ${when} · ${price}.`;
  return pageMeta({
    title: `${screening.movie.title} · ${when}`,
    description: screening.movie.synopsis ? `${lead} ${clip(screening.movie.synopsis, Math.max(60, 200 - lead.length))}` : lead,
    path,
    image: null,
  });
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
  // A showtime that has started (or isn't public yet) is a 404 -- except for
  // the customer coming back from checkout. Stripe's page stays open for 30
  // minutes, so someone who clicked Buy at 6:59 for a 7:00 show can finish
  // paying at 7:01; they still get their confirmation and the ticket's QR
  // code (their only copy). That's checked below; anything else is a 404.
  const isPublic = isWithinPublicWindow(screening.starts_at);
  const checkoutReturn = (checkout === "success" && !!session_id) || (checkout === "free" && !!booking_id);
  if (!isPublic && !checkoutReturn) notFound();

  const seatsLeft = Math.max(0, screening.capacity - screening.booked_quantity);
  const member = await getSignedInMember();
  // The free Insiders+ seat is one per screening, so a member who already
  // booked this show pays for any more.
  const plus = !!member && hasPlusPerks(member);
  const freeSeat = plus && !(await memberHasBookingFor(id, member!.id));
  const me = member?.email ? { name: member.name, email: member.email, plus, freeSeat } : null;
  // Only a public showtime is described to search engines.
  const eventJsonLd = isPublic ? screeningEventJsonLd(screening, seatsLeft) : null;

  // Never trust the ?checkout=success URL param on its own -- verify the
  // session actually shows as paid with Stripe before showing a
  // confirmation. The webhook is what actually flips the booking to
  // 'confirmed' in the DB; this is purely about what message to show the
  // customer who just got redirected back here.
  let paymentConfirmed = false;
  let paidForThisShow = false;
  let paidBookingId: string | null = null;
  if (checkout === "success" && session_id) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(session_id);
      paymentConfirmed = session.payment_status === "paid";
      paidForThisShow = paymentConfirmed && session.metadata?.screening_id === id;
      // The booking it paid for, for its ticket code below (only if the
      // session was for this showing).
      if (paidForThisShow) paidBookingId = session.metadata?.booking_id ?? null;
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
  // Past the start time, only a payment or booking for this very showing
  // opens the page (a paid session for some other show doesn't).
  if (!isPublic && !paidForThisShow && !freeEntryConfirmed) notFound();

  // The tickets they just got, with the QR code for the door. A paid
  // booking can still read "pending" for a moment until Stripe's webhook
  // lands; its code works at the door once it has.
  let ticket: TicketCardTicket | null = null;
  let savedToAccount = false;
  const newBookingId = paymentConfirmed ? paidBookingId : freeEntryConfirmed ? booking_id : null;
  if (newBookingId) {
    const { data: b } = await createAdminClient().from("bookings").select("id, quantity, member_id, status").eq("id", newBookingId).eq("screening_id", id).maybeSingle();
    if (b && (b.status === "confirmed" || b.status === "pending")) {
      ticket = {
        bookingId: b.id,
        title: screening.movie.title,
        posterUrl: screening.movie.poster_url,
        startsAt: screening.starts_at,
        room: screening.room.name.split(" — ")[0],
        quantity: b.quantity,
      };
      savedToAccount = !!b.member_id;
    }
  }
  const keepIt = savedToAccount ? "Your tickets are saved in your account too, under Movies." : "Take a screenshot so it's handy at the door.";

  const when = new Date(screening.starts_at);
  const day = when.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Chicago" });
  const shortDay = when.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "America/Chicago" });
  const time = when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
  const outdoor = screening.room.name.toLowerCase().includes("outdoor");
  const spec: [string, string][] = [
    ["Date", shortDay],
    ["Time", time],
    ["Runtime", screening.movie.runtime_minutes ? `${screening.movie.runtime_minutes} min` : "—"],
    ["Rating", screening.movie.rating || "NR"],
    ["Ticket", screening.ticket_price === 0 ? "Free" : `${money(screening.ticket_price)} + tax`],
    ["Seats left", seatsLeft > 0 ? String(seatsLeft) : "Sold out"],
  ];

  return (
    <div className="mx-auto max-w-4xl">
      {eventJsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(eventJsonLd) }} />}
      <div className="masthead-rule mb-8 pb-6">
        <span className="page-eyebrow">{day}</span>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="font-display text-4xl leading-[0.95] text-balance sm:text-5xl">{screening.movie.title}</h1>
        </div>
      </div>

      <div className="grid gap-8 md:grid-cols-[230px_1fr]">
        <div className="relative mx-auto w-44 md:w-full">
          <div className="sheet overflow-hidden !border-4 !shadow-[7px_7px_0_var(--foreground)]">
            <MoviePoster posterUrl={screening.movie.poster_url} title={screening.movie.title} sizes="230px" priority />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {outdoor && <span className="ctag ctag-yellow">Outdoor</span>}
            {seatsLeft > 0 && seatsLeft <= 10 && <span className="ctag ctag-red">{seatsLeft} left</span>}
            {seatsLeft <= 0 && <span className="ctag ctag-red">Sold out</span>}
          </div>
        </div>

        <div className="min-w-0 space-y-7">
          {/* The showtime as a spec panel -- hard data in a grid, like the
              Royale Proof Sheet sets it. */}
          <section className="sheet crop">
            <div className="spec-head rounded-t-[4px]">
              <span>{screening.room.name}</span>
              <span className="flex items-center gap-4">
                <span>{time}</span>
              </span>
            </div>
            <div className="spec-grid">
              {spec.map(([k, v]) => (
                <div key={k} className="spec-cell">
                  <div className="spec-k">{k}</div>
                  <div className={`spec-v ${k === "Ticket" ? "text-[var(--accent)]" : ""}`}>{v}</div>
                </div>
              ))}
            </div>
            {screening.movie.synopsis && <p className="border-t border-[var(--border)] px-4 py-4 text-[15px] leading-relaxed">{screening.movie.synopsis}</p>}
            <SpecFoot />
          </section>

          {paymentConfirmed ? (
            <div className="space-y-7">
              <div className="sheet p-5">
                <span className="ctag ctag-yellow">Paid</span>
                <h2 className="font-display mt-3 text-2xl">You&apos;re all set.</h2>
                <p className="mt-2 text-[15px]">Your tickets are confirmed. Stripe emailed your receipt. See you at {time}.</p>
                {ticket && <p className="mt-2 text-[15px]">{keepIt}</p>}
              </div>
              {ticket && <TicketCard t={ticket} />}
            </div>
          ) : freeEntryConfirmed ? (
            <div className="space-y-7">
              <div className="sheet p-5">
                <span className="ctag ctag-yellow">Insiders+</span>
                <h2 className="font-display mt-3 text-2xl">You&apos;re in.</h2>
                <p className="mt-2 text-[15px]">Your membership covered this ticket, no charge. See you at {time}.</p>
                {ticket && <p className="mt-2 text-[15px]">{keepIt}</p>}
              </div>
              {ticket && <TicketCard t={ticket} />}
            </div>
          ) : (
          <>
            {checkout === "cancelled" && (
              <div className="notice notice-warn mb-4">Checkout was cancelled — your seats weren&apos;t held. Feel free to try again.</div>
            )}
            <TicketReservation
              screeningId={screening.id}
              ticketPrice={screening.ticket_price}
              seatsLeft={seatsLeft}
              me={me}
              plusPrice={RATE_PRICE[member?.price_tier ?? "adult"]}
              formToken={issueFormToken("tickets")}
            />
          </>
        )}
        </div>
      </div>
    </div>
  );
}
