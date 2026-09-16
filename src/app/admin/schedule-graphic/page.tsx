import { getUpcomingScreenings } from "@/lib/data/screenings";
import { getUpcomingEvents } from "@/lib/data/events";
import ScheduleGraphicBuilder from "./ScheduleGraphicBuilder";

export const dynamic = "force-dynamic";

export default async function ScheduleGraphicPage() {
  const [screenings, events] = await Promise.all([getUpcomingScreenings(), getUpcomingEvents()]);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Weekly schedule graphic</h1>
      <p className="mb-4 max-w-2xl text-sm text-neutral-500">
        Pulls straight from the live showtimes and booked private events -- no re-typing the schedule into Canva.
        Grouped day by day, so a booked-out room (private event, entire building, outdoor cinema, etc.) shows up
        right alongside that day's screenings instead of getting lost. Pick a date range, uncheck anything you don't
        want on it, then download the image.
      </p>
      <ScheduleGraphicBuilder
        screenings={screenings.map((s) => ({ id: s.id, title: s.movie.title, startsAt: s.starts_at }))}
        events={events.map((e) => ({
          id: e.id,
          name: e.event_name,
          date: e.event_date,
          time: e.event_time,
          hours: e.hours,
          room: e.room.name,
        }))}
      />
    </div>
  );
}
