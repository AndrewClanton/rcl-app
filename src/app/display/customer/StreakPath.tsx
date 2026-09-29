import { LADDER, REWARD_LABEL, nextStep, visitPoints } from "@/lib/visits";

// The streak path on the customer screen after a check-in: each stop on the
// ladder (lib/visits.ts), how far along they are, and what's next.
const ICON: Record<string, string> = { popcorn: "🍿", pizza: "🍕" };

export default function StreakPath({ streak }: { streak: number }) {
  const next = nextStep(streak);
  // Progress between stops, so the bar moves every visit even when the
  // stops are far apart.
  const stops = LADDER.map((s) => s.day);
  const lastStop = stops[stops.length - 1];
  let fill = 1;
  for (let i = 0; i < stops.length - 1; i++) {
    if (streak < stops[i + 1]) {
      fill = (i + (streak - stops[i]) / (stops[i + 1] - stops[i])) / (stops.length - 1);
      break;
    }
  }
  if (streak >= lastStop) fill = 1;

  return (
    <div className="mt-5 text-left">
      <div className="relative mx-3 mb-2 h-3 rounded-full border-2" style={{ borderColor: "var(--foreground)", background: "var(--background)" }}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.round(fill * 100)}%`, background: "var(--gold)" }} />
      </div>
      <ol className="grid" style={{ gridTemplateColumns: `repeat(${LADDER.length}, minmax(0, 1fr))` }}>
        {LADDER.map((s, i) => {
          const reached = streak >= s.day;
          return (
            <li key={s.day} className={`flex flex-col text-xs leading-tight ${i === 0 ? "items-start" : i === LADDER.length - 1 ? "items-end text-right" : "items-center text-center"}`}>
              <span
                className="font-display grid size-9 place-items-center rounded-full border-2 text-sm"
                style={{ borderColor: "var(--foreground)", background: reached ? "var(--gold)" : "var(--surface)", opacity: reached ? 1 : 0.7 }}
              >
                {s.reward ? ICON[s.reward] : s.points}
              </span>
              <span className="mt-1 font-bold">Day {s.day}</span>
              <span className="text-[var(--muted)]">{s.reward ? REWARD_LABEL[s.reward] : `${s.points} pts`}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-center text-sm">
        {next ? (
          <>
            <b>
              {next.daysLeft} more {next.daysLeft === 1 ? "visit" : "visits"} in a row
            </b>{" "}
            → {next.label.toLowerCase()}
            {!next.label.startsWith("Free") && !next.label.startsWith("Another") ? "" : "!"}
          </>
        ) : (
          <>You&apos;re at the top: {visitPoints(streak)} points every visit.</>
        )}
      </p>
      <p className="mt-1 text-center text-xs text-[var(--muted)]">Check in each day we&apos;re open to keep your streak going.</p>
    </div>
  );
}
