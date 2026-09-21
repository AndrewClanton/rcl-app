import { getAllBooths, getUpcomingBoothReservations, getBoothReservationsForMonth } from "@/lib/data/booths";
import BoothsAdminPanel from "./BoothsAdminPanel";

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
      <h1 className="mb-1 text-lg font-semibold">Booth reservations</h1>
      <p className="mb-4 max-w-2xl text-sm text-[var(--muted)]">
        Manage the 8 lounge booths (photo, capacity, reservation fee, active/inactive), see the schedule on a
        calendar, and see upcoming reservations.
      </p>
      <BoothsAdminPanel booths={booths} reservations={reservations} calendarMonthStart={calendarMonthStart} calendarReservations={calendarReservations} />
    </div>
  );
}
