import Link from "next/link";
import type { MemberBooth, MemberScreening, PurchaseRow } from "@/lib/data/member-account";
import type { Member } from "@/lib/types";
import { ANNUAL_PRICE, RATE_LABEL, RATE_PRICE, dollars, planPrice } from "@/lib/membership-rates";
import { POINTS_PER_REWARD, REWARD_VALUE } from "@/lib/loyalty";
import MemberQrCode from "@/components/MemberQrCode";
import MoviePoster from "@/components/MoviePoster";
import { GooglePhotoButton, PhotoUploadButton } from "../PhotoButtons";
import { dayMonth, points } from "./format";
import PlusLink from "@/components/PlusLink";
import { plusNeedsCard } from "@/lib/plus-status";
import { BoothStub, Empty, Panel, PurchaseRows, SectionHead, TicketStub } from "./ui";

export default function OverviewView({
  member,
  purchases,
  screenings,
  booths = [],
  googlePhoto,
  welcome,
}: {
  member: Member;
  purchases: PurchaseRow[];
  screenings: { upcoming: MemberScreening[]; past: MemberScreening[] };
  booths?: MemberBooth[];
  googlePhoto: string | null;
  welcome: boolean;
}) {
  const balance = Math.floor(Number(member.points));
  const rewards = Math.floor(balance / POINTS_PER_REWARD);
  const toNext = POINTS_PER_REWARD - (balance % POINTS_PER_REWARD);
  const progress = ((balance % POINTS_PER_REWARD) / POINTS_PER_REWARD) * 100;
  const rate = member.price_tier ?? "adult";

  return (
    <div className="space-y-12">
      {welcome && (
        <div className="sheet p-5">
          <span className="ctag ctag-yellow">Welcome</span>
          <p className="mt-3 text-[15px]">
            <strong className="font-display">Your Royale Insiders account is ready.</strong> You earn a point for every dollar you spend with us.
          </p>
        </div>
      )}

      <div className="grid gap-7 md:grid-cols-[1.3fr_1fr]">
        {/* Points: the Panel Pop treatment, the loudest thing on the page. */}
        <section className="sheet halftone halftone-hero bg-[var(--gold)] !border-4 !shadow-[7px_7px_0_var(--foreground)]">
          <div className="relative z-[1] p-6">
            <div className="spec-k !text-[var(--foreground)]">Points balance</div>
            <div className="font-display mt-1 text-7xl leading-none tabular-nums">{points(balance)}</div>
            {rewards > 0 ? (
              <p className="mt-3 max-w-[40ch] text-[15px] font-bold">
                {rewards === 1 ? "You have a reward ready" : `You have ${rewards} rewards ready`}: ${REWARD_VALUE * rewards} off at the register. Just ask when you order.
              </p>
            ) : (
              <p className="mt-3 text-[15px]">
                <strong>{toNext} more points</strong> to your next ${REWARD_VALUE} off.
              </p>
            )}
            <div className="mt-4 h-4 overflow-hidden rounded-[3px] border-2 border-[var(--foreground)] bg-[var(--surface)]" aria-hidden="true">
              <div className="h-full bg-[var(--accent)]" style={{ width: `${rewards > 0 && progress === 0 ? 100 : progress}%` }} />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <span className="spec-code !text-[var(--foreground)]">
                1 point per $1 · {POINTS_PER_REWARD} points = ${REWARD_VALUE} off
              </span>
              <Link href="/account/points" className="text-sm font-bold underline decoration-2 underline-offset-2">
                Points history →
              </Link>
            </div>
          </div>
        </section>

        {/* Member card */}
        <Panel title="Member card" aside={member.tier}>
          <div className="flex flex-col items-center gap-4 p-5 text-center sm:flex-row sm:text-left md:flex-col md:text-center lg:flex-row lg:text-left">
            <div className="shrink-0 rounded-[4px] border-2 border-[var(--foreground)] bg-white p-1.5">
              <MemberQrCode memberId={member.id} />
            </div>
            <div className="min-w-0">
              <p className="text-[15px]">Show this at the door or the register and we&apos;ll pull up your account.</p>
              {rate !== "adult" && <p className="spec-code mt-2">{RATE_LABEL[rate]} rate</p>}
            </div>
          </div>
        </Panel>
      </div>

      {!member.avatar_url && (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-[6px] border-2 border-dashed border-[var(--foreground)] bg-[var(--surface)] p-5">
          <div className="max-w-xl">
            <h2 className="font-display text-xl">Add your photo</h2>
            <p className="mt-1 text-[15px] text-[var(--muted)]">
              Staff can find your account at the register by your photo, so you don&apos;t have to spell your name over the music. Only our staff see it.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {googlePhoto && <GooglePhotoButton className="btn-primary px-4 py-2.5" />}
            <PhotoUploadButton label={googlePhoto ? "Upload a different photo" : "Upload a photo"} className={`${googlePhoto ? "btn-secondary" : "btn-primary"} px-4 py-2.5`} />
          </div>
        </section>
      )}

      {screenings.upcoming.length > 0 && (
        <section>
          <SectionHead title="Your tickets" href="/account/movies" link="All movies" />
          <div className="grid gap-5 sm:grid-cols-2">
            {screenings.upcoming.slice(0, 4).map((s) => (
              <TicketStub key={s.bookingId} s={s} />
            ))}
          </div>
        </section>
      )}

      {booths.length > 0 && (
        <section>
          <SectionHead title="Your booths" href="/booths" link="Reserve another" />
          <div className="grid gap-5 sm:grid-cols-2">
            {booths.map((b) => (
              <BoothStub key={b.id} b={b} />
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionHead title="Recently watched" href="/account/movies" link="All movies" />
        {screenings.past.length === 0 ? (
          <Empty>
            Movies you buy tickets for with this account show up here.{" "}
            <Link href="/showtimes" className="font-bold text-[var(--accent)] hover:underline">
              See what&apos;s playing
            </Link>
          </Empty>
        ) : (
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
            {screenings.past.slice(0, 6).map((s) => (
              <div key={s.bookingId}>
                <div className="overflow-hidden rounded-[3px] border-2 border-[var(--foreground)] shadow-[3px_3px_0_var(--foreground)]">
                  <MoviePoster posterUrl={s.posterUrl} title={s.title} sizes="150px" />
                </div>
                <div className="mt-2 truncate text-sm font-bold">{s.title}</div>
                <div className="spec-code">{dayMonth(s.startsAt)}</div>
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
          <div className="sheet overflow-hidden">
            <PurchaseRows rows={purchases.slice(0, 5)} />
          </div>
        )}
      </section>

      {plusNeedsCard(member) ? (
        // Insiders+ set at the box office with nothing paying for it yet.
        <section className="sheet halftone halftone-hero flex flex-wrap items-center justify-between gap-4 bg-[var(--gold)] p-6">
          <div className="relative z-[1]">
            <span className="ctag ctag-red">Insiders+</span>
            <p className="font-display mt-3 text-2xl">Add a card to keep your Insiders+.</p>
            <p className="mt-1 max-w-[52ch] text-[15px]">
              It was set up at the box office. ${RATE_PRICE[rate]}/month or {dollars(ANNUAL_PRICE[rate])}/year; your perks stay on in the meantime.
            </p>
          </div>
          <PlusLink next="/account" className="btn-primary relative z-[1] px-5 py-3">
            Add a card
          </PlusLink>
        </section>
      ) : member.tier === "Insiders+" ? (
        <section className="sheet flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <span className="ctag ctag-yellow">Insiders+</span>
            <p className="mt-3 text-[15px]">
              {member.comped ? "Your Insiders+ is complimentary." : `${RATE_LABEL[rate]} rate · ${planPrice(rate, member.billing_interval ?? "month")}, billed on the day you joined.`}
            </p>
          </div>
          <Link href="/account/billing" className="btn-secondary px-5 py-3">
            Billing &amp; statements
          </Link>
        </section>
      ) : (
        <section className="sheet flex flex-wrap items-center justify-between gap-4 !bg-[var(--foreground)] p-6 text-[var(--background)]">
          <div>
            <span className="ctag ctag-yellow">Insiders+</span>
            <p className="font-display mt-3 text-2xl text-[var(--gold)]">Walk in free, every time.</p>
            <p className="mt-1 max-w-[56ch] text-[15px] opacity-85">
              Unlimited screenings, 2 free booth reservations a month, and member discounts, for ${RATE_PRICE[rate]}/month, or {dollars(ANNUAL_PRICE[rate])}/year (save 15%).
            </p>
          </div>
          <PlusLink next="/account" className="btn-primary px-5 py-3">
            Get Insiders+
          </PlusLink>
        </section>
      )}
    </div>
  );
}
