import { getUpcomingEvents } from "@/lib/data/events";
import PageHeader from "@/components/admin/PageHeader";
import EventsList from "./EventsList";

export const dynamic = "force-dynamic";

export default async function AdminEventsPage() {
  const events = await getUpcomingEvents();
  return (
    <div>
      <PageHeader area="shows" title="Private events" purpose="Party and venue bookings: when, which room, the deposit, and what's still owed." />
      <EventsList events={events} />
    </div>
  );
}
