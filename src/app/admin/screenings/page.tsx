import { getMovies } from "@/lib/data/movies";
import { getRooms } from "@/lib/data/rooms";
import { getUpcomingScreenings } from "@/lib/data/screenings";
import ScreeningManager from "./ScreeningManager";

export const dynamic = "force-dynamic";

export default async function AdminScreeningsPage() {
  const [movies, rooms, screenings] = await Promise.all([getMovies(), getRooms(), getUpcomingScreenings()]);
  return <ScreeningManager movies={movies} rooms={rooms} screenings={screenings} />;
}
