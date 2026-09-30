import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasManagerAccess } from "@/lib/auth";
import { businessDay, businessDayWindow, shiftDate } from "@/lib/ops/time";
import { getTicketCounts } from "@/lib/data/screenings";
import type { EmployeeRole } from "@/lib/types";

// The rest of Back office → Today (the TodayBoard in ./backoffice.ts has
// tonight): to-dos for this person and for whoever's on shift, the week
// ahead, and which back-office pages people in this role open most (from
// the site's own usage counts, Reports → Website usage, which keep the role
// and never who). Read only. Each part is read on its own; a failed read is
// null and the page just leaves that part out.

export interface HomeTodo {
  id: string;
  title: string;
  details: string | null;
  dueDate: string | null;
}

export interface WeekAheadShow {
  id: string;
  startsAt: string;
  title: string;
  room: string;
  sold: number;
  capacity: number;
}

export interface WeekAheadDay {
  date: string; // business date
  shows: WeekAheadShow[];
  houseEvents: { id: string; startsAt: string; title: string }[];
}

export interface HomeExtras {
  // Open to-dos: assigned to this person, and for anyone on shift. The
  // managers' restock to-dos are on the board (Needs a look).
  todos: { mine: HomeTodo[]; shift: HomeTodo[]; teamOpen: number | null } | null;
  // The next seven business days after today.
  weekAhead: WeekAheadDay[] | null;
  // Back-office pages people in this role opened most in the last 30 days.
  roleTop: { pattern: string; views: number }[] | null;
}

async function quietly<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

// The board's private events run to a week out, so the week ahead does too.
const AHEAD_DAYS = 7;

export async function getHomeExtras(staff: { employeeId: string; role: EmployeeRole }): Promise<HomeExtras> {
  const db = createAdminClient();
  const today = businessDay().date;
  const manager = hasManagerAccess(staff.role);

  const [todos, weekAhead, roleTop] = await Promise.all([
    quietly(async () => {
      const [open, all] = await Promise.all([
        db
          .from("staff_todos")
          .select("id, title, details, assignee_id, due_date, audience")
          .is("done_at", null)
          .is("audience", null)
          .or(`assignee_id.eq.${staff.employeeId},assignee_id.is.null`)
          .order("due_date", { ascending: true, nullsFirst: false })
          .order("created_at"),
        manager ? db.from("staff_todos").select("id", { count: "exact", head: true }).is("done_at", null) : null,
      ]);
      if (open.error) throw open.error;
      if (all?.error) throw all.error;
      const row = (t: { id: string; title: string; details: string | null; due_date: string | null }): HomeTodo => ({ id: t.id, title: t.title, details: t.details, dueDate: t.due_date });
      return {
        mine: open.data.filter((t) => t.assignee_id === staff.employeeId).map(row),
        shift: open.data.filter((t) => !t.assignee_id).map(row),
        teamOpen: all ? (all.count ?? 0) : null,
      };
    }),
    quietly(async () => {
      const from = businessDayWindow(shiftDate(today, 1)).start;
      const to = businessDayWindow(shiftDate(today, AHEAD_DAYS)).end;
      const [shows, house] = await Promise.all([
        db.from("screenings").select("id, starts_at, capacity, movie:movies(title), room:rooms(name)").gte("starts_at", from).lt("starts_at", to).order("starts_at"),
        db.from("house_events").select("id, title, starts_at").gte("starts_at", from).lt("starts_at", to).order("starts_at"),
      ]);
      if (shows.error) throw shows.error;
      if (house.error) throw house.error;
      const rows = shows.data as unknown as { id: string; starts_at: string; capacity: number; movie: { title: string } | null; room: { name: string } | null }[];
      const tickets = await getTicketCounts(rows.map((r) => r.id));
      const days: WeekAheadDay[] = Array.from({ length: AHEAD_DAYS }, (_, i) => ({ date: shiftDate(today, i + 1), shows: [], houseEvents: [] }));
      const dayOf = (iso: string) => days.find((d) => d.date === businessDay(new Date(iso)).date);
      for (const r of rows) {
        dayOf(r.starts_at)?.shows.push({ id: r.id, startsAt: r.starts_at, title: r.movie?.title ?? "Untitled", room: r.room?.name ?? "", sold: tickets[r.id]?.sold ?? 0, capacity: r.capacity });
      }
      for (const h of house.data) dayOf(h.starts_at as string)?.houseEvents.push({ id: h.id as string, startsAt: h.starts_at as string, title: h.title as string });
      return days;
    }),
    quietly(async () => {
      // The latest 1,000 views is plenty to rank a role's pages.
      const { data, error } = await db
        .from("page_views")
        .select("pattern")
        .eq("area", "admin")
        .eq("role", staff.role)
        .eq("not_found", false)
        .gte("business_date", shiftDate(today, -30))
        .order("business_date", { ascending: false })
        .limit(1000);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const v of data) counts.set(v.pattern as string, (counts.get(v.pattern as string) ?? 0) + 1);
      return [...counts.entries()].map(([pattern, views]) => ({ pattern, views })).sort((a, b) => b.views - a.views);
    }),
  ]);

  return { todos, weekAhead, roleTop };
}
