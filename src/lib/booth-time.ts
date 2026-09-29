// "7:00–9:00 PM" from a booth booking's start time ("19:00:00") and its
// length in hours. Shared by the register, emails and member accounts.
export function boothWindow(start: string, hours: number): string {
  const [h, m] = start.split(":").map(Number);
  const at = (mins: number) => {
    const hh = Math.floor(mins / 60) % 24;
    return { t: `${hh % 12 || 12}:${String(mins % 60).padStart(2, "0")}`, ap: hh >= 12 ? "PM" : "AM" };
  };
  const a = at(h * 60 + m);
  const b = at(h * 60 + m + Math.round(Number(hours) * 60));
  return a.ap === b.ap ? `${a.t}–${b.t} ${b.ap}` : `${a.t} ${a.ap}–${b.t} ${b.ap}`;
}

// "Wednesday, September 30" from a reservation date ("2026-09-30").
export function boothDate(date: string, style: "long" | "short" = "long"): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", style === "long" ? { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" } : { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
