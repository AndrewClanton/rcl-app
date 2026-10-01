import Link from "next/link";
import { PageMasthead, SpecFoot, Sprockets, Starburst } from "@/components/print";
import { pageMeta } from "@/lib/seo/page-meta";
import { getSignedInMember } from "@/lib/member-auth";
import { getMemberRoadmapState, getPublicRoadmap, type MemberRoadmapState, type PublicRoadmapItem } from "@/lib/data/roadmap";
import { centralDay, longDate, timeAgo } from "@/lib/roadmap";
import { BuildingCard, IdeaCard, LivePulse, QueueRow, SectionHead, ShippedRow, type Viewer } from "./parts";
import SuggestBox from "./SuggestBox";
import LiveRefresh from "./LiveRefresh";

// What's new: the changelog and the roadmap in one. What the crew is
// building right now, what just shipped, what's next in line, and the
// ideas we're considering, with "I want this too" and "Suggest something"
// for signed-in members. Drawn per request (the signed-in member's own
// votes and suggestions), and it refreshes itself while open.
export const dynamic = "force-dynamic";

export const metadata = pageMeta({
  title: "What's new",
  description:
    "What just shipped at Royale Cinema Lounge, what the crew is building right now, and what's next in line. Suggest an idea, vote for the ones you want, and follow them all the way to live.",
  path: "/whats-new",
});

// Shipped items shown before "Show everything we've shipped".
const SHIPPED_SHOWN = 12;

function renderTime() {
  return Date.now();
}

// "Just shipped", a day at a time, newest first. The releases those
// changes went out in sit quietly beside the date.
function shippedByDay(items: PublicRoadmapItem[]) {
  const days: { day: string; date: string; releases: string[]; items: PublicRoadmapItem[] }[] = [];
  for (const item of items) {
    const at = item.shippedAt ?? item.statusSince;
    const day = centralDay(at);
    let group = days[days.length - 1];
    if (!group || group.day !== day) {
      group = { day, date: at, releases: [], items: [] };
      days.push(group);
    }
    group.items.push(item);
    if (item.release && !group.releases.includes(item.release)) group.releases.push(item.release);
  }
  return days;
}

