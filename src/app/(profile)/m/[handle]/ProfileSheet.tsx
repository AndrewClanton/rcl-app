import Link from "next/link";
import MoviePoster from "@/components/MoviePoster";
import { SpecFoot } from "@/components/print";
import type { PublicProfile } from "@/lib/member-profile";
import { BADGES } from "@/lib/visits";
import ProfileHero from "./ProfileHero";

// A shared profile, drawn from what toPublicProfile() allows and nothing
// else (lib/member-profile.ts): the screen with their name and line, their
// numbers, badges and movies seen, and an invitation to start your own.
export default function ProfileSheet({ p }: { p: PublicProfile }) {
  return (
    <article className="space-y-8">
      <ProfileHero displayName={p.displayName} line={p.line} photo={p.photo} initial={p.initial} memberSince={p.memberSince} flair={p.flair} />

      <section className="sheet crop" aria-label="At the Royale">
        <dl className="spec-grid !grid-cols-2 rounded-[4px] sm:!grid-cols-4">
          <Stat k="Visits" v={p.visits.toLocaleString("en-US")} />
          <Stat k="Weeks in a row" v={p.weekStreak ? `🔥 ${p.weekStreak}` : "0"} hot={p.weekStreak >= 4} />
          <Stat k="Badges" v={`${p.badges.length} of ${p.badgeTotal}`} />
          <Stat k="Movies seen" v={p.movies.total.toLocaleString("en-US")} />
        </dl>
      </section>

      <Badges p={p} />
      <Movies p={p} />

      <section className="rounded-[6px] border-2 border-dashed border-[var(--foreground)] bg-[var(--surface)] p-5 sm:p-6">
        <h2 className="font-display text-xl">Start your own</h2>
        <p className="mt-1 text-[15px] text-[var(--muted)]">
          Royale Insiders is free. Check in at the door with your phone number or email, earn points and badges, pick your own check-in entrance, and share a page like
          this one.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/membership" className="btn-primary px-5 py-2.5">
            Become an Insider
          </Link>
          <Link href="/showtimes" className="btn-secondary px-5 py-2.5">
            What&apos;s playing
          </Link>
        </div>
      </section>
    </article>
  );
}

function Stat({ k, v, hot = false }: { k: string; v: string; hot?: boolean }) {
  return (
    <div className={`spec-cell ${hot ? "!bg-[var(--gold)]" : ""}`}>
      <dt className={`spec-k ${hot ? "!text-[var(--foreground)]" : ""}`}>{k}</dt>
      <dd className="spec-v !text-2xl tabular-nums">{v}</dd>
    </div>
  );
}

function SheetHead({ title, aside }: { title: string; aside?: string }) {
  return (
    <h2 className="spec-head rounded-t-[4px]">
      <span>{title}</span>
      {aside && <span>{aside}</span>}
    </h2>
  );
}

function Badges({ p }: { p: PublicProfile }) {
  const left = BADGES.length - p.badges.length;
  return (
    <section className="sheet crop">
      <SheetHead title="Badges" aside={`${p.badges.length} of ${p.badgeTotal}`} />
      {p.badges.length ? (
        <ul className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 sm:p-5">
          {p.badges.map((b) => (
            <li key={b.key} className="flex min-w-0 items-center gap-3 rounded-[6px] border-2 border-[var(--foreground)] bg-[var(--gold)] p-2.5 shadow-[3px_3px_0_var(--foreground)] sm:p-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-[var(--foreground)] bg-[var(--surface)] text-2xl" aria-hidden="true">
                {b.emoji}
              </span>
              <div className="min-w-0">
                <div className="font-display text-[15px] leading-tight">{b.label}</div>
                {b.earned && (
                  <div className="spec-code mt-0.5 !text-[var(--foreground)]">
                    {b.earned}
                    {b.times > 1 ? ` · ×${b.times}` : ""}
                  </div>
                )}
              </div>
            </li>
          ))}
          {left > 0 && (
            <li className="flex items-center justify-center rounded-[6px] border-2 border-dashed border-[rgba(20,17,12,0.35)] p-3 text-center text-sm text-[var(--muted)]">
              {left} more to earn
            </li>
          )}
        </ul>
      ) : (
        <p className="p-5 text-[15px] text-[var(--muted)]">No badges yet. The first one comes with the first check-in.</p>
      )}
      <SpecFoot />
    </section>
  );
}

// This year's films by name; older ones only counted (our MPLC license:
// lib/mplc.ts). The titles were already split on the server, so older ones
// never reach this page at all.
function Movies({ p }: { p: PublicProfile }) {
  const { named, archive, total } = p.movies;
  return (
    <section className="sheet crop">
      <SheetHead title="Movies seen" aside={total ? `${total} ${total === 1 ? "film" : "films"}` : undefined} />
      {total ? (
        <ul className="grid grid-cols-3 gap-3 p-4 sm:grid-cols-4 sm:p-5">
          {named.map((m, i) => (
            <li key={`${i}-${m.title}`} className="min-w-0">
              <div className="relative">
                <MoviePoster posterUrl={m.posterUrl} title={m.title} sizes="(max-width: 640px) 30vw, 150px" />
                {m.times > 1 && <span className="ctag ctag-red absolute -top-2 -right-2 !px-1.5 !py-0.5 !text-[11px]">×{m.times}</span>}
              </div>
              <div className="mt-1.5 line-clamp-2 text-[13px] leading-tight font-bold">{m.title}</div>
            </li>
          ))}
          {archive > 0 && (
            <li className="min-w-0">
              <div className="grid aspect-[2/3] place-items-center rounded-[4px] border-2 border-[var(--foreground)] bg-[var(--foreground)] p-2 text-center text-[var(--gold)]">
                <div>
                  <FilmCan />
                  <div className="font-display mt-2 text-2xl leading-none">+{archive}</div>
                </div>
              </div>
              <div className="mt-1.5 text-[13px] leading-tight font-bold">from the film archive</div>
            </li>
          )}
        </ul>
      ) : (
        <p className="p-5 text-[15px] text-[var(--muted)]">No movies yet.</p>
      )}
      <SpecFoot />
    </section>
  );
}

function FilmCan() {
  return (
    <svg viewBox="0 0 48 48" className="mx-auto size-12" aria-hidden="true">
      <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="3" />
      {[0, 72, 144, 216, 288].map((a) => {
        const r = ((a - 90) * Math.PI) / 180;
        return <circle key={a} cx={24 + Math.cos(r) * 10.5} cy={24 + Math.sin(r) * 10.5} r="4" fill="currentColor" />;
      })}
      <circle cx="24" cy="24" r="2.5" fill="currentColor" />
    </svg>
  );
}
