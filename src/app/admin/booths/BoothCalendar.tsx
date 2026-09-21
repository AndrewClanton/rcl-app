"use client";

import { useMemo, useState, useTransition } from "react";
import type { BoothReservation } from "@/lib/types";
import { getReservationsForMonth } from "./actions";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}${m ? ":" + String(m).padStart(2, "0") : ""}${period.toLowerCase()}`;
}

function addMonths(monthStart: string, delta: number) {
  const [y, m] = monthStart.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}

function monthLabel(monthStart: string) {
  return new Date(`${monthStart}T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function todayCentral() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

export default function BoothCalendar({ initialMonthStart, initialReservations }: { initialMonthStart: string; initialReservations: BoothReservation[] }) {
  const [monthStart, setMonthStart] = useState(initialMonthStart);
  const [reservations, setReservations] = useState(initialReservations);
  const [loading, startTransition] = useTransition();
  const today = todayCentral();

  function goToMonth(next: string) {
    setMonthStart(next);
    startTransition(async () => {
      const rows = await getReservationsForMonth(next);
      setReservations(rows);
    });
  }

  const reservationsByDate = useMemo(() => {
    const map = new Map<string, BoothReservation[]>();
    for (const r of reservations) {
      if (r.status === "cancelled") continue;
      const list = map.get(r.reservation_date) ?? [];
      list.push(r);
      map.set(r.reservation_date, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.start_time.localeCompare(b.start_time));
    return map;
  }, [reservations]);

  const cells = useMemo(() => {
    const [y, m] = monthStart.split("-").map(Number);
    const firstOfMonth = new Date(y, m - 1, 1);
    const daysInMonth = new Date(y, m, 0).getDate();
    const startWeekday = firstOfMonth.getDay();

    const out: { date: string | null; day: number | null }[] = [];
    for (let i = 0; i < startWeekday; i++) out.push({ date: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      out.push({ date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, day: d });
    }
    while (out.length % 7 !== 0) out.push({ date: null, day: null });
    return out;
  }, [monthStart]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {monthLabel(monthStart)} {loading && <span className="font-normal text-[var(--muted)]">(loading…)</span>}
        </h3>
        <div className="flex gap-1">
          <button className="rounded border border-[var(--border)] px-2 py-1 text-xs" onClick={() => goToMonth(addMonths(monthStart, -1))}>
            ← Prev
          </button>
          <button className="rounded border border-[var(--border)] px-2 py-1 text-xs" onClick={() => goToMonth(`${today.slice(0, 7)}-01`)}>
            Today
          </button>
          <button className="rounded border border-[var(--border)] px-2 py-1 text-xs" onClick={() => goToMonth(addMonths(monthStart, 1))}>
            Next →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--border)] text-xs">
        {WEEKDAYS.map((w) => (
          <div key={w} className="bg-[var(--surface-hover)] px-1.5 py-1 text-center font-medium text-[var(--muted)]">
            {w}
          </div>
        ))}
        {cells.map((c, i) => {
          const dayReservations = c.date ? (reservationsByDate.get(c.date) ?? []) : [];
          const isToday = c.date === today;
          return (
            <div key={i} className={`min-h-[86px] bg-[var(--surface)] p-1 ${c.date ? "" : "opacity-40"}`}>
              {c.day && (
                <div className={`mb-0.5 text-right ${isToday ? "font-bold text-[var(--accent)]" : "text-[var(--muted)]"}`}>{c.day}</div>
              )}
              <div className="space-y-0.5">
                {dayReservations.map((r) => (
                  <div
                    key={r.id}
                    title={`${r.booth?.label ?? "Booth"} — ${r.customer_name} (${r.party_size}) — ${r.customer_email}${r.status === "pending" ? " — pending payment" : ""}`}
                    className="truncate rounded px-1 py-0.5 leading-tight"
                    style={{
                      background: r.status === "pending" ? "var(--warn-bg)" : r.fee_amount === 0 ? "var(--accent-soft)" : "var(--surface-hover)",
                      color: r.status === "pending" ? "var(--warn-text)" : r.fee_amount === 0 ? "var(--accent)" : "var(--foreground)",
                    }}
                  >
                    {fmtTime(r.start_time)} {r.booth?.label ?? "Booth"}
                    {r.fee_amount === 0 && " · free"}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[var(--muted)]">
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: "var(--surface-hover)" }} /> Paid
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: "var(--accent-soft)" }} /> Free (Insiders+ perk)
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: "var(--warn-bg)" }} /> Pending payment
        </span>
      </div>
    </div>
  );
}
