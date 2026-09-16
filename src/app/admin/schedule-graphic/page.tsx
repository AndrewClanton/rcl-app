import { getUpcomingScreenings } from "@/lib/data/screenings";
import { getUpcomingEvents } from "@/lib/data/events";
import { getUpcomingCalendarNotes } from "@/lib/data/calendar-notes";
import ScheduleGraphicBuilder from "./ScheduleGraphicBuilder";

export const dynamic = "force-dynamic";

export default async function ScheduleGraphicPage() {
  const [screenings, events, notes] = await Promise.all([
    getUpcomingScreenings(),
    getUpcomingEvents(),
    getUpcomingCalendarNotes(),
  ]);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Weekly schedule graphic</h1>
      <p className="mb-4 max-w-2xl text-sm text-neutral-500">
        Pulls straight from the live showtimes and booked private events -- no re-typing the schedule into Canva.
        Grouped day by day, so a booked-out room (private event, entire building, outdoor cinema, etc.) shows up
        right alongside that day's screenings instead of getting lost. Add a custom note for anything that isn't a
        real screening or booking (e.g. "6-9pm: closed for a private party"). Pick a date range, uncheck anything
        you don't want on it, then download the image.
      </p>
      <ScheduleGraphicBuilder
        screenings={screenings.map((s) => ({ id: s.id, title: s.movie.title, startsAt: s.starts_at, room: s.room.name }))}
        events={events.map((e) => ({
          id: e.id,
          name: e.event_name,
          date: e.event_date,
          time: e.event_time,
          hours: e.hours,
          room: e.room.name,
        }))}
        notes={notes.map((n) => ({
          id: n.id,
          date: n.note_date,
          startTime: n.start_time,
          endTime: n.end_time,
          label: n.label,
        }))}
      />
    </div>
  );
}
