import QRCode from "qrcode";
import MoviePoster from "@/components/MoviePoster";
import { ticketCode } from "@/lib/ticket-code";
import { businessDay, clock, shortDay } from "@/lib/ops/time";

// An online booking as the customer carries it to the door: the showing,
// how many seats, and a big QR code the register scans to print their
// keepsake tickets (lib/ticket-scan.ts). Server-only, since the code is
// signed with a server secret. Used on the account's ticket pages and the
// showtime page's confirmation after checkout.

export const DOOR_NOTE = "Show this at the door, or scan it at the counter, and your tickets print right away.";

export interface TicketCardTicket {
  bookingId: string;
  title: string;
  posterUrl: string | null;
  startsAt: string;
  room: string;
  quantity: number;
  atRegister?: boolean; // bought at the register: printed with the sale
  scannedAt?: string | null; // printed at the door already
}

const TZ = "America/Chicago";

// 5 p.m. on (or the small hours, still the same business day): "Tonight".
function evening(iso: string) {
  const hour = Number(new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", hourCycle: "h23", timeZone: TZ }));
  return hour >= 17 || hour < 4;
}

export default async function TicketCard({ t, priority = false }: { t: TicketCardTicket; priority?: boolean }) {
  const today = businessDay().date;
  const showDay = businessDay(new Date(t.startsAt)).date;
  const passed = showDay < today;
  const code =
    !t.atRegister && !t.scannedAt && !passed
      ? await QRCode.toDataURL(ticketCode(t.bookingId), { margin: 1, width: 480, errorCorrectionLevel: "M", color: { dark: "#14110c", light: "#ffffff" } })
      : null;
  // "Sep 29" in the spec grid (it fits three across on a phone); the head
  // says "Tonight" or the weekday.
  const date = new Date(t.startsAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: TZ });
  const day = new Date(t.startsAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ });
  const printedAt = t.scannedAt ? (businessDay(new Date(t.scannedAt)).date === today ? `at ${clock(t.scannedAt)}` : `on ${shortDay(t.scannedAt)}`) : "";

  return (
    <article className="sheet crop">
      <div className="spec-head rounded-t-[4px]">
        <span>{t.room}</span>
        <span>{showDay === today ? (evening(t.startsAt) ? "Tonight" : "Today") : day}</span>
      </div>
      <div className="flex items-center gap-4 p-5">
        <div className="w-16 shrink-0 overflow-hidden rounded-[3px] border-2 border-[var(--foreground)]">
          <MoviePoster posterUrl={t.posterUrl} title={t.title} sizes="64px" priority={priority} />
        </div>
        <h3 className="font-display min-w-0 text-2xl leading-tight text-balance">{t.title}</h3>
      </div>
      <dl className="spec-grid spec-grid-3 border-y border-[var(--border)]">
        <div className="spec-cell">
          <dt className="spec-k">Date</dt>
          <dd className="spec-v">{date}</dd>
        </div>
        <div className="spec-cell">
          <dt className="spec-k">Time</dt>
          <dd className="spec-v">{clock(t.startsAt)}</dd>
        </div>
        <div className="spec-cell !bg-[var(--gold)]">
          <dt className="spec-k !text-[var(--foreground)]">Seats</dt>
          <dd className="spec-v">{t.quantity}</dd>
        </div>
      </dl>
      <div className="flex flex-col items-center gap-4 px-5 py-6 text-center">
        {code ? (
          <>
            <div className="w-full max-w-[256px] rounded-[4px] border-2 border-[var(--foreground)] bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL, not an optimizable remote/static asset */}
              <img src={code} alt={`Ticket code for ${t.title}`} width={240} height={240} className="h-auto w-full [image-rendering:pixelated]" />
            </div>
            <p className="max-w-[34ch] text-[15px] font-bold">{DOOR_NOTE}</p>
          </>
        ) : t.atRegister ? (
          <p className="max-w-[36ch] text-[15px]">These tickets were printed at the register when you bought them. Enjoy the show!</p>
        ) : t.scannedAt ? (
          <>
            <span className="ctag ctag-yellow">Printed</span>
            <p className="max-w-[36ch] text-[15px]">Your tickets were printed {printedAt}. Enjoy the show!</p>
          </>
        ) : (
          <p className="max-w-[36ch] text-[15px] text-[var(--muted)]">This showing has passed. Thanks for coming!</p>
        )}
      </div>
    </article>
  );
}
