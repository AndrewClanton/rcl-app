import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasAdminAccess, hasManagerAccess } from "@/lib/auth";
import { businessDay, businessDayWindow, shiftDate } from "@/lib/ops/time";
import { isOnline } from "@/lib/print/stations";
import { getDashboardSummary, type DashboardSummary } from "@/lib/data/reports";
import { getTicketCounts } from "@/lib/data/screenings";
import { getTimesheet, thisWeek } from "@/lib/data/team";
import { getTrainingOverview } from "@/lib/training/data";
import { getOftenOut } from "@/lib/ops/outages";
import { getRanOutWeek, type RanOutWeek } from "@/lib/data/ran-out";
import { ownerTabThisMonth } from "@/lib/data/owner-tab";
import { openFlags } from "@/lib/member-flags-server";
import { FLAG_REASONS } from "@/lib/member-flags";
import type { OftenOut } from "@/lib/ops/shared";
import type { PinStatus } from "@/lib/data/employees";
import type { EmployeeRole } from "@/lib/types";

// What the back office's menu and its Today page show about right now:
// open tabs, items marked out, printers that dropped off, notes waiting.
// Every figure is read on its own and a failed read is just left out, so a
// hiccup on one count never takes a page down with it.

export type BadgeKey = "tabs" | "itemsOut" | "printersOffline" | "devNotes" | "oldSite" | "pin";
// count: plain information. warn and danger are the status colors.
export type BadgeTone = "count" | "warn" | "danger";

export interface NavBadge {
  text: string;
  tone: BadgeTone;
  title: string; // the whole sentence, for a long press or a screen reader
}

export type NavBadges = Partial<Record<BadgeKey, NavBadge>>;

export interface Signals {
  tabs: { count: number; fromBefore: number } | null; // fromBefore: opened before today's business day began
  held: number | null;
  itemsOut: string[] | null;
  printers: { offline: string[]; open: boolean } | null; // open: someone is on shift, so printers should be on
  devNotes: number | null;
  oldSite: number | null;
  // Admins: accounts flagged at the register and not cleared yet
  // (lib/member-flags.ts), newest first. reason: its label.
  flagged: { memberId: string; name: string; reason: string }[] | null;
}

async function quietly<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Once per request, however many parts of the page ask.
export const getSignals = cache(async (role: EmployeeRole): Promise<Signals> => {
  const db = createAdminClient();
  const dayStart = Date.parse(businessDayWindow(businessDay().date).start);
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count: n, error } = await q;
    if (error) throw error;
    return n ?? 0;
  };

  const [tabs, held, itemsOut, printers, devNotes, oldSite, flagged] = await Promise.all([
    quietly(async () => {
      const { data, error } = await db.from("orders").select("created_at").eq("status", "tab");
      if (error) throw error;
      return { count: data.length, fromBefore: data.filter((o) => Date.parse(o.created_at as string) < dayStart).length };
    }),
    quietly(() => count(db.from("orders").select("id", { count: "exact", head: true }).eq("status", "held"))),
    quietly(async () => {
      const { data, error } = await db.from("menu_items").select("name").eq("active", true).not("out_since", "is", null).order("out_since");
      if (error) throw error;
      return data.map((i) => i.name as string);
    }),
    hasManagerAccess(role)
      ? quietly(async () => {
          const [list, onShift] = await Promise.all([
            db.from("printers").select("name, last_seen_at, poll_interval_seconds").eq("active", true),
            // Someone on shift today (not a forgotten clock-out from before).
            count(db.from("shifts").select("id", { count: "exact", head: true }).is("ended_at", null).gte("started_at", new Date(dayStart).toISOString())),
          ]);
          if (list.error) throw list.error;
          const offline = list.data.filter((p) => !isOnline(p.last_seen_at as string | null, p.poll_interval_seconds as number)).map((p) => p.name as string);
          return { offline, open: onShift > 0 };
        })
      : null,
    hasAdminAccess(role) ? quietly(() => count(db.from("dev_notes").select("id", { count: "exact", head: true }).eq("status", "new"))) : null,
    hasAdminAccess(role) ? quietly(() => count(db.from("legacy_accounts").select("legacy_user_id", { count: "exact", head: true }).eq("decision", "review"))) : null,
    hasAdminAccess(role)
      ? quietly(async () => {
          // One line per account, its newest flag.
          const seen = new Set<string>();
          return (await openFlags()).flatMap(({ flag, memberName }) => {
            if (seen.has(flag.memberId)) return [];
            seen.add(flag.memberId);
            return [{ memberId: flag.memberId, name: memberName, reason: FLAG_REASONS[flag.reason] }];
          });
        })
      : null,
  ]);

  return { tabs, held, itemsOut, printers, devNotes, oldSite, flagged };
});

