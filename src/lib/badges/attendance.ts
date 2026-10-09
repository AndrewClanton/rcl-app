import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRestrictedRelease } from "@/lib/mplc";
import { visitBusinessDate } from "@/lib/visits";
import { MEMBERS_SHOWING } from "@/lib/event-series";

// Who "came" to a showing or a house event. The one place that decides it,
// for event badges (lib/badges/events.ts), their dry runs and the backfill:
//
//   A showing: they held a confirmed ticket for it (bought online or at the
//     register, paid or comped: a register comp books seats like a sale),
//     and the showing's business day has come.
//   A house event (trivia, comedy, the book swap: no tickets): they checked
//     in (tablet or register) on its business day.
//
// Business days run 4 AM to 4 AM Central (lib/visits.ts visitBusinessDate).
// Private rentals (the events table) are never read here.

type Db = ReturnType<typeof createAdminClient>;

export type EventKind = "screening" | "house_event";

export interface Attendance {
  memberId: string;
  kind: EventKind;
  id: string; // the showing's or house event's id
  series: string | null;
  startsAt: string;
  date: string; // its business date, YYYY-MM-DD
  // What a public card may say it was: a house event's title; a showing's
  // film only when the showing is public and the film can be advertised
  // (lib/mplc.ts), else "Members' Showing". Never a private group's name.
  label: string;
}

export interface CameFilter {
  memberIds?: string[]; // just these members
  screeningIds?: string[];
  houseEventIds?: string[];
  series?: string; // any showing or event with this tag
}

interface ScreeningRow {
  id: string;
  starts_at: string;
  series: string | null;
  visibility: string | null;
  movie: { title: string | null; release_year: number | null } | null;
}

interface HouseEventRow {
  id: string;
  title: string;
  starts_at: string;
  series: string | null;
}

const SCREENING_COLS = "id, starts_at, series, visibility, movie:movies(title, release_year)";
const HOUSE_COLS = "id, title, starts_at, series";

const chunks = <T,>(list: T[], n = 150): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

// A showing's public face. Fails closed: anything not plainly public and
// advertisable (at the showing and now) is a Members' Showing.
export function showingLabel(s: Pick<ScreeningRow, "starts_at" | "visibility" | "movie">, now = new Date()): string {
  const title = s.movie?.title?.trim();
  const movie = { release_year: s.movie?.release_year ?? null };
  if (s.visibility !== "public" || !title) return MEMBERS_SHOWING;
  if (isRestrictedRelease(movie, new Date(s.starts_at)) || isRestrictedRelease(movie, now)) return MEMBERS_SHOWING;
  return title.slice(0, 60);
}

const today = () => visitBusinessDate(new Date());

function fromScreening(memberId: string, s: ScreeningRow): Attendance {
  return { memberId, kind: "screening", id: s.id, series: s.series, startsAt: s.starts_at, date: visitBusinessDate(new Date(s.starts_at)), label: showingLabel(s) };
}

function fromHouseEvent(memberId: string, e: HouseEventRow): Attendance {
  return { memberId, kind: "house_event", id: e.id, series: e.series, startsAt: e.starts_at, date: visitBusinessDate(new Date(e.starts_at)), label: e.title.trim().slice(0, 60) };
}

