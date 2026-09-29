import type { Metadata } from "next";
import { getRooms } from "@/lib/data/rooms";
import EventBookingForm from "./EventBookingForm";
import { PageMasthead } from "@/components/print";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Private Events",
  description: "Book a space at Royale Cinema Lounge for a private screening, party, or gathering.",
};

export default async function EventsPage() {
  const rooms = (await getRooms()).filter((r) => r.is_event_space);

  return (
    <div>
      <PageMasthead
        eyebrow="Private events"
        title="Have the place to yourselves"
        intro="A private screening, a birthday, a work night out. Tell us what you have in mind and we'll follow up by email to confirm the details and arrange a deposit."
      />
      <EventBookingForm rooms={rooms} />
    </div>
  );
}