function ShippedDays({ items }: { items: PublicRoadmapItem[] }) {
  return (
    <div className="space-y-6">
      {shippedByDay(items).map((d) => (
        <section key={d.day} className="sheet crop" aria-label={longDate(d.date)}>
          <h3 className="spec-head rounded-t-[4px]">
            <span>{longDate(d.date)}</span>
            {d.releases.length > 0 && <span className="font-mono text-[10.5px] font-normal tracking-[0.08em] opacity-70">Release {d.releases.join(", ")}</span>}
          </h3>
          <ul className="divide-y divide-[var(--border)]">
            {d.items.map((item) => (
              <ShippedRow key={item.id} item={item} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Stat({ k, v, href }: { k: string; v: number; href: string }) {
  return (
    <a href={href} className="spec-cell block transition-colors hover:bg-[var(--surface-hover)]">
      <div className="spec-k">{k}</div>
      <div className="font-display text-3xl leading-none tabular-nums sm:text-4xl">{v}</div>
    </a>
  );
}

const STEPS: [string, string][] = [
  ["Suggest it", "Tell us what you'd love to see: a feature, a night, a snack, anything."],
  ["We say yes", "It goes on this list, in line, and you get a link to follow it."],
  ["Watch it get built", "See it move up the line, into Building now, then final checks."],
  ["It ships", "It lands in Just shipped, with your name on it if you'd like."],
];

function MySuggestions({ mine }: { mine: MemberRoadmapState }) {
  if (!mine.suggestions.length) return null;
  const label = { new: "With the crew", accepted: "On the list", declined: "Not right now" } as const;
  return (
    <div className="mt-8">
      <h3 className="label-xs">Your suggestions</h3>
      <ul className="mt-2 space-y-2">
        {mine.suggestions.map((s) => (
          <li key={s.id} className="rounded-[4px] border-2 border-[var(--foreground)] bg-[var(--surface)] px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`ctag !px-2 !py-0.5 !text-[10px] ${s.status === "accepted" ? "ctag-yellow" : s.status === "declined" ? "bg-[var(--surface-hover)] text-[var(--muted)]" : "bg-[var(--surface)]"}`}>
                {label[s.status]}
              </span>
              <span className="font-mono text-[10.5px] text-[var(--muted)] uppercase">{timeAgo(s.createdAt)}</span>
            </div>
            <p className="mt-1.5 line-clamp-3 whitespace-pre-line">{s.body}</p>
            {s.itemSlug && (
              <Link href={`/whats-new/${s.itemSlug}`} className="mt-1 inline-block font-bold text-[var(--accent)] hover:underline">
                Follow it: {s.itemTitle} →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function WhatsNewPage() {
  const [roadmap, member] = await Promise.all([getPublicRoadmap(), getSignedInMember()]);
  const mine = member ? await getMemberRoadmapState(member.id).catch(() => null) : null;
  const viewer: Viewer = { signedIn: !!member, voted: new Set(mine?.voted ?? []) };
  const now = renderTime();
  const { building, shipped, queued, ideas } = roadmap;
  const recent = shipped.slice(0, SHIPPED_SHOWN);
  const older = shipped.slice(SHIPPED_SHOWN);
  const weekAgo = now - 7 * 86_400_000;
  const shippedThisWeek = shipped.filter((s) => Date.parse(s.shippedAt ?? s.statusSince) >= weekAgo).length;

  return (
    <div className="space-y-16">
      <LiveRefresh />
      <div className="relative">
        <Starburst className="starburst-red absolute -top-3 right-0 z-[2] hidden sm:block">
          Built
          <br />
          in the
          <br />
          open
        </Starburst>
        <PageMasthead
          eyebrow="Changelog & roadmap"
          title="What's new"
          intro={
            <>
              The Royale is a work in progress, on purpose. Here&apos;s what the crew is building right now, what just shipped, and what&apos;s next in line. Got an idea?{" "}
              <a href="#suggest" className="font-bold text-[var(--accent)] hover:underline">
                Suggest it
              </a>
              . If we build it, it can have your name on it.
            </>
          }
          className="!mb-0"
        />
      </div>

      {/* The board at a glance. */}
      <div className="sheet crop">
        <div className="spec-head rounded-t-[4px]">
          <span className="inline-flex items-center gap-2">
            <LivePulse small />
            Live board
          </span>
          {roadmap.lastUpdate && <span className="font-mono text-[10.5px] font-normal tracking-[0.06em] normal-case opacity-80">Last change {timeAgo(roadmap.lastUpdate, now)}</span>}
        </div>
        <div className="spec-grid !grid-cols-2 sm:!grid-cols-4">
          <Stat k="Shipped this week" v={shippedThisWeek} href="#shipped" />
          <Stat k="Building now" v={building.length} href="#building" />
          <Stat k="In line" v={queued.length} href="#up-next" />
          <Stat k="Ideas" v={ideas.length} href="#ideas" />
        </div>
      </div>

      <section aria-labelledby="building-h" className="site-anchor" id="building">
        <SectionHead id="building-h" kicker="On the workbench" title="Building now" count={building.length} live={building.length > 0} />
        {building.length ? (
          <div className="grid gap-6 md:grid-cols-2">
            {building.map((item) => (
              <BuildingCard key={item.id} item={item} viewer={viewer} now={now} />
            ))}
          </div>
        ) : (
          <p className="text-[15px] text-[var(--muted)]">Nothing on the workbench this minute. The next thing in line is up soon.</p>
        )}
      </section>

      <section aria-labelledby="shipped-h" className="site-anchor" id="shipped">
        <SectionHead id="shipped-h" kicker="Fresh off the press" title="Just shipped" />
        {recent.length ? <ShippedDays items={recent} /> : <p className="text-[15px] text-[var(--muted)]">The first changes land here soon.</p>}
        {older.length > 0 && (
          <details className="mt-6">
            <summary className="btn-secondary inline-flex cursor-pointer list-none px-5 py-2.5 [&::-webkit-details-marker]:hidden">Show everything we&apos;ve shipped ({shipped.length})</summary>
            <div className="mt-6">
              <ShippedDays items={older} />
            </div>
          </details>
        )}
      </section>

      <Sprockets />

      <section aria-labelledby="up-next-h" className="site-anchor" id="up-next">
        <SectionHead id="up-next-h" kicker="The queue" title="Up next" count={queued.length} />
        {queued.length ? (
          <ol className="space-y-4">
            {queued.map((item) => (
              <QueueRow key={item.id} item={item} viewer={viewer} now={now} />
            ))}
          </ol>
        ) : (
          <p className="text-[15px] text-[var(--muted)]">The line is empty: everything we said yes to is being built or already live. Suggest the next thing!</p>
        )}
      </section>

      <section aria-labelledby="ideas-h" className="site-anchor" id="ideas">
        <SectionHead id="ideas-h" kicker="Tell us what you want" title="Ideas we're considering" count={ideas.length}>
          <p className="max-w-sm text-sm text-[var(--muted)]">Tap &quot;I want this too&quot; on the ones you&apos;d use. The most wanted move up.</p>
        </SectionHead>
        {ideas.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ideas.map((item) => (
              <IdeaCard key={item.id} item={item} viewer={viewer} />
            ))}
          </div>
        ) : (
          <p className="text-[15px] text-[var(--muted)]">No ideas waiting right now. Yours could be the first.</p>
        )}
      </section>

      <section id="suggest" aria-labelledby="suggest-h" className="site-anchor sheet crop overflow-visible">
        <h2 id="suggest-h" className="spec-head rounded-t-[4px]">
          <span>Suggest something</span>
        </h2>
        <div className="grid gap-8 p-5 sm:p-8 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="font-display text-3xl leading-tight text-balance">Your idea, built here.</p>
            <p className="mt-3 text-[15px] text-[var(--muted)]">A lot of what&apos;s on this page started as someone at the bar saying &quot;you know what you should do?&quot; Here&apos;s how it works:</p>
            <ol className="mt-5 space-y-3">
              {STEPS.map(([title, body], i) => (
                <li key={title} className="flex gap-3">
                  <span className="font-display grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-[var(--foreground)] bg-[var(--gold)] text-sm">{i + 1}</span>
                  <span className="text-[15px]">
                    <b>{title}.</b> <span className="text-[var(--muted)]">{body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            {member ? (
              <>
                <SuggestBox />
                {mine && <MySuggestions mine={mine} />}
              </>
            ) : (
              <div className="rounded-[6px] border-2 border-dashed border-[var(--foreground)] p-6 text-center">
                <p className="font-display text-xl">Sign in to suggest something</p>
                <p className="mt-2 text-[15px] text-[var(--muted)]">It&apos;s free: any Royale Insider can send ideas and vote for the ones they want.</p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <Link href={`/account/login?next=${encodeURIComponent("/whats-new#suggest")}`} className="btn-primary px-6 py-3">
                    Sign in
                  </Link>
                  <Link href="/membership" className="btn-secondary px-6 py-3">
                    Become an Insider
                  </Link>
                </div>
                <p className="mt-4 text-sm text-[var(--muted)]">
                  Or just tell us at the bar, or email{" "}
                  <a href="mailto:info@royalecinemajoplin.com" className="font-bold hover:text-[var(--accent)]">
                    info@royalecinemajoplin.com
                  </a>
                  .
                </p>
              </div>
            )}
          </div>
        </div>
        <SpecFoot />
      </section>
    </div>
  );
}
