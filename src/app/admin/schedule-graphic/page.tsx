import { getUpcomingScreenings, isRestrictedRelease } from "@/lib/data/screenings";
import { getUpcomingEvents } from "@/lib/data/events";
import { getUpcomingCalendarNotes } from "@/lib/data/calendar-notes";
import ScheduleGraphicBuilder from "./ScheduleGraphicBuilder";

export const dynamic = "force-dynamic";

export default async function ScheduleGraphicPage() {
  const [screenings, events, notes] = await Promise.all([getUpcomingScreenings(), getUpcomingEvents(), getUpcomingCalendarNotes()]);

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold">Weekly flyer</h1>
      <p className="mb-4 max-w-2xl text-sm text-[var(--muted)]">
        Pulls straight from the live showtimes and booked private events -- no re-typing the schedule into Canva.
        Pick a date range, choose the audience, uncheck anything you don&apos;t want on it, then download the image.
        &quot;Public&quot; only includes this year&apos;s releases (all our license lets us advertise); &quot;Members&quot; adds
        the older titles and is marked on the image itself as email-list only.
      </p>
      <ScheduleGraphicBuilder
        // Every upcoming screening, with the ones our MPLC license doesn't let
        // us advertise flagged -- the builder hides those for a Public flyer
        // and the image route enforces the same rule server-side.
        screenings={screenings.map((s) => ({ id: s.id, title: s.movie.title, startsAt: s.starts_at, room: s.room.name, restricted: isRestrictedRelease(s.movie) }))}
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
