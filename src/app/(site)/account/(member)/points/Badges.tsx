import Link from "next/link";
import type { VisitSummary } from "@/lib/visits-server";
import { BADGES, REWARD_LABEL, VISIT_POINTS, badgeFor, birthdayLabel, nextWeekBadge, type Badge } from "@/lib/visits";
import type { BadgeCard, LockedBadge } from "@/lib/badges/server";
import { BadgeCardFlip } from "@/components/badges/BadgeCard";
import { dateShort, dayMonth } from "../format";
import { Panel } from "../ui";

// The member's side of checking in (lib/visits.ts): their week streak with
// the last 13 weeks as squares, and the badge cabinet (earned ones in
// color with the day they got them, the rest greyed out with how to earn
// them).

export function StreakPanel({ visits }: { visits: VisitSummary }) {
  const n = visits.weekStreak;
  const next = nextWeekBadge(n);
  let line: React.ReactNode;
  if (!visits.visits) line = <>Check in at the door (type your phone on the tablet) and every week you come in counts.</>;
  else if (!visits.thisWeek && n > 0) line = <>Come in by Sunday to make it {n + 1}.</>;
  else if (!visits.thisWeek) line = <>Check in this week to start a new streak.</>;
  else if (next)
    line = (
      <>
        {next.weeksLeft} more {next.weeksLeft === 1 ? "week" : "weeks"} to {next.badge.emoji} <strong>{next.badge.label}</strong> (+{next.badge.points}
        {next.badge.reward ? ` and a ${REWARD_LABEL[next.badge.reward].toLowerCase()}` : ""}).
      </>
    );
  else line = <>Every week for a year and counting. See you next week.</>;

  return (
    <Panel title="Weeks in a row" aside="Monday to Sunday">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-5">
        {/* The count beside its words on a phone, over them from a tablet up. */}
        <div className="flex shrink-0 items-baseline gap-3 sm:block">
          <div className="font-display text-6xl leading-none tabular-nums">{n}</div>
          <div className="font-display text-lg sm:mt-1">{n === 1 ? "week" : "weeks"} in a row</div>
        </div>
        <div className="min-w-0 flex-1">
          <ol className="grid grid-cols-13 gap-1 sm:gap-1.5" aria-label="The last 13 weeks">
            {visits.weeks.map((w, i) => {
              const now = i === visits.weeks.length - 1;
              return (
                <li
                  key={w.monday}
                  title={`${now ? "This week" : `Week of ${dayMonth(`${w.monday}T12:00:00Z`)}`}: ${w.visited ? "checked in" : "no check-in"}`}
                  className={`aspect-square rounded-[3px] border-2 border-[var(--foreground)] ${w.visited ? "bg-[var(--gold)]" : now ? "border-dashed bg-[var(--surface)]" : "bg-[var(--surface-hover)]"}`}
                >
                  <span className="sr-only">
                    {now ? "This week" : `Week of ${dayMonth(`${w.monday}T12:00:00Z`)}`}: {w.visited ? "checked in" : "no check-in"}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="spec-code mt-1.5 flex justify-between">
            <span>{dayMonth(`${visits.weeks[0].monday}T12:00:00Z`)}</span>
            <span>This week</span>
          </div>
          <p className="mt-3 text-[15px]">{line}</p>
        </div>
      </div>
    </Panel>
  );
}

// The badge case: every copy they hold as a card (tap to turn it over:
// serial, rarity, mint date and its verify QR), then the badges still to
// earn, greyed, with how. Falls back to the cabinet below if the cards
// can't be read.
export function BadgeCabinet({
  visits,
  birthday,
  cards = [],
  earnable = { locked: [], total: 0 },
}: {
  visits: VisitSummary;
  birthday: string | null;
  cards?: BadgeCard[];
  earnable?: { locked: LockedBadge[]; total: number };
}) {
  if (cards.length || earnable.locked.length) return <BadgeCase cards={cards} earnable={earnable} birthday={birthday} />;
  return <OldCabinet visits={visits} birthday={birthday} />;
}

function BadgeCase({ cards, earnable, birthday }: { cards: BadgeCard[]; earnable: { locked: LockedBadge[]; total: number }; birthday: string | null }) {
  const have = new Set(cards.map((c) => c.key));
  const locked = earnable.locked.filter((b) => !have.has(b.key));
  return (
    <Panel title="Badge case" aside={`${have.size} of ${Math.max(earnable.total, have.size)}`}>
      {cards.length > 0 ? (
        <ul className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 lg:grid-cols-4">
          {cards.map((c) => (
            <li key={c.code} className="min-w-0">
              <BadgeCardFlip front={c.front} back={c.back} label={`${c.name} #${c.serial}`} />
              <div className="mt-2 flex items-baseline justify-between gap-2 text-sm">
                <span className="spec-code">Earned {dateShort(c.mintedAt)}</span>
                <Link href={`/b/${c.code}`} className="font-bold text-[var(--accent)] hover:underline">
                  Verify
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-5 text-[15px] text-[var(--muted)]">No badges yet. The first one comes with your first check-in.</p>
      )}
      {locked.length > 0 && (
        <>
          <h3 className="spec-code border-t-2 border-dashed border-[var(--border)] px-5 pt-4">Still to earn</h3>
          <ul className="grid grid-cols-3 gap-3 p-5 sm:grid-cols-4 lg:grid-cols-6">
            {locked.map((b) => {
              const how = badgeFor(b.key)?.how ?? b.flavor;
              const needsBirthday = b.key === "birthday" && !birthdayLabel(birthday);
              return (
                <li key={b.key} className="min-w-0 text-[var(--muted)]">
                  <div className="badge-svg opacity-40 grayscale" aria-hidden="true" dangerouslySetInnerHTML={{ __html: b.front }} />
                  <div className="font-display mt-1.5 text-[14px] leading-tight text-[var(--foreground)]">{b.name}</div>
                  <div className="text-[13px] leading-snug">
                    {how}
                    {needsBirthday && (
                      <>
                        {" "}
                        <Link href="/account/profile" className="font-bold text-[var(--accent)] hover:underline">
                          Add your birthday
                        </Link>
                      </>
                    )}
                  </div>
                  <div className="spec-code">
                    +{b.points}
                    {b.reward ? ` · ${REWARD_LABEL[b.reward].toLowerCase()}` : ""}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="border-t-2 border-dashed border-[var(--border)] px-5 py-3 text-sm text-[var(--muted)]">
        Each badge pays its points once ({VISIT_POINTS} points every check-in on top), and each one you earn is your own numbered copy, signed by Royale Cinema
        Lounge. Tap a card to turn it over. The birthday one comes back every year.
      </p>
    </Panel>
  );
}

function OldCabinet({ visits, birthday }: { visits: VisitSummary; birthday: string | null }) {
  // A badge's latest earning (Birthday Visit can come every year).
  const earned = new Map<string, { at: string; times: number }>();
  for (const b of visits.badges) earned.set(b.key, { at: b.earnedAt, times: (earned.get(b.key)?.times ?? 0) + 1 });
  return (
    <Panel title="Badges" aside={`${earned.size} of ${BADGES.length}`}>
      <ul className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {BADGES.map((b) => (
          <BadgeTile key={b.key} b={b} earned={earned.get(b.key) ?? null} birthday={birthday} />
        ))}
      </ul>
      <p className="border-t-2 border-dashed border-[var(--border)] px-5 py-3 text-sm text-[var(--muted)]">
        Each badge pays its points once ({VISIT_POINTS} points every check-in on top). The birthday one comes back every year.
      </p>
    </Panel>
  );
}

function BadgeTile({ b, earned, birthday }: { b: Badge; earned: { at: string; times: number } | null; birthday: string | null }) {
  const pts = `+${b.points}${b.reward ? ` · ${REWARD_LABEL[b.reward].toLowerCase()}` : ""}`;
  if (earned) {
    return (
      <li className="flex items-center gap-3 rounded-[6px] border-2 border-[var(--foreground)] bg-[var(--gold)] p-3 shadow-[3px_3px_0_var(--foreground)]">
        <span className="grid size-12 shrink-0 place-items-center rounded-full border-2 border-[var(--foreground)] bg-[var(--surface)] text-2xl" aria-hidden="true">
          {b.emoji}
        </span>
        <div className="min-w-0">
          <div className="font-display leading-tight">{b.label}</div>
          <div className="text-sm font-bold">{pts}</div>
          <div className="spec-code !text-[var(--foreground)]">
            Earned {dateShort(earned.at)}
            {earned.times > 1 ? ` · ${earned.times} times` : ""}
          </div>
        </div>
      </li>
    );
  }
  const needsBirthday = b.key === "birthday" && !birthdayLabel(birthday);
  return (
    <li className="flex items-center gap-3 rounded-[6px] border-2 border-dashed border-[rgba(20,17,12,0.35)] p-3 text-[var(--muted)]">
      <span className="grid size-12 shrink-0 place-items-center rounded-full border-2 border-dashed border-[rgba(20,17,12,0.35)] text-2xl opacity-45 grayscale" aria-hidden="true">
        {b.emoji}
      </span>
      <div className="min-w-0">
        <div className="font-display leading-tight">{b.label}</div>
        <div className="text-sm">
          {b.how}
          {needsBirthday && (
            <>
              {" "}
              <Link href="/account/profile" className="font-bold text-[var(--accent)] hover:underline">
                Add your birthday
              </Link>
            </>
          )}
        </div>
        <div className="spec-code">{pts}</div>
      </div>
    </li>
  );
}
