import { getMovies } from "@/lib/data/movies";
import { getRooms } from "@/lib/data/rooms";
import { getTicketCounts, getUpcomingScreenings } from "@/lib/data/screenings";
import { getRecentHouseEvents } from "@/lib/data/house-events";
import PageHeader from "@/components/admin/PageHeader";
import ScreeningManager from "./ScreeningManager";
import HouseEvents from "./HouseEvents";

export const dynamic = "force-dynamic";

export default async function AdminScreeningsPage() {
  const [movies, rooms, screenings, events] = await Promise.all([getMovies(), getRooms(), getUpcomingScreenings(), getRecentHouseEvents()]);
  const tickets = await getTicketCounts(screenings.map((s) => s.id));
  return (
    <>
      <PageHeader
        area="shows"
        title="Showtimes"
        purpose="Add movies, schedule showings and see how many tickets each has sold. House events (trivia, comedy, the book swap) are at the bottom."
      />
      <ScreeningManager movies={movies} rooms={rooms} screenings={screenings} tickets={tickets} />
      <HouseEvents events={events} />
    </>
  );
}
