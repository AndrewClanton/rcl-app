import { getAllBooths, getUpcomingBoothReservations, getBoothReservationsForMonth } from "@/lib/data/booths";
import PageHeader from "@/components/admin/PageHeader";
import BoothsAdminPanel from "./BoothsAdminPanel";
import InfoTip from "@/components/help/InfoTip";

export const dynamic = "force-dynamic";

function currentMonthStartCentral() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  return `${today.slice(0, 7)}-01`;
}

export default async function AdminBoothsPage() {
  const calendarMonthStart = currentMonthStartCentral();
  const [y, m] = calendarMonthStart.split("-").map(Number);
  const calendarMonthEnd = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  const [booths, reservations, calendarReservations] = await Promise.all([
    getAllBooths(),
    getUpcomingBoothReservations(),
    getBoothReservationsForMonth(calendarMonthStart, calendarMonthEnd),
  ]);
  return (
    <div>
      <PageHeader
        titleAside={<InfoTip topic="booths" />}
        area="shows"
        title="Booths"
        purpose="Upcoming booth reservations, the booking calendar, and each of the 8 lounge booths: photo, size, fee, and whether it can be booked."
      />
      <BoothsAdminPanel booths={booths} reservations={reservations} calendarMonthStart={calendarMonthStart} calendarReservations={calendarReservations} />
    </div>
  );
}