// The little counts on the menu. Red only for something broken right now
// (a printer off while we're open), amber for something to deal with.
export function navBadges(s: Signals, pin: PinStatus | null): NavBadges {
  const b: NavBadges = {};
  if (s.tabs?.count) {
    b.tabs = {
      text: plural(s.tabs.count, "tab"),
      tone: s.tabs.fromBefore ? "warn" : "count",
      title: `${plural(s.tabs.count, "open tab")}${s.tabs.fromBefore ? `, ${s.tabs.fromBefore} from before today` : ""}`,
    };
  }
  if (s.itemsOut?.length) b.itemsOut = { text: `${s.itemsOut.length} out`, tone: "warn", title: `Marked out on the register: ${s.itemsOut.join(", ")}` };
  if (s.printers?.open && s.printers.offline.length) {
    b.printersOffline = { text: `${s.printers.offline.length} offline`, tone: "danger", title: `Not connected: ${s.printers.offline.join(", ")}` };
  }
  if (s.devNotes) b.devNotes = { text: `${s.devNotes} new`, tone: "count", title: `${plural(s.devNotes, "new note")} to review` };
  if (s.oldSite) b.oldSite = { text: s.oldSite.toLocaleString(), tone: "count", title: `${plural(s.oldSite, "account")} to review` };
  if (pin === "default" || pin === "temporary") b.pin = { text: "Set it", tone: "warn", title: pin === "default" ? "Your PIN is still 9999" : "You're on a temporary PIN" };
  return b;
}

// ---------- the Today page ----------

export interface TonightShow {
  id: string;
  startsAt: string;
  title: string;
  room: string;
  sold: number;
  capacity: number;
}

export interface HouseEventToday {
  id: string;
  title: string;
  startsAt: string;
  note: string | null;
}

export interface BookedEvent {
  id: string;
  name: string;
  date: string;
  time: string;
  hours: number;
  room: string;
  balanceDue: number;
  paid: boolean;
}

export interface BoothToday {
  id: string;
  booth: string;
  time: string;
  hours: number;
  party: number;
  name: string;
  confirmed: boolean;
}

export interface TodayBoard {
  date: string; // the business day, 4 a.m. to 4 a.m.
  summary: DashboardSummary | null;
  shows: TonightShow[] | null;
  houseEvents: HouseEventToday[] | null;
  events: BookedEvent[] | null; // today and the next 7 days
  booths: BoothToday[] | null;
  onShift: { name: string; since: string }[] | null;
  hours: { mine: number; onNowSince: string | null; team: number | null } | null;
  trainingOverdue: number | null; // managers only
  // Managers only: open to-dos for the managers ("Buy Hot dog buns at
  // Walmart", from Ran out), and par lines that keep running out.
  managerTodos: { id: string; title: string; createdAt: string; ranOut: boolean }[] | null;
  oftenOut: OftenOut[] | null;
  // Managers only: what ran out since Monday, so repeat offenders show.
  ranOutWeek: RanOutWeek | null;
  // Owners only: the owner tab this month so far, all owners together.
  ownerTab: { owed: number; menuValue: number; orders: number } | null;
}

