import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SpecFoot } from "@/components/print";
import { pageMeta } from "@/lib/seo/page-meta";
import { getStaffSession } from "@/lib/auth";
import { getSignedInMember } from "@/lib/member-auth";
import { getMemberRoadmapState, getPublicRoadmapItem } from "@/lib/data/roadmap";
import { STATUS_BLURB, STATUS_LABEL, canVote, longDate, shortDate, timeAgo, timelineFor } from "@/lib/roadmap";
import { Credit, LivePulse, StatusTag } from "../parts";
import VoteButton from "../VoteButton";
import NoteBox from "../NoteBox";
import CopyLink from "../CopyLink";
import LiveRefresh from "../LiveRefresh";

// One item's own page, to share with whoever asked for it: where it is
// (big), its place in line, how it got here, who suggested it (with their
// OK), and "I want this too" plus a private note for signed-in members.
export const dynamic = "force-dynamic";

function headline(status: string, position: number | null): string {
  if (status === "queued" && position) return `#${position} in line`;
  if (status === "live") return "It's live!";
  return STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? "On the list";
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  // Staff only, like /whats-new.
  if (!(await getStaffSession())) notFound();
  const { slug } = await params;
  const item = await getPublicRoadmapItem(slug).catch(() => null);
  if (!item) return { title: "What's new", robots: { index: false, follow: false } };
  const lead = `${headline(item.status, item.position)} at Royale Cinema Lounge.`;
  return pageMeta({
    title: `${item.title} · What's new`,
    description: item.summary ? `${lead} ${item.summary}`.slice(0, 300) : lead,
    path: `/whats-new/${item.slug}`,
  });
}

export default async function RoadmapItemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [item, member] = await Promise.all([getPublicRoadmapItem(slug), getSignedInMember()]);
  if (!item) notFound();
  const mine = member ? await getMemberRoadmapState(member.id).catch(() => null) : null;
  const voted = !!mine?.voted.includes(item.id);
  const steps = timelineFor({ status: item.status, created_at: item.createdAt, shipped_at: item.shippedAt, history: item.history });
  const open = canVote(item.status);

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <LiveRefresh />
      <Link href="/whats-new" className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-[var(--muted)] hover:text-[var(--accent)]">
        <span aria-hidden>←</span> What&apos;s new
      </Link>

      <article className="sheet crop overflow-visible">
        <div className={`relative px-6 pt-8 pb-7 sm:px-10 sm:pt-10 ${item.status === "live" ? "bg-[var(--gold)]" : ""} rounded-t-[4px]`}>
          <div className="flex flex-wrap items-center gap-3">
            {item.status === "building" && <LivePulse />}
            <StatusTag status={item.status} position={item.position} />
            {item.release && item.status === "live" && <span className="font-mono text-[10.5px] tracking-[0.08em] uppercase opacity-70">Release {item.release}</span>}
          </div>
          <p className="font-display mt-5 text-5xl leading-none text-balance sm:text-7xl">{headline(item.status, item.position)}</p>
          <h1 className="font-display mt-5 text-2xl leading-tight text-balance sm:text-3xl">{item.title}</h1>
          {item.summary && <p className="mt-3 max-w-2xl text-base sm:text-[17px]">{item.summary}</p>}
          <p className="mt-4 text-[15px] text-[var(--muted)]">{STATUS_BLURB[item.status]}</p>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Credit name={item.credit} />
            <span className="font-mono text-[11px] tracking-[0.04em] text-[var(--muted)] uppercase">Updated {timeAgo(item.updatedAt)}</span>
          </div>
        </div>

        {/* How it got here. */}
        <div className="border-t-2 border-[var(--foreground)] px-6 py-7 sm:px-10">
          <h2 className="label-xs">The story so far</h2>
          {item.status === "not_doing" ? (
            <p className="mt-2 text-[15px] text-[var(--muted)]">
              Suggested {shortDate(steps[0].at ?? item.createdAt)}. We&apos;ve decided not to build this one for now. Thanks for the idea all the same.
            </p>
          ) : (
            <ol className="mt-4 grid gap-4 sm:grid-cols-4 sm:gap-0">
              {steps.map((s, i) => (
                <li key={s.key} className="relative flex items-start gap-3 sm:flex-col sm:items-center sm:text-center">
                  {i > 0 && (
                    <span
                      aria-hidden
                      className={`absolute top-4 right-1/2 hidden h-[3px] w-full sm:block ${s.done || s.current ? "bg-[var(--foreground)]" : "bg-[var(--border)]"}`}
                    />
                  )}
                  <span
                    className={`relative z-[1] grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-sm font-bold ${
                      s.done
                        ? "border-[var(--foreground)] bg-[var(--gold)]"
                        : s.current
                          ? "border-[var(--foreground)] bg-[var(--accent)] text-white"
                          : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
                    }`}
                    aria-hidden
                  >
                    {s.done ? "✓" : i + 1}
                  </span>
                  <span className="sm:mt-2">
                    <span className={`block font-bold ${s.done || s.current ? "" : "text-[var(--muted)]"}`}>{s.label}</span>
                    {/* A step it went past without stopping has no date. */}
                    {(s.at || !s.done) && (
                      <span className="block font-mono text-[11px] text-[var(--muted)] uppercase">
                        {s.at ? shortDate(s.at) : s.current ? "now" : "not yet"}
                        {s.current && s.at ? " · now" : ""}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {item.status === "live" && item.shippedAt && <p className="mt-5 text-[15px] font-bold">Went live {longDate(item.shippedAt)}.</p>}
        </div>

        {/* Want it, say so. */}
        <div className="border-t-2 border-[var(--foreground)] px-6 py-7 sm:px-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl">{open ? "Want this too?" : "Share it"}</h2>
              <p className="mt-1 text-[15px] text-[var(--muted)]">
                {open
                  ? item.votes
                    ? `${item.votes} ${item.votes === 1 ? "person wants" : "people want"} this so far. Every vote helps us decide what's next.`
                    : "Be the first to say you want it. Every vote helps us decide what's next."
                  : "Send it to a friend who's been waiting for it."}
              </p>
            </div>
            <VoteButton itemId={item.id} slug={item.slug} votes={item.votes} voted={voted} signedIn={!!member} open={open} big />
          </div>
          <div className="mt-5">
            <CopyLink slug={item.slug} title={item.title} />
          </div>
        </div>

        {open && (
          <div id="note" className="site-anchor border-t-2 border-[var(--foreground)] px-6 py-7 sm:px-10">
            <h2 className="font-display text-xl">Tell the crew</h2>
            {member ? (
              <div className="mt-3">
                <NoteBox itemId={item.id} />
              </div>
            ) : (
              <p className="mt-2 text-[15px] text-[var(--muted)]">
                <Link href={`/account/login?next=${encodeURIComponent(`/whats-new/${item.slug}#note`)}`} className="font-bold text-[var(--accent)] hover:underline">
                  Sign in
                </Link>{" "}
                to send the crew a private note about this: how you&apos;d use it, what would make it great.
              </p>
            )}
          </div>
        )}
        <SpecFoot />
      </article>

      <p className="text-center text-[15px] text-[var(--muted)]">
        Got an idea of your own?{" "}
        <Link href="/whats-new#suggest" className="font-bold text-[var(--accent)] hover:underline">
          Suggest something
        </Link>
      </p>
    </div>
  );
}
