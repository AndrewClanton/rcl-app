import { getRooms } from "@/lib/data/rooms";
import { createPublicClient } from "@/lib/supabase/public";
import EventBookingForm from "./EventBookingForm";
import { PageMasthead } from "@/components/print";
import { pageMeta } from "@/lib/seo/page-meta";

// The same page for everyone (the spaces and their prices), rebuilt at most
// every five minutes. The request form itself is sent by a Server Action.
export const revalidate = 300;

export const metadata = pageMeta({
  title: "Private Events",
  description: "Book a space at Royale Cinema Lounge in Joplin, MO for a private screening, party, or gathering.",
  path: "/events",
});

export default async function EventsPage() {
  const rooms = (await getRooms(createPublicClient())).filter((r) => r.is_event_space);

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
