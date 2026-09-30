"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { assertStaff } from "@/lib/auth";
import { businessDay, shiftDate } from "@/lib/ops/time";

// Movie tickets at the register: the showings staff can sell (today's and
// tomorrow's business days, including a show that started a few minutes
// ago for latecomers) with seats left, and a seat check before payment.
// The register is staff-only, so older (MPLC) titles are listed too.

export interface RegisterScreening {
  id: string;
  day: "today" | "tomorrow";
  startsAt: string;
  title: string;
  posterUrl: string | null;
  runtime: number | null;
  rating: string | null;
  room: string;
  price: number;
  capacity: number;
  sold: number;
}

const LATE_SEATING_MIN = 45;

async function seatsTaken(supabase: ReturnType<typeof createAdminClient>, screeningIds: string[]) {
  const taken = new Map<string, number>();
  if (!screeningIds.length) return taken;
  const { data, error } = await supabase.from("bookings").select("screening_id, quantity").in("screening_id", screeningIds).in("status", ["pending", "confirmed"]);
  if (error) throw error;
  for (const b of data ?? []) taken.set(b.screening_id, (taken.get(b.screening_id) ?? 0) + b.quantity);
  return taken;
}

export async function getRegisterScreenings(): Promise<{ ok: true; screenings: RegisterScreening[] } | { ok: false; error: string }> {
  await assertStaff();
  try {
    const supabase = createAdminClient();
    const now = Date.now();
    const today = businessDay(new Date(now)).date;
    const tomorrow = shiftDate(today, 1); // not now + 24 hours: wrong by a day the nights the clocks change
    // Generous window; each showing is then placed on its business day and
    // anything past tomorrow's is dropped.
    const { data, error } = await supabase
      .from("screenings")
      .select("id, starts_at, ticket_price, capacity, movie:movies(title, poster_url, runtime_minutes, rating), room:rooms(name)")
      .gte("starts_at", new Date(now - LATE_SEATING_MIN * 60_000).toISOString())
      .lte("starts_at", new Date(now + 3 * 86_400_000).toISOString())
      .order("starts_at");
    if (error) throw error;
    const rows = (data ?? []) as unknown as {
      id: string;
      starts_at: string;
      ticket_price: number;
      capacity: number;
      movie: { title: string; poster_url: string | null; runtime_minutes: number | null; rating: string | null } | null;
      room: { name: string } | null;
    }[];
    const inWindow = rows
      .map((r) => ({ r, bd: businessDay(new Date(r.starts_at)).date }))
      .filter(({ bd }) => bd === today || bd === tomorrow);
    const taken = await seatsTaken(supabase, inWindow.map(({ r }) => r.id));
    return {
      ok: true,
      screenings: inWindow.map(({ r, bd }) => ({
        id: r.id,
        day: bd === today ? "today" : "tomorrow",
        startsAt: r.starts_at,
        title: r.movie?.title ?? "Untitled",
        posterUrl: r.movie?.poster_url ?? null,
        runtime: r.movie?.runtime_minutes ?? null,
        rating: r.movie?.rating ?? null,
        room: r.room?.name ?? "",
        price: Number(r.ticket_price),
        capacity: r.capacity,
        sold: taken.get(r.id) ?? 0,
      })),
    };
  } catch {
    return { ok: false, error: "Couldn't load today's showings. Check the connection and try again." };
  }
}

// Run before taking payment, so a showing that sold out online meanwhile is
// caught before the customer pays rather than after.
export async function checkTicketSeats(lines: { screeningId: string; quantity: number }[]): Promise<{ ok: true } | { ok: false; error: string }> {
  await assertStaff();
  const want = new Map<string, number>();
  for (const l of lines) want.set(l.screeningId, (want.get(l.screeningId) ?? 0) + l.quantity);
  if (!want.size) return { ok: true };
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.from("screenings").select("id, capacity, movie:movies(title)").in("id", [...want.keys()]);
    if (error) throw error;
    const taken = await seatsTaken(supabase, [...want.keys()]);
    for (const s of (data ?? []) as unknown as { id: string; capacity: number; movie: { title: string } | null }[]) {
      const left = s.capacity - (taken.get(s.id) ?? 0);
      if ((want.get(s.id) ?? 0) > left) {
        return { ok: false, error: left > 0 ? `Only ${left} seat${left === 1 ? "" : "s"} left for ${s.movie?.title ?? "that showing"}. Lower the ticket count.` : `${s.movie?.title ?? "That showing"} is sold out. Remove those tickets.` };
      }
    }
    if ((data ?? []).length < want.size) return { ok: false, error: "One of those showings was removed from the schedule. Remove its tickets and add them again." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't check seats. Check the connection and try again." };
  }
}

export interface TicketShowing {
  title: string;
  startsAt: string;
  room: string;
  rating: string | null;
  runtime: number | null;
  posterUrl: string | null;
}

// For printing tickets after a sale (including a tab loaded from the database).
export async function getTicketPrintInfo(screeningIds: string[]): Promise<Record<string, TicketShowing>> {
  await assertStaff();
  if (!screeningIds.length) return {};
  const { data } = await createAdminClient()
    .from("screenings")
    .select("id, starts_at, movie:movies(title, poster_url, runtime_minutes, rating), room:rooms(name)")
    .in("id", screeningIds);
  const out: Record<string, TicketShowing> = {};
  for (const r of (data ?? []) as unknown as { id: string; starts_at: string; movie: { title: string; poster_url: string | null; runtime_minutes: number | null; rating: string | null } | null; room: { name: string } | null }[]) {
    out[r.id] = { title: r.movie?.title ?? "Movie", startsAt: r.starts_at, room: r.room?.name ?? "", rating: r.movie?.rating ?? null, runtime: r.movie?.runtime_minutes ?? null, posterUrl: r.movie?.poster_url ?? null };
  }
  return out;
}
