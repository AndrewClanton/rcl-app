import { getUpcomingEvents } from "@/lib/data/events";
import EventsList from "./EventsList";
import InfoTip from "@/components/help/InfoTip";

export const dynamic = "force-dynamic";

export default async function AdminEventsPage() {
  const events = await getUpcomingEvents();
  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">
        Event bookings
        <InfoTip topic="private-events" />
      </h1>
      <EventsList events={events} />
    </div>
  );
}
