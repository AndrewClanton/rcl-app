import { getUpcomingScreenings } from "@/lib/data/screenings";
import ScheduleGraphicBuilder from "./ScheduleGraphicBuilder";

export const dynamic = "force-dynamic";

export default async function ScheduleGraphicPage() {
  const screenings = await getUpcomingScreenings();

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Weekly schedule graphic</h1>
      <p className="mb-4 max-w-2xl text-sm text-neutral-500">
        Pulls straight from the live showtimes -- no re-typing the schedule into Canva. Pick a date range, uncheck
        anything you don't want on it, then download the image to attach to this week's email or use on a pre-show
        slide.
      </p>
      <ScheduleGraphicBuilder
        screenings={screenings.map((s) => ({ id: s.id, title: s.movie.title, startsAt: s.starts_at }))}
      />
    </div>
  );
}