async function pages<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await read(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

// Every attendance matching the filter, oldest first. With memberIds alone:
// everything those members came to. With a target (showings, events or a
// series): everyone who came to it, narrowed to memberIds if given.
export async function whoCame(filter: CameFilter, db: Db = createAdminClient()): Promise<Attendance[]> {
  const until = today();
  const members = filter.memberIds ? [...new Set(filter.memberIds)] : null;
  if (members && !members.length) return [];
  const targeted = !!(filter.screeningIds || filter.houseEventIds || filter.series);
  const out: Attendance[] = [];

  // ---------- showings: confirmed tickets ----------
  let screenings: ScreeningRow[] | null = null; // null: any the members hold tickets for
  if (targeted) {
    screenings = [];
    if (filter.series) {
      screenings.push(...(await pages<ScreeningRow>((a, b) => db.from("screenings").select(SCREENING_COLS).eq("series", filter.series!).order("starts_at").range(a, b) as never)));
    }
    for (const ids of chunks([...new Set(filter.screeningIds ?? [])])) {
      const { data, error } = await db.from("screenings").select(SCREENING_COLS).in("id", ids);
      if (error) throw new Error(error.message);
      screenings.push(...((data ?? []) as unknown as ScreeningRow[]));
    }
  }
  const came = (s: ScreeningRow) => visitBusinessDate(new Date(s.starts_at)) <= until;
  if (screenings === null) {
    for (const ids of chunks(members!)) {
      const rows = await pages<{ member_id: string; screening: ScreeningRow | null }>(
        (a, b) =>
          db
            .from("bookings")
            .select(`member_id, screening:screenings(${SCREENING_COLS})`)
            .in("member_id", ids)
            .eq("status", "confirmed")
            .range(a, b) as never,
      );
      for (const r of rows) if (r.screening && came(r.screening)) out.push(fromScreening(r.member_id, r.screening));
    }
  } else {
    const past = new Map(screenings.filter(came).map((s) => [s.id, s]));
    for (const ids of chunks([...past.keys()])) {
      const rows = await pages<{ member_id: string; screening_id: string }>((a, b) => {
        let q = db.from("bookings").select("member_id, screening_id").in("screening_id", ids).eq("status", "confirmed").not("member_id", "is", null);
        if (members && members.length <= 150) q = q.in("member_id", members);
        return q.range(a, b) as never;
      });
      for (const r of rows) {
        if (members && !members.includes(r.member_id)) continue;
        out.push(fromScreening(r.member_id, past.get(r.screening_id)!));
      }
    }
  }

  // ---------- house events: a check-in that business day ----------
  let events: HouseEventRow[];
  if (targeted) {
    events = [];
    if (filter.series) {
      events.push(...(await pages<HouseEventRow>((a, b) => db.from("house_events").select(HOUSE_COLS).eq("series", filter.series!).order("starts_at").range(a, b) as never)));
    }
    for (const ids of chunks([...new Set(filter.houseEventIds ?? [])])) {
      const { data, error } = await db.from("house_events").select(HOUSE_COLS).in("id", ids);
      if (error) throw new Error(error.message);
      events.push(...((data ?? []) as HouseEventRow[]));
    }
  } else {
    events = await pages<HouseEventRow>((a, b) => db.from("house_events").select(HOUSE_COLS).order("starts_at").range(a, b) as never);
  }
  const byDate = new Map<string, HouseEventRow[]>();
  for (const e of events) {
    const d = visitBusinessDate(new Date(e.starts_at));
    if (d > until) continue;
    byDate.set(d, [...(byDate.get(d) ?? []), e]);
  }
  if (byDate.size) {
    const dates = [...byDate.keys()];
    const visits: { member_id: string; business_date: string }[] = [];
    if (members) {
      for (const ids of chunks(members)) {
        visits.push(
          ...(await pages<{ member_id: string; business_date: string }>((a, b) =>
            db.from("member_visits").select("member_id, business_date").in("member_id", ids).gte("business_date", dates.reduce((m, d) => (d < m ? d : m))).range(a, b) as never,
          )),
        );
      }
    } else {
      for (const ds of chunks(dates)) {
        visits.push(...(await pages<{ member_id: string; business_date: string }>((a, b) => db.from("member_visits").select("member_id, business_date").in("business_date", ds).range(a, b) as never)));
      }
    }
    for (const v of visits) for (const e of byDate.get(v.business_date) ?? []) out.push(fromHouseEvent(v.member_id, e));
  }

  // One attendance per member and showing (two bookings for one showing
  // are one visit).
  const seen = new Set<string>();
  return out
    .filter((a) => {
      const k = `${a.memberId}|${a.kind}|${a.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id));
}