export async function getTodayBoard(staff: { employeeId: string; role: EmployeeRole }): Promise<TodayBoard> {
  const db = createAdminClient();
  const date = businessDay().date;
  const win = businessDayWindow(date);
  const manager = hasManagerAccess(staff.role);

  const shifts = quietly(async () => {
    // Started today and not ended: a forgotten clock-out from an earlier day
    // isn't someone on now (Team → Timesheets flags those).
    const { data, error } = await db.from("shifts").select("employee_id, started_at, employee:employees(name)").is("ended_at", null).gte("started_at", win.start).order("started_at");
    if (error) throw error;
    return (data as unknown as { employee_id: string; started_at: string; employee: { name: string } | null }[]).map((s) => ({
      employeeId: s.employee_id,
      name: s.employee?.name ?? "Someone",
      since: s.started_at,
    }));
  });

  const [summary, shows, houseEvents, events, booths, onShift, sheet, training, managerTodos, oftenOut, ranOutWeek, ownerTab] = await Promise.all([
    quietly(getDashboardSummary),
    quietly(async () => {
      const { data, error } = await db
        .from("screenings")
        .select("id, starts_at, capacity, movie:movies(title), room:rooms(name)")
        .gte("starts_at", win.start)
        .lt("starts_at", win.end)
        .order("starts_at");
      if (error) throw error;
      const rows = data as unknown as { id: string; starts_at: string; capacity: number; movie: { title: string } | null; room: { name: string } | null }[];
      const tickets = await getTicketCounts(rows.map((r) => r.id));
      return rows.map((r) => ({ id: r.id, startsAt: r.starts_at, title: r.movie?.title ?? "Untitled", room: r.room?.name ?? "", sold: tickets[r.id]?.sold ?? 0, capacity: r.capacity }));
    }),
    quietly(async () => {
      const { data, error } = await db.from("house_events").select("id, title, note, starts_at").gte("starts_at", win.start).lt("starts_at", win.end).order("starts_at");
      if (error) throw error;
      return data.map((e) => ({ id: e.id as string, title: e.title as string, startsAt: e.starts_at as string, note: e.note as string | null }));
    }),
    quietly(async () => {
      const { data, error } = await db
        .from("events")
        .select("id, event_name, event_date, event_time, hours, balance_due, status, room:rooms(name)")
        .gte("event_date", date)
        .lte("event_date", shiftDate(date, 7))
        .order("event_date")
        .order("event_time");
      if (error) throw error;
      return (data as unknown as { id: string; event_name: string; event_date: string; event_time: string; hours: number; balance_due: number; status: string; room: { name: string } | null }[]).map((e) => ({
        id: e.id,
        name: e.event_name,
        date: e.event_date,
        time: e.event_time,
        hours: Number(e.hours),
        room: e.room?.name ?? "",
        balanceDue: Number(e.balance_due),
        paid: e.status === "paid",
      }));
    }),
    quietly(async () => {
      const { data, error } = await db
        .from("booth_reservations")
        .select("id, start_time, hours, party_size, customer_name, status, booth:booths(label)")
        .eq("reservation_date", date)
        .in("status", ["pending", "confirmed"])
        .order("start_time");
      if (error) throw error;
      return (data as unknown as { id: string; start_time: string; hours: number; party_size: number; customer_name: string; status: string; booth: { label: string } | null }[]).map((r) => ({
        id: r.id,
        booth: r.booth?.label ?? "Booth",
        time: r.start_time,
        hours: Number(r.hours),
        party: r.party_size,
        name: r.customer_name,
        confirmed: r.status === "confirmed",
      }));
    }),
    shifts,
    quietly(() => getTimesheet(thisWeek())),
    manager ? quietly(getTrainingOverview) : null,
    manager
      ? quietly(async () => {
          const { data, error } = await db.from("staff_todos").select("id, title, created_at, outage_id").eq("audience", "managers").is("done_at", null).order("created_at");
          if (error) throw error;
          return data.map((t) => ({ id: t.id as string, title: t.title as string, createdAt: t.created_at as string, ranOut: !!t.outage_id }));
        })
      : null,
    manager ? quietly(() => getOftenOut()) : null,
    manager ? quietly(() => getRanOutWeek()) : null,
    staff.role === "owner" ? quietly(() => ownerTabThisMonth(staff)) : null,
  ]);

  const mine = sheet?.find((p) => p.employeeId === staff.employeeId);
  const hours = sheet
    ? {
        mine: mine?.hours ?? 0,
        onNowSince: onShift?.find((o) => o.employeeId === staff.employeeId)?.since ?? null,
        team: manager ? sheet.reduce((sum, p) => sum + p.hours, 0) : null,
      }
    : null;

  return {
    date,
    summary,
    shows,
    houseEvents,
    events,
    booths,
    onShift: onShift?.map(({ name, since }) => ({ name, since })) ?? null,
    hours,
    trainingOverdue: training ? training.modules.flatMap((m) => m.people.filter((p) => p.assigned && p.overdue)).length : null,
    managerTodos,
    oftenOut,
    ranOutWeek,
    ownerTab,
  };
}
