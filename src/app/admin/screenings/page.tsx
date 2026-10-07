import Link from "next/link";
import { getMovies } from "@/lib/data/movies";
import { getRooms } from "@/lib/data/rooms";
import { getTicketCounts, getUpcomingScreenings } from "@/lib/data/screenings";
import { getRecentHouseEvents } from "@/lib/data/house-events";
import { hasManagerAccess, requireStaff } from "@/lib/auth";
import PageHeader from "@/components/admin/PageHeader";
import ScreeningManager from "./ScreeningManager";
import HouseEvents from "./HouseEvents";

export const dynamic = "force-dynamic";

// Everyone on staff can look up the schedule and who holds tickets here;
// only managers and up can add, move or remove a showing or a house event.
// The actions check that again on their own.
export default async function AdminScreeningsPage() {
  const staff = await requireStaff();
  const canEdit = hasManagerAccess(staff.role);
  const [movies, rooms, screenings, events] = await Promise.all([getMovies(), getRooms(), getUpcomingScreenings(), getRecentHouseEvents()]);
  const tickets = await getTicketCounts(screenings.map((s) => s.id));
  return (
    <>
      <PageHeader
        area="shows"
        title="Showtimes"
        purpose="Add movies, schedule showings and see how many tickets each has sold. House events (trivia, comedy, the book swap) are at the bottom."
        actions={
          canEdit ? (
            <Link href="/admin/screenings/sync" className="btn-secondary inline-flex min-h-11 items-center text-base">
              Sync from calendar
            </Link>
          ) : undefined
        }
      />
      {!canEdit && (
        <p className="notice mb-4 text-sm">You can look up showings and who has tickets here. Adding, moving or removing a showing or a house event takes a manager.</p>
      )}
      <ScreeningManager movies={movies} rooms={rooms} screenings={screenings} tickets={tickets} canEdit={canEdit} />
      <HouseEvents events={events} canEdit={canEdit} />
    </>
  );
}
