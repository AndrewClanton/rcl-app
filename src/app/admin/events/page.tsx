import { getUpcomingEvents } from "@/lib/data/events";
import { getStaffSession } from "@/lib/auth";
import { seesFullContact } from "@/lib/contact-mask";
import PageHeader from "@/components/admin/PageHeader";
import EventsList from "./EventsList";
import InfoTip from "@/components/help/InfoTip";

export const dynamic = "force-dynamic";

export default async function AdminEventsPage() {
  // A cashier gets each organizer's email shortened before it reaches the
  // page (lib/contact-mask.ts). No session can't happen under the admin
  // layout, but would get the cashier view.
  const session = await getStaffSession();
  const role = session?.role ?? "cashier";
  const events = await getUpcomingEvents(role);
  return (
    <div>
      <PageHeader
        titleAside={<InfoTip topic="private-events" />} area="shows" title="Private events" purpose="Party and venue bookings: when, which room, the deposit, and what's still owed." />
      <EventsList events={events} fullContact={seesFullContact(role)} />
    </div>
  );
}
