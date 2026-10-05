import Link from "next/link";
import type { InsiderSlot } from "@/lib/data/screenings";

// What a signed-out guest sees of the members-only showings: the days and
// times, never the titles. The outdoor screen and Midweek Movies aren't
// licensed for public advertising ("you have to be an Insider to know what
// we're playing outside"), so this names no film and links to no showing.

const TZ = "America/Chicago";
const WEEK_MS = 7 * 86_400_000;
const weekday = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: TZ });
const dated = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: TZ });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }).replace(":00", "");
const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} & ${xs[xs.length - 1]}`);

// "Thu, Fri & Sat at 8 PM", or "Thu at 8 PM · Sat at 9 PM". Days within the
// week go by name; later ones carry the date ("Fri 10/16").
function when(slots: InsiderSlot[], now: number): string {
  const byTime = new Map<string, string[]>();
  for (const s of slots) {
    const day = Date.parse(s.startsAt) - now < WEEK_MS ? weekday(s.startsAt) : dated(s.startsAt);
    const days = byTime.get(time(s.startsAt)) ?? [];
    if (!days.includes(day)) days.push(day);
    byTime.set(time(s.startsAt), days);
  }
  return [...byTime].map(([t, days]) => `${andList(days)} at ${t}`).join(" · ");
}

// The locked Insiders tab on /showtimes, for a guest: a short sign-in prompt,
// then the days and times (if any are coming up).
export default function InsiderTeaser({ slots, next }: { slots: InsiderSlot[]; next: string }) {
  const now = new Date().getTime();
  const thisWeek = (xs: InsiderSlot[]) => xs.every((s) => Date.parse(s.startsAt) - now < WEEK_MS);
  const outdoor = slots.filter((s) => s.outdoor);
  const indoor = slots.filter((s) => !s.outdoor);
  const isWed = (s: InsiderSlot) => weekday(s.startsAt) === "Wed";
  const midweek = indoor.filter(isWed);
  const other = indoor.filter((s) => !isWed(s));
  const lines: { label: string; text: string }[] = [];
  if (outdoor.length) lines.push({ label: thisWeek(outdoor) ? "Outdoor movies this week" : "Outdoor movies coming up", text: `${when(outdoor, now)} on the patio` });
  if (midweek.length) lines.push({ label: "Midweek Movies", text: when(midweek, now) });
  if (other.length) lines.push({ label: "Insider screenings", text: when(other, now) });

  return (
    <section aria-labelledby="insider-teaser" className="sheet mt-6 p-4 sm:p-5">
      <h2 id="insider-teaser" className="text-[15px] font-bold">
        Sign in or join free to see Insider showings (outdoor &amp; Midweek Movies).
      </h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={`/account/login?next=${encodeURIComponent(next)}`} className="btn-primary px-4 py-2">
          Sign in
        </Link>
        <Link href="/membership?plan=free#join" className="btn-secondary px-4 py-2">
          Join free
        </Link>
      </div>
      {lines.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-[var(--border)] pt-3 text-sm">
          {lines.map((l) => (
            <li key={l.label}>
              <span className="font-bold">{l.label}:</span> {l.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
