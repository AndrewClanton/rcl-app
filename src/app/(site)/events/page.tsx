import type { Metadata } from "next";
import { getRooms } from "@/lib/data/rooms";
import EventBookingForm from "./EventBookingForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Private Events",
  description: "Book a space at Royale Cinema Lounge for a private screening, party, or gathering.",
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default async function EventsPage() {
  const rooms = (await getRooms()).filter((r) => r.is_event_space);

  return (
    <div>
      <h1 className="font-display mb-2 text-3xl font-semibold">Private events</h1>
      <p className="mb-8 max-w-2xl text-[var(--muted)]">
        Book a space for a private screening, party, or gathering. Submit a request below and we&apos;ll follow up to confirm details and arrange a deposit.
      </p>

      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        {rooms.map((r) => (
          <div key={r.id} className="card">
            <div className="font-medium">{r.name}</div>
            <div className="mt-1 text-sm text-[var(--muted)]">
              {money(r.hourly_rate ?? 0)}/hr · capacity {r.capacity} · {money(r.cleaning_fee ?? 0)} cleaning fee
            </div>
          </div>
        ))}
      </div>

      <EventBookingForm rooms={rooms} />
    </div>
  );
}
