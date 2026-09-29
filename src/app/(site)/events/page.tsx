import type { Metadata } from "next";
import { getRooms } from "@/lib/data/rooms";
import EventBookingForm from "./EventBookingForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Private Events",
  description: "Book a space at Royale Cinema Lounge for a private screening, party, or gathering.",
};

export default async function EventsPage() {
  const rooms = (await getRooms()).filter((r) => r.is_event_space);

  return (
    <div>
      <span className="page-eyebrow">Private events</span>
      <h1 className="font-display mt-3 text-4xl leading-none sm:text-5xl">Have the place to yourselves</h1>
      <p className="mt-3 mb-10 max-w-2xl text-[15px] text-[var(--muted)]">
        A private screening, a birthday, a work night out. Tell us what you have in mind and we&apos;ll follow up by email to confirm the details and arrange a deposit.
      </p>
      <EventBookingForm rooms={rooms} />
    </div>
  );
}
