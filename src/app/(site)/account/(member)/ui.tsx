import Link from "next/link";
import type { MemberBooth, MemberScreening, PurchaseRow } from "@/lib/data/member-account";
import MoviePoster from "@/components/MoviePoster";
import { dateShort, money, showtime } from "./format";
import { ProofStamp, SpecFoot } from "@/components/print";

// Shared pieces for the member account pages, set in the Royale Proof Sheet
// style (ink rules, spec heads, ticket stubs) like the rest of the site.

// A button or button-styled link a thumb can hit: at least 44px tall, its
// label centered. Links are inline, so they need the flex box for the
// height to apply.
export const TAP = "inline-flex min-h-11 items-center justify-center text-center";

// The spacing between a page's sections, the same on every tab: tighter on
// a phone, where the screen is short.
export const STACK = "space-y-8 sm:space-y-10";

export function SectionHead({ title, href, link }: { title: string; href?: string; link?: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="font-display text-xl leading-tight sm:text-2xl">{title}</h2>
      {href && link && (
        // The padding makes it a full-size target without moving the text.
        <Link href={href} className="-my-3 inline-block py-3 text-sm font-bold text-[var(--accent)] hover:underline">
          {link} →
        </Link>
      )}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[6px] border-2 border-dashed border-[rgba(20,17,12,0.35)] px-4 py-5 text-[15px] text-[var(--muted)] sm:px-5 sm:py-6">{children}</div>;
}

// A screening as a ticket stub: poster, the show, and a tear-off "admit".
// An upcoming one opens its tickets (the QR code for the door); a past one,
// its receipt. A long title takes two lines before it's cut.
export function TicketStub({ s, past = false }: { s: MemberScreening; past?: boolean }) {
  return (
    <Link
      href={past ? `/account/purchases/ticket/${s.bookingId}` : `/account/movies/${s.bookingId}`}
      className="sheet flex min-w-0 items-stretch overflow-hidden transition-transform hover:-translate-y-px"
    >
      <div className="w-14 shrink-0 border-r-2 border-[var(--foreground)] sm:w-16">
        <MoviePoster posterUrl={s.posterUrl} title={s.title} sizes="64px" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-3 sm:px-4">
        <div className="spec-k">{s.room}</div>
        <div className="font-display line-clamp-2 text-lg leading-tight break-words">{s.title}</div>
        <div className={`mt-1 text-sm font-bold ${past ? "text-[var(--muted)]" : "text-[var(--accent)]"}`}>{showtime(s.startsAt)}</div>
      </div>
      <div className={`flex w-16 shrink-0 flex-col items-center justify-center border-l-2 border-dashed border-[var(--foreground)] px-2 text-center sm:w-[4.5rem] ${past ? "bg-[var(--surface-hover)]" : "bg-[var(--gold)]"}`}>
        <div className="spec-k !mb-0 !text-[var(--foreground)]">Admit</div>
        <div className="font-display text-2xl leading-none">{s.quantity}</div>
      </div>
    </Link>
  );
}

// Purchase lines for a sheet: date in mono, what it was, the amount.
export function PurchaseRows({ rows }: { rows: PurchaseRow[] }) {
  return (
    <ul>
      {rows.map((p) => (
        <li key={`${p.kind}-${p.id}`} className="border-b border-[var(--border)] last:border-b-0">
          <Link href={`/account/purchases/${p.kind}/${p.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-hover)] sm:gap-4">
            <div className="spec-code hidden w-24 shrink-0 sm:block">{dateShort(p.date)}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold">{p.label}</div>
              <div className="truncate text-sm text-[var(--muted)]">
                <span className="sm:hidden">{dateShort(p.date)} · </span>
                {p.detail}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className={`font-display tabular-nums ${p.status === "refunded" ? "text-[var(--muted)] line-through" : ""}`}>{money(p.amount)}</div>
              {p.status === "refunded" && <div className="spec-code !text-[var(--accent)]">Refunded</div>}
            </div>
            <span className="font-display text-[var(--muted)]" aria-hidden="true">
              ›
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// A spec panel of figures: ink head, then a grid of label/value cells.
// Four figures go two by two on a phone, all four across from a tablet up.
export function SpecPanel({
  title,
  aside,
  cells,
  stamp,
  className = "",
}: {
  title: string;
  aside?: string;
  cells: { k: string; v: string; hot?: boolean }[];
  stamp?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`sheet crop ${className}`}>
      <h2 className="spec-head flex-wrap gap-y-1 rounded-t-[4px]">
        <span>{title}</span>
        <span className="flex items-center gap-4">
          {aside && <span>{aside}</span>}
          {stamp && <ProofStamp>{stamp}</ProofStamp>}
        </span>
      </h2>
      <dl className={`spec-grid ${cells.length === 3 ? "spec-grid-3" : ""} ${cells.length === 4 ? "!grid-cols-2 sm:!grid-cols-4" : ""} rounded-b-[4px]`}>
        {cells.map((c) => (
          <div key={c.k} className={`spec-cell ${c.hot ? "!bg-[var(--gold)]" : ""}`}>
            <dt className={`spec-k ${c.hot ? "!text-[var(--foreground)]" : ""}`}>{c.k}</dt>
            <dd className="spec-v">{c.v}</dd>
          </div>
        ))}
      </dl>
      <SpecFoot />
    </section>
  );
}

// A titled sheet (spec head + body), for sections of a page.
export function Panel({ title, aside, children, className = "" }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`sheet crop min-w-0 ${className}`}>
      <h2 className="spec-head flex-wrap gap-y-1 rounded-t-[4px]">
        <span>{title}</span>
        {aside && <span>{aside}</span>}
      </h2>
      {children}
    </section>
  );
}

// An upcoming booth reservation as a stub: the date block, the booth and
// window, and a tear-off with the party size.
export function BoothStub({ b }: { b: MemberBooth }) {
  const [dow, rest] = b.dateLabel.split(", ");
  return (
    <div className="sheet flex min-w-0 items-stretch overflow-hidden">
      <div className="flex w-14 shrink-0 flex-col items-center justify-center border-r-2 border-[var(--foreground)] bg-[var(--foreground)] px-1 py-3 text-center text-[var(--gold)] sm:w-16">
        <div className="spec-k !mb-0 !text-[var(--gold)]">{dow}</div>
        <div className="font-display text-sm leading-tight">{rest}</div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-3 sm:px-4">
        <div className="spec-k">{b.free ? "Booth · free with Insiders+" : "Booth · reserved"}</div>
        <div className="font-display line-clamp-2 text-lg leading-tight break-words">{b.booth}</div>
        <div className="mt-1 text-sm font-bold text-[var(--accent)]">{b.window}</div>
      </div>
      <div className="flex w-16 shrink-0 flex-col items-center justify-center border-l-2 border-dashed border-[var(--foreground)] bg-[var(--gold)] px-2 text-center sm:w-[4.5rem]">
        <div className="spec-k !mb-0 !text-[var(--foreground)]">Party</div>
        <div className="font-display text-2xl leading-none">{b.party}</div>
      </div>
    </div>
  );
}
