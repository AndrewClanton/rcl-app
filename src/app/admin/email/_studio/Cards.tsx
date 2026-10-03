import Link from "next/link";
import NewEmail from "./NewEmail";
import { CompactTrack, EmailThumb, Progress, StatusChip, StepTrack } from "./ui";
import type { CardItem, UpNext } from "./data";

// The Email pages' campaign cards and the gold "Up next" panel.

// One email as a card: its thumbnail, name, status, how much has gone,
// and one line on how it's doing. On a phone, a row with a small square.
export function CampaignCard({ c }: { c: CardItem }) {
  return (
    <Link
      href={c.href}
      className="group flex min-h-11 items-center gap-3 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 text-[var(--foreground)] hover:border-[var(--foreground)] sm:flex-col sm:items-stretch sm:gap-0 sm:p-0"
    >
      <div className="sm:hidden">
        <EmailThumb thumb={c.thumb} size="tile" />
      </div>
      <div className="hidden sm:block">
        <EmailThumb thumb={c.thumb} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:px-4 sm:pb-4 sm:pt-3.5">
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 font-bold group-hover:underline">{c.title}</span>
          <StatusChip label={c.chip.label} tone={c.chip.tone} />
        </div>
        {c.progress && (
          <div className="hidden sm:block">
            <Progress done={c.progress.done} total={c.progress.total} label={c.progress.label} />
          </div>
        )}
        <span className="text-sm text-[var(--muted)]">{c.line}</span>
      </div>
    </Link>
  );
}

export function CardGrid({ cards }: { cards: CardItem[] }) {
  return (
    <ul className="grid list-none gap-3 p-0 sm:grid-cols-[repeat(auto-fill,minmax(250px,1fr))] sm:gap-4">
      {cards.map((c) => (
        <li key={c.key} className="flex min-w-0 flex-col [&>a]:flex-1">
          <CampaignCard c={c} />
        </li>
      ))}
    </ul>
  );
}

// "Up next": the one email most worth a look (data.ts upNext says which),
// where it's got to, and one way in. A link, never a send: the send and
// its confirm are on the email's own screen. Ink, so it doesn't look like
// it emails anyone.
export function UpNextPanel({ next, senders }: { next: UpNext | null; senders: string | null }) {
  if (!next)
    return (
      <section aria-labelledby="next-h" className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] bg-[var(--gold)] p-5 text-[var(--foreground)] sm:p-8">
        <div className="space-y-1.5">
          <span className="es-mono">Up next</span>
          <h2 id="next-h" className="font-display text-3xl leading-none sm:text-[42px]">
            All caught up
          </h2>
          <p className="text-[#3d3528]">Nothing is waiting on anyone. Start a new email when you&apos;re ready.</p>
        </div>
        <NewEmail />
      </section>
    );
  return (
    <section aria-labelledby="next-h" className="grid gap-6 rounded-[20px] bg-[var(--gold)] p-5 text-[var(--foreground)] sm:gap-8 sm:p-8 lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)]">
      <div className="hidden justify-center pt-1 sm:flex">
        <EmailThumb thumb={next.thumb} size="hero" subject={next.subject} preheader={next.preheader} />
      </div>
      <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
        <div className="space-y-1.5">
          <span className="es-mono">Up next</span>
          <h2 id="next-h" className="font-display text-3xl leading-none sm:text-[42px] sm:leading-[1.02]">
            {next.title}
          </h2>
          <p className="text-[17px]">&ldquo;{next.subject}&rdquo;</p>
          <p className="text-[15px] text-[#3d3528]">
            <strong className="text-[var(--foreground)]">{next.who}</strong>
            {next.whoMore ? <span className="hidden sm:inline">. {next.whoMore}</span> : null}
          </p>
        </div>
        <div className="hidden sm:block">
          <StepTrack steps={next.steps} label={`Steps for ${next.title}`} />
        </div>
        <div className="sm:hidden">
          <CompactTrack steps={next.steps} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={next.href} className="btn-ink w-full !min-h-[52px] !text-base sm:w-auto">
            {next.action}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
          <span className="min-w-0 flex-1 basis-64 text-sm text-[#3d3528]">
            {next.hint}
            {senders ? ` ${senders}` : ""}
          </span>
        </div>
      </div>
    </section>
  );
}
