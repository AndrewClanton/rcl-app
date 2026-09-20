import { getAllBooths, getUpcomingBoothReservations } from "@/lib/data/booths";
import BoothsAdminPanel from "./BoothsAdminPanel";

export const dynamic = "force-dynamic";

export default async function AdminBoothsPage() {
  const [booths, reservations] = await Promise.all([getAllBooths(), getUpcomingBoothReservations()]);
  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Booth reservations</h1>
      <p className="mb-4 max-w-2xl text-sm text-neutral-500">
        Manage the 8 lounge booths (capacity, reservation fee, active/inactive) and see upcoming paid reservations.
      </p>
      <BoothsAdminPanel booths={booths} reservations={reservations} />
    </div>
  );
}
