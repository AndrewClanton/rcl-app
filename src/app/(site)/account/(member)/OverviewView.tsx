import Link from "next/link";
import type { MemberScreening, PurchaseRow } from "@/lib/data/member-account";
import type { Member } from "@/lib/types";
import { RATE_LABEL, RATE_PRICE } from "@/lib/membership-rates";
import { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";
import MemberQrCode from "@/components/MemberQrCode";
import MoviePoster from "@/components/MoviePoster";
import { GooglePhotoButton, PhotoUploadButton } from "../PhotoButtons";
import { dateShort, dayMonth, money, points, showtime } from "./format";

export default function OverviewView({
  member,
  purchases,
  screenings,
  googlePhoto,
  welcome,
}: {
  member: Member;
  purchases: PurchaseRow[];
  screenings: { upcoming: MemberScreening[]; past: MemberScreening[] };
  googlePhoto: string | null;
  welcome: boolean;
}) {
  const balance = Math.floor(Number(member.points));
  const rewards = Math.floor(balance / POINTS_PER_REWARD);
  const toNext = POINTS_PER_REWARD - (balance % POINTS_PER_REWARD);
  const progress = ((balance % POINTS_PER_REWARD) / POINTS_PER_REWARD) * 100;
  const rate = member.price_tier ?? "adult";

  return (
    <div className="space-y-10">
      {welcome && (
        <div className="notice notice-success">
          <strong>Welcome to Royale Insiders.</strong> Your account is ready. You earn a point for every dollar you spend with us.
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-[1.25fr_1fr]">
        {/* Points */}
        <section className="rounded-2xl border-2 border-[var(--foreground)] bg-[var(--gold)] p-6 text-[var(--gold-foreground)]">
          <div className="text-xs font-bold uppercase tracking-[0.14em]">Points balance</div>
          <div className="font-display mt-1 text-6xl leading-none">{points(balance)}</div>
          {rewards > 0 ? (
            <p className="mt-3 text-sm font-bold">
              {rewards === 1 ? "You have a reward ready" : `You have ${rewards} rewards ready`}: ${REWARD_VALUE * rewards} off at the register. Just ask when you
              order.
            </p>
          ) : (
            <p className="mt-3 text-sm">
              <strong>{toNext} more points</strong> to your next ${REWARD_VALUE} off.
            </p>
          )}
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[var(--gold-foreground)]/15" aria-hidden="true">
            <div className="h-full rounded-full bg-[var(--gold-foreground)]" style={{ width: `${rewards > 0 && progress === 0 ? 100 : progress}%` }} />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>1 point for every $1 · {POINTS_PER_REWARD} points = ${REWARD_VALUE} off</span>
            <Link href="/account/points" className="font-bold underline underline-offset-2">
              Points history →
            </Link>
          </div>
        </section>

        {/* Member card */}
        <section className="card flex flex-col items-center gap-4 text-center sm:flex-row sm:gap-5 sm:text-left">
          <div className="shrink-0 rounded-xl border border-[var(--border)] bg-white p-1.5">
            <MemberQrCode memberId={member.id} />
          </div>
          <div className="min-w-0">
            <div className="eyebrow mb-1">Member card</div>
            <p className="text-sm">Show this at the door or the register and we&apos;ll pull up your account.</p>
            <p className="mt-2 text-xs text-[var(--muted)]">
              {member.tier}
              {rate !== "adult" ? ` · ${RATE_LABEL[rate]} rate` : ""}
            </p>
          </div>
        </section>
      </div>

      {!member.avatar_url && (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-dashed border-[var(--foreground)] bg-[var(--surface)] p-5">
          <div className="max-w-xl">
            <h2 className="font-display text-xl">Add your photo</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Staff can find your account at the register by your photo, so you don&apos;t have to spell your name over the music. Only our staff
              see it.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {googlePhoto && <GooglePhotoButton className="btn-primary" />}
            <PhotoUploadButton label={googlePhoto ? "Upload a different photo" : "Upload a photo"} className={googlePhoto ? "btn-secondary" : "btn-primary"} />
          </div>
        </section>
      )}

      {screenings.upcoming.length > 0 && (
        <section>
          <SectionHead title="Your upcoming tickets" href="/account/movies" link="All movies" />
          <div className="grid gap-3 sm:grid-cols-2">
            {screenings.upcoming.slice(0, 4).map((s) => (
              <Link key={s.bookingId} href={`/account/purchases/ticket/${s.bookingId}`} className="card-flat flex items-center gap-4">
                <div className="w-14 shrink-0">
                  <MoviePoster posterUrl={s.posterUrl} title={s.title} sizes="56px" />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-bold">{s.title}</div>
                  <div className="text-sm text-[var(--accent)]">{showtime(s.startsAt)}</div>
                  <div className="text-xs text-[var(--muted)]">
                    {s.room} · {s.quantity} ticket{s.quantity === 1 ? "" : "s"}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHead title="Recently watched" href="/account/movies" link="All movies" />
        {screenings.past.length === 0 ? (
          <Empty>
            Movies you buy tickets for with this account show up here. <Link href="/showtimes" className="font-bold text-[var(--accent)] hover:underline">See what&apos;s playing</Link>
          </Empty>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {screenings.past.slice(0, 6).map((s) => (
              <div key={s.bookingId}>
                <MoviePoster posterUrl={s.posterUrl} title={s.title} sizes="150px" />
                <div className="mt-1.5 truncate text-xs font-bold">{s.title}</div>
                <div className="text-xs text-[var(--muted)]">{dayMonth(s.startsAt)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHead title="Recent purchases" href="/account/purchases" link="All purchases" />
        {purchases.length === 0 ? (
          <Empty>Purchases at the bar, kitchen and box office show up here when staff attach your account.</Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            {purchases.slice(0, 5).map((p, i) => (
              <Link
                key={`${p.kind}-${p.id}`}
                href={`/account/purchases/${p.kind}/${p.id}`}
                className={`flex items-center justify-between gap-4 px-4 py-3 hover:bg-[var(--surface-hover)] ${i ? "border-t border-[var(--border)]" : ""}`}
              >
                <div className="min-w-0">
                  <div className="truncate font-bold">{p.label}</div>
                  <div className="truncate text-xs text-[var(--muted)]">
                    {dateShort(p.date)} · {p.detail}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`font-bold ${p.status === "refunded" ? "text-[var(--muted)] line-through" : ""}`}>{money(p.amount)}</div>
                  {p.status === "refunded" && <div className="text-[11px] font-bold uppercase text-[var(--accent)]">Refunded</div>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {member.tier === "Insiders+" ? (
        <section className="card flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="eyebrow mb-1">Insiders+</div>
            <p className="text-sm">
              {member.comped ? "Your Insiders+ is complimentary." : `${RATE_LABEL[rate]} rate · $${RATE_PRICE[rate]}/month, billed on the day you joined.`}
            </p>
          </div>
          <Link href="/account/billing" className="btn-secondary">
            Billing &amp; statements
          </Link>
        </section>
      ) : (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[var(--foreground)] p-6 text-[var(--background)]">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--gold)]">Insiders+</div>
            <p className="font-display mt-1 text-2xl">Walk in free, every time.</p>
            <p className="mt-1 text-sm opacity-80">
              Unlimited screenings, 2 free booth reservations a month, and member discounts, for ${RATE_PRICE[rate]}/month.
            </p>
          </div>
          <Link href="/membership" className="btn-primary">
            Upgrade
          </Link>
        </section>
      )}
    </div>
  );
}

function SectionHead({ title, href, link }: { title: string; href: string; link: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-4">
      <h2 className="font-display text-xl">{title}</h2>
      <Link href={href} className="text-sm font-bold text-[var(--accent)] hover:underline">
        {link} →
      </Link>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-sm text-[var(--muted)]">{children}</div>;
}
