import { getMovies } from "@/lib/data/movies";
import { getRooms } from "@/lib/data/rooms";
import { getUpcomingScreenings } from "@/lib/data/screenings";
import { getRecentHouseEvents } from "@/lib/data/house-events";
import ScreeningManager from "./ScreeningManager";
import HouseEvents from "./HouseEvents";

export const dynamic = "force-dynamic";

export default async function AdminScreeningsPage() {
  const [movies, rooms, screenings, events] = await Promise.all([getMovies(), getRooms(), getUpcomingScreenings(), getRecentHouseEvents()]);
  return (
    <>
      <ScreeningManager movies={movies} rooms={rooms} screenings={screenings} />
      <HouseEvents events={events} />
    </>
  );
}
