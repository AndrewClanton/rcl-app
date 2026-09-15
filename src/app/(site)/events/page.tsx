import { getRooms } from "@/lib/data/rooms";
import EventBookingForm from "./EventBookingForm";

export const dynamic = "force-dynamic";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export default async function EventsPage() {
  const rooms = (await getRooms()).filter((r) => r.is_event_space);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Private events</h1>
      <p className="mb-6 max-w-2xl text-neutral-600 dark:text-neutral-400">
        Book a space for a private screening, party, or gathering. Submit a request below and we&apos;ll follow up to confirm details and arrange a deposit.
      </p>

      <div className="mb-8 grid gap-3 sm:grid-cols-2">
        {rooms.map((r) => (
          <div key={r.id} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <div className="font-medium">{r.name}</div>
            <div className="mt-1 text-sm text-neutral-500">
              {money(r.hourly_rate ?? 0)}/hr · capacity {r.capacity} · {money(r.cleaning_fee ?? 0)} cleaning fee
            </div>
          </div>
        ))}
      </div>

      <EventBookingForm rooms={rooms} />
    </div>
  );
}
