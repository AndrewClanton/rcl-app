// Hours worked, for people to read: "12 h 30 m", "45 m", "8 h". Shared by My
// hours, the register's shift bar and Team → Timesheets (so no server-only).
export function formatHours(hours: number): string {
  const minutes = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} m`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

// An instant as Central wall-clock time in the shape a datetime-local input
// uses ("2026-09-28T23:00"). The clock-out fixer fills its pickers with it,
// and the server compares against it to tell an untouched time from a new one.
export function centralLocal(iso: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
