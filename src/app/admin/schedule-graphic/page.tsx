import { getUpcomingScreenings, isRestrictedRelease } from "@/lib/data/screenings";
import { getUpcomingEvents } from "@/lib/data/events";
import { getUpcomingCalendarNotes } from "@/lib/data/calendar-notes";
import PageHeader from "@/components/admin/PageHeader";
import ScheduleGraphicBuilder from "./ScheduleGraphicBuilder";

export const dynamic = "force-dynamic";

export default async function ScheduleGraphicPage() {
  const [screenings, events, notes] = await Promise.all([getUpcomingScreenings(), getUpcomingEvents(), getUpcomingCalendarNotes()]);

  return (
    <div>
      <PageHeader area="shows" title="Weekly flyer" purpose="Make an image of the lineup for email and social posts, straight from the live showtimes." className="!mb-3" />
      <p className="mb-4 max-w-2xl text-sm text-[var(--muted)]">
        Pulls straight from the live showtimes and booked private events -- no re-typing the schedule into Canva.
        Pick a date range, choose the audience, uncheck anything you don&apos;t want on it, then download the image.
        &quot;Public&quot; only includes this year&apos;s releases (all our license lets us advertise); &quot;Members&quot; adds
        the older titles and is marked on the image itself as email-list only. Private events always show as &quot;Private event&quot;,
        never the client&apos;s name or the party&apos;s name.
      </p>
      <ScheduleGraphicBuilder
        // Every upcoming screening, with the ones our MPLC license doesn't let
        // us advertise flagged -- the builder hides those for a Public flyer
        // and the image route enforces the same rule server-side.
        screenings={screenings.map((s) => ({ id: s.id, title: s.movie.title, startsAt: s.starts_at, room: s.room.name, restricted: isRestrictedRelease(s.movie) }))}
        // The name is only for staff picking what goes on; the flyer itself
        // always says "Private event". An inquiry nobody has confirmed yet
        // (nothing paid) starts unchecked.
        events={events.map((e) => ({
          id: e.id,
          name: e.event_name,
          date: e.event_date,
          time: e.event_time,
          hours: e.hours,
          room: e.room.name,
          confirmed: e.status === "paid" || Number(e.deposit_paid) > 0,
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
