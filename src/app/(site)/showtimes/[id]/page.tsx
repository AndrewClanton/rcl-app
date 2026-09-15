import { notFound } from "next/navigation";
import { getScreeningById } from "@/lib/data/screening-detail";
import TicketReservation from "./TicketReservation";

export const dynamic = "force-dynamic";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default async function ScreeningDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const screening = await getScreeningById(id);
  if (!screening) notFound();

  const seatsLeft = Math.max(0, screening.capacity - screening.booked_quantity);

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
        <TicketReservation screeningId={screening.id} ticketPrice={screening.ticket_price} seatsLeft={seatsLeft} />
      </div>
    </div>
  );
}
