import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { businessDayWindow, centralToIso, shiftDate } from "@/lib/ops/time";
import { getDayReport, type DayReport } from "./reports";

// The end-of-day email to the admins: how the business day went, how that
// compares, and anything worth a look before the next day starts. Built
// from the same numbers as Reports → Day. Each extra section is best-effort:
// one failing query leaves that section out rather than the whole email.

const TZ = "America/Chicago";

export interface DailyDigest {
  date: string;
  label: string; // "Monday, Sep 28"
  day: DayReport;
  lastWeek: { date: string; collected: number; orders: number } | null;
  weekdayAverage: { collected: number; weeks: number } | null;
  showings: { time: string; title: string; room: string; sold: number; capacity: number }[];
  staff: { name: string; hours: string }[];
  watch: string[];
  good: string[];
  next: { label: string; items: { time: string; text: string }[] };
  newMembers: number;
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const dayLabel = (date: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "short", day: "numeric" }) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });

async function safely<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function buildDailyDigest(date: string): Promise<DailyDigest> {
  const supabase = createAdminClient();
  const { start, end } = businessDayWindow(date);
  const nextDate = shiftDate(date, 1);
  const next = businessDayWindow(nextDate);

  const day = await getDayReport(date);
  const completed = day.orders.filter((o) => o.status === "completed");

  // Same weekday over the four weeks before, for "is this a good Monday?"
  const priorWeeks = await safely([] as { date: string; collected: number; orders: number }[], async () => {
    const reports = await Promise.all([1, 2, 3, 4].map((w) => getDayReport(shiftDate(date, -7 * w))));
    return reports.map((r) => ({ date: r.date, collected: r.collected, orders: r.orders.filter((o) => o.status === "completed").length }));
  });
  const lastWeek = priorWeeks[0] ?? null;
  const open = priorWeeks.filter((w) => w.collected > 0);
  const weekdayAverage = open.length ? { collected: open.reduce((s, w) => s + w.collected, 0) / open.length, weeks: open.length } : null;

  const showings = await safely([] as DailyDigest["showings"], async () => {
    const { data } = await supabase
      .from("screenings")
      .select("id, starts_at, capacity, movie:movies(title), room:rooms(name), bookings(quantity, status)")
      .gte("starts_at", start)
      .lt("starts_at", end)
      .order("starts_at");
    return ((data ?? []) as unknown as { starts_at: string; capacity: number; movie: { title: string } | null; room: { name: string } | null; bookings: { quantity: number; status: string }[] }[]).map((s) => ({
      time: clock(s.starts_at),
      title: s.movie?.title ?? "Untitled",
      room: (s.room?.name ?? "").split(" — ")[0],
      sold: s.bookings.filter((b) => b.status === "confirmed").reduce((n, b) => n + b.quantity, 0),
      capacity: s.capacity,
    }));
  });

  const staff = await safely([] as DailyDigest["staff"], async () => {
    const { data } = await supabase.from("shifts").select("started_at, ended_at, employee:employees(name)").gte("started_at", start).lt("started_at", end).order("started_at");
    return ((data ?? []) as unknown as { started_at: string; ended_at: string | null; employee: { name: string } | null }[]).map((s) => {
      const hrs = s.ended_at ? (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 3_600_000 : null;
      return { name: s.employee?.name ?? "Someone", hours: `${clock(s.started_at)}–${s.ended_at ? clock(s.ended_at) : "still on"}${hrs !== null ? ` (${hrs.toFixed(1)} h)` : ""}` };
    });
  });

  // ---------- worth a look ----------
  const watch: string[] = [];
  const good: string[] = [];

  await safely(undefined, async () => {
    const { data } = await supabase.from("orders").select("order_name, total, status").in("status", ["tab", "held"]);
    const tabs = (data ?? []).filter((o) => o.status === "tab");
    const held = (data ?? []).filter((o) => o.status === "held");
    if (tabs.length) watch.push(`${tabs.length} tab${tabs.length === 1 ? " is" : "s are"} still open: ${tabs.map((t) => `${t.order_name ?? "unnamed"} (${money(Number(t.total))})`).join(", ")}.`);
    if (held.length) watch.push(`${held.length} held order${held.length === 1 ? " is" : "s are"} still parked on the register (${money(held.reduce((s, h) => s + Number(h.total), 0))}).`);
  });

  await safely(undefined, async () => {
    const ids = completed.map((o) => o.id);
    if (!ids.length) return;
    const { data } = await supabase.from("order_items").select("name, unit_price, quantity").in("order_id", ids).is("menu_item_id", null).is("screening_id", null);
    if (data?.length) watch.push(`${data.length} custom item${data.length === 1 ? "" : "s"} rung up: ${data.map((i) => `${i.name} ${money(Number(i.unit_price) * i.quantity)}`).join(", ")}. The menu may be missing a button.`);
  });

  const refunded = day.orders.filter((o) => o.status === "refunded");
  if (refunded.length) watch.push(`${refunded.length} refund${refunded.length === 1 ? "" : "s"}: ${refunded.map((o) => `#${o.orderNumber} ${money(o.total)}`).join(", ")}.`);
  const voided = day.orders.filter((o) => o.status === "voided");
  if (voided.length) watch.push(`${voided.length} order${voided.length === 1 ? " was" : "s were"} voided: ${voided.map((o) => `#${o.orderNumber}`).join(", ")}.`);
  if (day.vouchers > 0) watch.push(`${money(day.vouchers)} in trivia vouchers was redeemed.`);

  await safely(undefined, async () => {
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    const [{ data: tasks }, { data: done }] = await Promise.all([
      supabase.from("shift_tasks").select("id, title, days").eq("active", true).eq("timing", "closing"),
      supabase.from("task_completions").select("task_id").eq("work_date", date),
    ]);
    const doneIds = new Set((done ?? []).map((d) => d.task_id));
    const missed = (tasks ?? []).filter((t) => (!t.days || !t.days.length || t.days.includes(dow)) && !doneIds.has(t.id));
    if (missed.length && completed.length) watch.push(`Closing checklist not ticked off: ${missed.map((t) => t.title).join(", ")}.`);
  });

  await safely(undefined, async () => {
    const { data: count } = await supabase.from("par_counts").select("id").not("completed_at", "is", null).gte("completed_at", start).lt("completed_at", end).order("completed_at", { ascending: false }).limit(1).maybeSingle();
    if (!count) return;
    const { data: lines } = await supabase.from("par_count_lines").select("qty, par_qty, item:par_items(name)").eq("count_id", count.id);
    const low = ((lines ?? []) as unknown as { qty: number; par_qty: number; item: { name: string } | null }[]).filter((l) => Number(l.qty) < Number(l.par_qty));
    if (low.length) watch.push(`Below par at the closing count: ${low.slice(0, 8).map((l) => `${l.item?.name ?? "item"} (${l.qty}/${l.par_qty})`).join(", ")}${low.length > 8 ? ` and ${low.length - 8} more` : ""}. It's on the shopping list.`);
  });

  await safely(undefined, async () => {
    const { count } = await supabase.from("dev_notes").select("id", { count: "exact", head: true }).gte("created_at", start).lt("created_at", end);
    if (count) watch.push(`${count} new dev note${count === 1 ? "" : "s"} to review in the back office.`);
  });

  // ---------- good news ----------
  const full = showings.filter((s) => s.capacity > 0 && s.sold / s.capacity >= 0.8);
  for (const s of full) good.push(`${s.title} at ${s.time} was ${Math.round((s.sold / s.capacity) * 100)}% full (${s.sold}/${s.capacity}).`);
  if (weekdayAverage && day.collected > weekdayAverage.collected * 1.15) good.push(`${money(day.collected - weekdayAverage.collected)} above a typical ${dayLabel(date, { weekday: "long" })}.`);
  if (day.topItems[0]) good.push(`Best seller: ${day.topItems[0].name}, ${day.topItems[0].qty} sold for ${money(day.topItems[0].revenue)}.`);

  const newMembers = await safely(0, async () => {
    const { count } = await supabase.from("members").select("id", { count: "exact", head: true }).gte("created_at", start).lt("created_at", end);
    return count ?? 0;
  });

  // ---------- coming up (the report lands the next morning) ----------
  const items: { at: string; time: string; text: string }[] = [];
  await safely(undefined, async () => {
    const { data } = await supabase
      .from("screenings")
      .select("starts_at, capacity, movie:movies(title), room:rooms(name), bookings(quantity, status)")
      .gte("starts_at", next.start)
      .lt("starts_at", next.end)
      .order("starts_at");
    for (const s of (data ?? []) as unknown as { starts_at: string; movie: { title: string } | null; room: { name: string } | null; bookings: { quantity: number; status: string }[] }[]) {
      const sold = s.bookings.filter((b) => b.status === "confirmed").reduce((n, b) => n + b.quantity, 0);
      const room = (s.room?.name ?? "").split(" — ")[0];
      items.push({ at: s.starts_at, time: clock(s.starts_at), text: `${s.movie?.title ?? "Untitled"}${room && !/^indoor/i.test(room) ? ` (${room})` : ""}${sold ? ` · ${sold} sold already` : ""}` });
    }
  });
  await safely(undefined, async () => {
    const { data } = await supabase.from("house_events").select("title, note, starts_at").gte("starts_at", next.start).lt("starts_at", next.end);
    for (const e of data ?? []) items.push({ at: e.starts_at, time: clock(e.starts_at), text: `★ ${e.title}${e.note ? ` (${e.note})` : ""}` });
  });
  await safely(undefined, async () => {
    const { data } = await supabase.from("booth_reservations").select("start_time, party_size, customer_name, booth:booths(label)").eq("reservation_date", nextDate).eq("status", "confirmed");
    for (const b of (data ?? []) as unknown as { start_time: string; party_size: number; customer_name: string; booth: { label: string } | null }[]) {
      const [h, m] = b.start_time.split(":").map(Number);
      const t = new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
      items.push({ at: centralToIso(nextDate, b.start_time.slice(0, 5)), time: t, text: `Booth: ${b.booth?.label ?? "booth"}, party of ${b.party_size} (${b.customer_name})` });
    }
  });
  await safely(undefined, async () => {
    const { data } = await supabase.from("events").select("event_name, event_time, organizer_name, guest_count, balance_due, status").eq("event_date", nextDate).neq("status", "cancelled");
    for (const e of data ?? []) {
      const balance = Number(e.balance_due ?? 0);
      const hhmm = e.event_time ? String(e.event_time).slice(0, 5) : "00:00";
      const at = centralToIso(nextDate, hhmm);
      items.push({ at, time: e.event_time ? clock(at) : "", text: `Private event: ${e.event_name ?? "event"} (${e.organizer_name ?? "organizer"}${e.guest_count ? `, ${e.guest_count} guests` : ""})${balance > 0 ? ` · ${money(balance)} still due` : ""}` });
    }
  });
  items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return {
    date,
    label: dayLabel(date),
    day,
    lastWeek,
    weekdayAverage,
    showings,
    staff,
    watch,
    good,
    next: { label: dayLabel(nextDate), items: items.map(({ time, text }) => ({ time, text })) },
    newMembers,
  };
}
