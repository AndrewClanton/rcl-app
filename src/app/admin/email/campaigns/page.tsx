import { Suspense } from "react";
import { hasAdminAccess, requireManager } from "@/lib/auth";
import { summarize, type CampaignSummary } from "@/lib/email/reports";
import { firstWaveSize, getSendPlan, getWaveMode } from "@/lib/email/send-plan";
import EmailHeader from "../_studio/EmailHeader";
import { StatusLine } from "../_studio/Sending";
import { CardGrid } from "../_studio/Cards";
import { NewEmailButtons } from "../OverviewControls";
import { campaignCard, designCard, designStates, sendingState, writtenCampaigns, type DesignState } from "../_studio/data";
import { testLog } from "../_studio/tests-log";

export const dynamic = "force-dynamic";

// Back office -> Email -> Campaigns: every email as a card. The three
// ready-made ones (each opens on Ready to send), then everything written
// here, newest first: drafts (the Monday lineup draft among them),
// scheduled, going, paused and sent. Each card opens its own screen.

// The ready-made cards count who each would go to (the whole member list,
// a second or two), so they come in on their own; everything else shows
// straight away.
async function ReadyMade({ designs, auto, now }: { designs: Promise<DesignState[]>; auto: Promise<boolean>; now: Date }) {
  const [ds, a] = await Promise.all([designs, auto]);
  return <CardGrid cards={ds.map((d) => designCard(d, { auto: a, now }))} />;
}

function ReadyMadeWaiting() {
  const block = "animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface)] h-24 sm:h-56";
  return (
    <div aria-busy="true" aria-label="Counting who each would go to" className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(250px,1fr))] sm:gap-4">
      <div className={block} />
      <div className={block} />
      <div className={block} />
    </div>
  );
}

export default async function CampaignsPage() {
  const staff = await requireManager();
  const now = new Date();
  const planP = getSendPlan();
  const modeP = getWaveMode();
  const testsP = testLog();
  const designsP = designStates({ now, firstWave: planP.then(firstWaveSize), tests: testsP, me: staff.employeeId });
  designsP.catch(() => null); // shown (or its error) by ReadyMade below
  // A failed load says so (never an empty list that looks like "no emails").
  const writtenP = writtenCampaigns(80).then(
    (list) => ({ ok: true as const, list }),
    (e: unknown) => {
      console.error("email campaigns: list not loaded", e);
      return { ok: false as const, list: [] as Awaited<ReturnType<typeof writtenCampaigns>> };
    },
  );
  // How the latest ones that went out did (one line each), as soon as the
  // list is in.
  const summariesP = writtenP.then(async ({ list: written }) => {
    const gone = written.filter((c) => c.status === "sent").slice(0, 12);
    const got = await Promise.all(gone.map((c) => summarize(c).catch(() => null)));
    return new Map<string, CampaignSummary>(got.filter((s): s is CampaignSummary => !!s).map((s) => [s.campaign.id, s]));
  });
  const [{ ok: loaded, list: written }, state, summaries] = await Promise.all([writtenP, sendingState(), summariesP, planP, modeP]);
  const notLoaded = <p className="text-sm font-semibold text-[var(--danger-text)]" role="alert">Couldn&apos;t load your emails. Refresh the page to try again.</p>;
  const needs = written.filter((c) => ["draft", "scheduled", "sending", "paused"].includes(c.status));
  const done = written.filter((c) => !["draft", "scheduled", "sending", "paused"].includes(c.status));

  return (
    <div className="space-y-7">
      <EmailHeader tab="campaigns" isAdmin={hasAdminAccess(staff.role)} />
      <StatusLine s={state} />

      <section aria-labelledby="ready-h" className="space-y-3.5">
        <div className="es-head">
          <h2 id="ready-h" className="font-display text-2xl">
            Ready-made
          </h2>
          <span className="text-sm text-[var(--muted)]">Finished emails: look, test, then send a few at a time</span>
        </div>
        <Suspense fallback={<ReadyMadeWaiting />}>
          <ReadyMade designs={designsP} auto={modeP.then((m) => m === "auto")} now={now} />
        </Suspense>
      </section>

      <section aria-labelledby="open-h" className="space-y-3.5">
        <div className="es-head">
          <h2 id="open-h" className="font-display text-2xl">
            Drafts and on the way
          </h2>
        </div>
        {!loaded ? notLoaded : needs.length ? <CardGrid cards={needs.map((c) => campaignCard(c, null))} /> : <p className="text-sm text-[var(--muted)]">No drafts, and nothing scheduled.</p>}
      </section>

      <section aria-labelledby="sent-h" className="space-y-3.5">
        <div className="es-head">
          <h2 id="sent-h" className="font-display text-2xl">
            Sent
          </h2>
        </div>
        {!loaded ? notLoaded : done.length ? <CardGrid cards={done.map((c) => campaignCard(c, summaries.get(c.id) ?? null))} /> : <p className="text-sm text-[var(--muted)]">Nothing sent from here yet.</p>}
      </section>

      <section aria-labelledby="start-h" className="space-y-3.5">
        <div className="es-head">
          <h2 id="start-h" className="font-display text-2xl">
            Start a new email
          </h2>
        </div>
        <NewEmailButtons />
      </section>
    </div>
  );
}
